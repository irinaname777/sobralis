/*
  Soft group membership, RSVP defaults, archive notifications,
  expense obligation backfill, and Sobralis-only schedule conflicts.
*/

ALTER TABLE public.meeting_participants
  ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.trip_participants
  ALTER COLUMN status SET DEFAULT 'pending';

-- Active membership only. Removed rows stay for history and rejoin.
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_id = _group_id
      AND user_id = auth.uid()
      AND COALESCE(status, 'active') <> 'removed'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_id = _group_id
      AND user_id = _user_id
      AND COALESCE(status, 'active') <> 'removed'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_group_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_group_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_group_members(
  _group_id uuid,
  _actor uuid,
  _type text,
  _include_actor boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  SELECT gm.user_id, _actor, _type, 'group', _group_id
  FROM public.group_members gm
  WHERE gm.group_id = _group_id
    AND COALESCE(gm.status, 'active') <> 'removed'
    AND (_include_actor OR gm.user_id IS DISTINCT FROM _actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_group_member_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.status, 'active') = 'removed' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  VALUES (NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'group_you_were_added', 'group', NEW.group_id);
  PERFORM public.notify_group_members(NEW.group_id, NEW.user_id, 'group_participant_added', false);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_group_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  VALUES (OLD.user_id, auth.uid(), 'group_you_were_removed', 'group', OLD.group_id);
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  SELECT gm.user_id, auth.uid(), 'group_participant_removed', 'group', OLD.group_id
  FROM public.group_members gm
  WHERE gm.group_id = OLD.group_id
    AND gm.user_id <> OLD.user_id
    AND COALESCE(gm.status, 'active') <> 'removed';
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_group_member_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.status, 'active') <> 'removed'
     AND NEW.status = 'removed' THEN
    INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
    VALUES (OLD.user_id, auth.uid(), 'group_you_were_removed', 'group', OLD.group_id);
    INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
    SELECT gm.user_id, auth.uid(), 'group_participant_removed', 'group', OLD.group_id
    FROM public.group_members gm
    WHERE gm.group_id = OLD.group_id
      AND gm.user_id <> OLD.user_id
      AND COALESCE(gm.status, 'active') <> 'removed';
  ELSIF TG_OP = 'UPDATE'
     AND COALESCE(OLD.status, 'active') = 'removed'
     AND COALESCE(NEW.status, 'active') <> 'removed' THEN
    INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
    VALUES (NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'group_you_were_added', 'group', NEW.group_id);
    PERFORM public.notify_group_members(NEW.group_id, NEW.user_id, 'group_participant_added', false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_member_added_notification ON public.group_members;
CREATE TRIGGER group_member_added_notification
  AFTER INSERT ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_group_member_added();

DROP TRIGGER IF EXISTS group_member_removed_notification ON public.group_members;
CREATE TRIGGER group_member_removed_notification
  AFTER DELETE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_group_member_removed();

DROP TRIGGER IF EXISTS group_member_status_notification ON public.group_members;
CREATE TRIGGER group_member_status_notification
  AFTER UPDATE OF status ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_group_member_status_change();

CREATE OR REPLACE FUNCTION public.remove_group_member(_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.group_members%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM public.group_members WHERE id = _member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF NOT public.is_group_active(rec.group_id) THEN
    RAISE EXCEPTION 'Group is archived';
  END IF;
  IF rec.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the group owner';
  END IF;
  IF rec.user_id <> auth.uid() AND NOT public.is_group_owner(rec.group_id) THEN
    RAISE EXCEPTION 'Not allowed to remove this member';
  END IF;
  UPDATE public.group_members
  SET status = 'removed', removed_at = now()
  WHERE id = _member_id AND COALESCE(status, 'active') <> 'removed';
END;
$$;

REVOKE ALL ON FUNCTION public.remove_group_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_group_by_invite(_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  inv public.group_invitations%ROWTYPE;
  prof public.profiles%ROWTYPE;
  existing public.group_members%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  SELECT * INTO inv FROM public.group_invitations WHERE invite_code = trim(_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;
  IF NOT public.is_group_active(inv.group_id) THEN
    RAISE EXCEPTION 'group_archived';
  END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  SELECT * INTO existing
  FROM public.group_members
  WHERE group_id = inv.group_id AND user_id = uid;

  IF FOUND AND COALESCE(existing.status, 'active') <> 'removed' THEN
    RETURN json_build_object('ok', true, 'already_member', true, 'group_id', inv.group_id);
  END IF;

  IF inv.used_by IS NOT NULL AND inv.used_by <> uid THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;

  IF existing.id IS NOT NULL AND COALESCE(existing.status, 'active') = 'removed' THEN
    UPDATE public.group_members
    SET status = 'active', removed_at = NULL,
        display_name = COALESCE(prof.display_name, prof.email, display_name),
        avatar_emoji = COALESCE(prof.avatar_emoji, avatar_emoji, '🌸')
    WHERE id = existing.id;
  ELSE
    INSERT INTO public.group_members (group_id, user_id, role, display_name, avatar_emoji, status)
    VALUES (
      inv.group_id,
      uid,
      'member',
      COALESCE(prof.display_name, prof.email),
      COALESCE(prof.avatar_emoji, '🌸'),
      'active'
    );
  END IF;

  UPDATE public.group_invitations
  SET used_by = uid
  WHERE id = inv.id AND used_by IS NULL;

  RETURN json_build_object('ok', true, 'already_member', false, 'group_id', inv.group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.groups
  SET status = 'archived'
  WHERE id = _group_id AND owner_id = auth.uid() AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the owner can archive an active group';
  END IF;
  PERFORM public.notify_group_members(_group_id, auth.uid(), 'group_archived', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.groups
  SET status = 'active'
  WHERE id = _group_id AND owner_id = auth.uid() AND status = 'archived';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the owner can restore an archived group';
  END IF;
  PERFORM public.notify_group_members(_group_id, auth.uid(), 'group_restored', true);
END;
$$;

-- Organizer and invitee may update RSVP rows.
DROP POLICY IF EXISTS "meeting_participants_update_self" ON public.meeting_participants;
CREATE POLICY "meeting_participants_update_self" ON public.meeting_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_meeting_organizer(meeting_id))
  WITH CHECK (user_id = auth.uid() OR public.is_meeting_organizer(meeting_id));

DROP POLICY IF EXISTS "trip_participants_update_self" ON public.trip_participants;
CREATE POLICY "trip_participants_update_self" ON public.trip_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_trip_organizer(trip_id))
  WITH CHECK (user_id = auth.uid() OR public.is_trip_organizer(trip_id));

DROP POLICY IF EXISTS "expense_participants_update_member" ON public.expense_participants;
CREATE POLICY "expense_participants_update_member" ON public.expense_participants
  FOR UPDATE TO authenticated
  USING (public.can_access_expense_obligation(expense_id))
  WITH CHECK (public.can_access_expense_obligation(expense_id));

CREATE OR REPLACE FUNCTION public.respond_to_event_invitation(
  _kind text,
  _event_id uuid,
  _status text,
  _counter_date date DEFAULT NULL,
  _counter_time text DEFAULT NULL,
  _counter_location text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  organizer uuid;
  title_text text;
BEGIN
  IF _kind NOT IN ('meeting', 'trip') OR _status NOT IN ('accepted', 'declined', 'counter_proposed') THEN
    RAISE EXCEPTION 'Invalid invitation response';
  END IF;
  IF _kind = 'meeting' THEN
    UPDATE public.meeting_participants
    SET status = _status, counter_date = _counter_date, counter_time = _counter_time, counter_location = _counter_location
    WHERE meeting_id = _event_id AND user_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
    SELECT created_by, title INTO organizer, title_text FROM public.meetings WHERE id = _event_id;
  ELSE
    UPDATE public.trip_participants
    SET status = _status, counter_date = _counter_date, counter_time = _counter_time, counter_location = _counter_location
    WHERE trip_id = _event_id AND user_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
    SELECT created_by, title INTO organizer, title_text FROM public.trips WHERE id = _event_id;
  END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (
    organizer,
    auth.uid(),
    _kind || '_' || _status,
    _kind,
    _event_id,
    jsonb_build_object(
      'title', title_text,
      'counter_date', _counter_date,
      'counter_time', _counter_time,
      'counter_location', _counter_location
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.caller_can_check_schedule(_user_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = ANY (_user_ids)
    OR EXISTS (
      SELECT 1
      FROM public.group_members caller
      WHERE caller.user_id = auth.uid()
        AND COALESCE(caller.status, 'active') <> 'removed'
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(_user_ids) AS uid(id)
          WHERE NOT public.is_active_group_member(caller.group_id, uid.id)
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.find_schedule_conflicts(
  _user_ids uuid[],
  _start date,
  _end date,
  _time text DEFAULT NULL,
  _exclude_kind text DEFAULT NULL,
  _exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (
  busy_user_id uuid,
  kind text,
  start_date date,
  end_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR _user_ids IS NULL OR array_length(_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.caller_can_check_schedule(_user_ids) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  RETURN QUERY
  SELECT mp.user_id, 'meeting'::text, m.meeting_date, m.meeting_date
  FROM public.meeting_participants mp
  JOIN public.meetings m ON m.id = mp.meeting_id
  WHERE mp.user_id = ANY (_user_ids)
    AND mp.status IN ('pending', 'accepted', 'counter_proposed')
    AND m.meeting_date BETWEEN _start AND _end
    AND NOT (_exclude_kind = 'meeting' AND m.id = _exclude_id)
    AND (
      _time IS NULL OR _time = ''
      OR m.meeting_time IS NULL OR m.meeting_time = ''
      OR m.meeting_time = _time
    )
  UNION ALL
  SELECT tp.user_id, 'trip'::text, t.start_date, t.end_date
  FROM public.trip_participants tp
  JOIN public.trips t ON t.id = tp.trip_id
  WHERE tp.user_id = ANY (_user_ids)
    AND tp.status IN ('pending', 'accepted', 'counter_proposed')
    AND t.start_date <= _end
    AND t.end_date >= _start
    AND NOT (_exclude_kind = 'trip' AND t.id = _exclude_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.suggest_free_slots(
  _user_ids uuid[],
  _from date,
  _days integer DEFAULT 14,
  _preferred_time text DEFAULT NULL
)
RETURNS TABLE (slot_date date, slot_time text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date;
  last_day date;
BEGIN
  IF NOT public.caller_can_check_schedule(_user_ids) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  last_day := _from + GREATEST(COALESCE(_days, 14), 1) - 1;
  d := _from;
  WHILE d <= last_day LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.find_schedule_conflicts(_user_ids, d, d, _preferred_time, NULL, NULL)
    ) THEN
      slot_date := d;
      slot_time := NULLIF(_preferred_time, '');
      RETURN NEXT;
    END IF;
    d := d + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.find_schedule_conflicts(uuid[], date, date, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suggest_free_slots(uuid[], date, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_schedule_conflicts(uuid[], date, date, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_free_slots(uuid[], date, integer, text) TO authenticated;

-- Historical expenses keep obligations even if the trigger was added later.
INSERT INTO public.expense_obligations (expense_id, debtor_id, creditor_id, amount)
SELECT ep.expense_id, ep.user_id, e.paid_by, ep.share_amount
FROM public.expense_participants ep
JOIN public.expenses e ON e.id = ep.expense_id
WHERE ep.user_id <> e.paid_by AND ep.share_amount > 0
ON CONFLICT (expense_id, debtor_id, creditor_id) DO UPDATE SET amount = EXCLUDED.amount;

DO $$
BEGIN
  ALTER TABLE public.notifications REPLICA IDENTITY FULL;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
