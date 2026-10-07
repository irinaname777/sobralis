CREATE OR REPLACE FUNCTION public.schedule_conflict_for_event_at(
  _kind text,
  _event_id uuid,
  _user_id uuid,
  _start date,
  _end date,
  _time text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _user_id IS NULL OR _start IS NULL OR _end IS NULL THEN
    RETURN false;
  END IF;

  IF _kind = 'meeting' THEN
    IF EXISTS (
      SELECT 1
      FROM public.meeting_participants mp
      JOIN public.meetings m ON m.id = mp.meeting_id
      JOIN public.groups g ON g.id = m.group_id
      WHERE mp.user_id = _user_id
        AND mp.meeting_id <> _event_id
        AND mp.status IN ('pending', 'accepted', 'counter_proposed')
        AND g.status = 'active'
        AND m.status <> 'cancelled'
        AND m.meeting_date = _start
        AND (
          _time IS NULL
          OR _time = ''
          OR m.meeting_time IS NULL
          OR m.meeting_time = ''
          OR m.meeting_time = _time
        )
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.trip_participants tp
      JOIN public.trips t ON t.id = tp.trip_id
      JOIN public.groups g ON g.id = t.group_id
      WHERE tp.user_id = _user_id
        AND tp.status IN ('pending', 'accepted', 'counter_proposed')
        AND g.status = 'active'
        AND t.status <> 'cancelled'
        AND t.start_date <= _start
        AND t.end_date >= _start
    ) THEN
      RETURN true;
    END IF;

    RETURN false;
  END IF;

  IF _kind = 'trip' THEN
    IF EXISTS (
      SELECT 1
      FROM public.trip_participants tp
      JOIN public.trips t ON t.id = tp.trip_id
      JOIN public.groups g ON g.id = t.group_id
      WHERE tp.user_id = _user_id
        AND tp.trip_id <> _event_id
        AND tp.status IN ('pending', 'accepted', 'counter_proposed')
        AND g.status = 'active'
        AND t.status <> 'cancelled'
        AND t.start_date <= _end
        AND t.end_date >= _start
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.meeting_participants mp
      JOIN public.meetings m ON m.id = mp.meeting_id
      JOIN public.groups g ON g.id = m.group_id
      WHERE mp.user_id = _user_id
        AND mp.status IN ('pending', 'accepted', 'counter_proposed')
        AND g.status = 'active'
        AND m.status <> 'cancelled'
        AND m.meeting_date BETWEEN _start AND _end
    ) THEN
      RETURN true;
    END IF;

    RETURN false;
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_schedule_event_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_start date;
  v_end date;
  v_time text;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'meetings' THEN
    v_start := NEW.meeting_date;
    v_end := NEW.meeting_date;
    v_time := NEW.meeting_time;

    FOR v_user_id IN
      SELECT DISTINCT user_id
      FROM public.meeting_participants
      WHERE meeting_id = NEW.id
        AND status IN ('pending', 'accepted', 'counter_proposed')
    LOOP
      PERFORM public.schedule_conflict_lock_user(v_user_id);

      IF public.schedule_conflict_for_event_at(
        'meeting',
        NEW.id,
        v_user_id,
        v_start,
        v_end,
        v_time
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'SCHEDULE_CONFLICT';
      END IF;
    END LOOP;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'trips' THEN
    v_start := NEW.start_date;
    v_end := NEW.end_date;
    v_time := NULL;

    FOR v_user_id IN
      SELECT DISTINCT user_id
      FROM public.trip_participants
      WHERE trip_id = NEW.id
        AND status IN ('pending', 'accepted', 'counter_proposed')
    LOOP
      PERFORM public.schedule_conflict_lock_user(v_user_id);

      IF public.schedule_conflict_for_event_at(
        'trip',
        NEW.id,
        v_user_id,
        v_start,
        v_end,
        NULL
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'SCHEDULE_CONFLICT';
      END IF;
    END LOOP;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;
