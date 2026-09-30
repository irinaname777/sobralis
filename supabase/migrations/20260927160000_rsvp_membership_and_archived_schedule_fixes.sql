/* Corrective rules for the 202609 migrations; no existing migration is changed. */

-- `invited` and `removed` never grant ordinary group access.
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = auth.uid()
      AND COALESCE(status, 'active') IN ('active', 'accepted')
  );
$$;
CREATE OR REPLACE FUNCTION public.is_active_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = _user_id
      AND COALESCE(status, 'active') IN ('active', 'accepted')
  );
$$;

-- RSVP can transition exactly once from pending, and only for the caller.
CREATE OR REPLACE FUNCTION public.respond_to_event_invitation(
  _kind text, _event_id uuid, _status text, _counter_date date DEFAULT NULL,
  _counter_time text DEFAULT NULL, _counter_location text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE organizer uuid; title_text text;
BEGIN
  IF _kind NOT IN ('meeting', 'trip') OR _status NOT IN ('accepted', 'declined', 'counter_proposed') THEN
    RAISE EXCEPTION 'Invalid invitation response';
  END IF;
  IF _kind = 'meeting' THEN
    UPDATE public.meeting_participants
    SET status = _status, counter_date = _counter_date, counter_time = _counter_time, counter_location = _counter_location
    WHERE meeting_id = _event_id AND user_id = auth.uid() AND status = 'pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found'; END IF;
    SELECT created_by, title INTO organizer, title_text FROM public.meetings WHERE id = _event_id;
  ELSE
    UPDATE public.trip_participants
    SET status = _status, counter_date = _counter_date, counter_time = _counter_time, counter_location = _counter_location
    WHERE trip_id = _event_id AND user_id = auth.uid() AND status = 'pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found'; END IF;
    SELECT created_by, title INTO organizer, title_text FROM public.trips WHERE id = _event_id;
  END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (organizer, auth.uid(), _kind || '_' || _status, _kind, _event_id,
    jsonb_build_object('title', title_text, 'counter_date', _counter_date, 'counter_time', _counter_time, 'counter_location', _counter_location));
END;
$$;

ALTER TABLE public.trip_participants
  ADD COLUMN IF NOT EXISTS counter_start_date date,
  ADD COLUMN IF NOT EXISTS counter_end_date date;

CREATE OR REPLACE FUNCTION public.submit_trip_counter_proposal(
  _trip_id uuid, _start_date date, _end_date date, _time text DEFAULT NULL, _location text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE organizer uuid; title_text text;
BEGIN
  IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date THEN
    RAISE EXCEPTION 'Invalid proposed trip dates';
  END IF;
  UPDATE public.trip_participants
  SET status = 'counter_proposed', counter_date = _start_date, counter_start_date = _start_date,
      counter_end_date = _end_date, counter_time = _time, counter_location = _location
  WHERE trip_id = _trip_id AND user_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found'; END IF;
  SELECT created_by, title INTO organizer, title_text FROM public.trips WHERE id = _trip_id;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (organizer, auth.uid(), 'trip_counter_proposed', 'trip', _trip_id,
    jsonb_build_object('title', title_text, 'counter_start_date', _start_date, 'counter_end_date', _end_date, 'counter_time', _time, 'counter_location', _location));
END;
$$;

-- No direct participant mutation bypasses the RPC state guard.
DROP POLICY IF EXISTS "meeting_participants_update_self" ON public.meeting_participants;
DROP POLICY IF EXISTS "trip_participants_update_self" ON public.trip_participants;

CREATE OR REPLACE FUNCTION public.find_schedule_conflicts(
  _user_ids uuid[], _start date, _end date, _time text DEFAULT NULL,
  _exclude_kind text DEFAULT NULL, _exclude_id uuid DEFAULT NULL
) RETURNS TABLE (busy_user_id uuid, kind text, start_date date, end_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR _user_ids IS NULL OR array_length(_user_ids, 1) IS NULL THEN RETURN; END IF;
  IF NOT public.caller_can_check_schedule(_user_ids) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
  SELECT mp.user_id, 'meeting'::text, m.meeting_date, m.meeting_date
  FROM public.meeting_participants mp JOIN public.meetings m ON m.id = mp.meeting_id
  JOIN public.groups g ON g.id = m.group_id
  WHERE g.status = 'active' AND mp.user_id = ANY (_user_ids)
    AND mp.status IN ('pending', 'accepted', 'counter_proposed') AND m.meeting_date BETWEEN _start AND _end
    AND NOT (_exclude_kind = 'meeting' AND m.id = _exclude_id)
    AND (_time IS NULL OR _time = '' OR m.meeting_time IS NULL OR m.meeting_time = '' OR m.meeting_time = _time)
  UNION ALL
  SELECT tp.user_id, 'trip'::text, t.start_date, t.end_date
  FROM public.trip_participants tp JOIN public.trips t ON t.id = tp.trip_id
  JOIN public.groups g ON g.id = t.group_id
  WHERE g.status = 'active' AND tp.user_id = ANY (_user_ids)
    AND tp.status IN ('pending', 'accepted', 'counter_proposed') AND t.start_date <= _end AND t.end_date >= _start
    AND NOT (_exclude_kind = 'trip' AND t.id = _exclude_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_trip_counter_proposal(uuid, date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_trip_counter_proposal(uuid, date, date, text, text) TO authenticated;
