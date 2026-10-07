-- Backend protection against overlapping meetings and trips.
-- UI already performs the same check and provides friendly messages.
-- This migration adds database-level enforcement.

CREATE OR REPLACE FUNCTION public.schedule_conflict_lock_user(
  _user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(_user_id::text, 0)
    );
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.schedule_conflict_for_event(
  _kind text,
  _event_id uuid,
  _user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_start date;
  v_end date;
  v_time text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF _kind = 'meeting' THEN

    SELECT meeting_date, meeting_date, meeting_time
      INTO v_start, v_end, v_time
    FROM public.meetings
    WHERE id = _event_id
      AND status <> 'cancelled';

    IF v_start IS NULL THEN
      RETURN false;
    END IF;

    -- Meeting ↔ meeting
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
        AND m.meeting_date = v_start
        AND (
          v_time IS NULL
          OR v_time = ''
          OR m.meeting_time IS NULL
          OR m.meeting_time = ''
          OR m.meeting_time = v_time
        )
    ) THEN
      RETURN true;
    END IF;

    -- Meeting ↔ trip
    IF EXISTS (
      SELECT 1
      FROM public.trip_participants tp
      JOIN public.trips t ON t.id = tp.trip_id
      JOIN public.groups g ON g.id = t.group_id
      WHERE tp.user_id = _user_id
        AND tp.status IN ('pending', 'accepted', 'counter_proposed')
        AND g.status = 'active'
        AND t.status <> 'cancelled'
        AND t.start_date <= v_start
        AND t.end_date >= v_start
    ) THEN
      RETURN true;
    END IF;

    RETURN false;
  END IF;


  IF _kind = 'trip' THEN

    SELECT start_date, end_date
      INTO v_start, v_end
    FROM public.trips
    WHERE id = _event_id
      AND status <> 'cancelled';

    IF v_start IS NULL OR v_end IS NULL THEN
      RETURN false;
    END IF;

    -- Trip ↔ trip
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
        AND t.start_date <= v_end
        AND t.end_date >= v_start
    ) THEN
      RETURN true;
    END IF;

    -- Trip ↔ meeting
    IF EXISTS (
      SELECT 1
      FROM public.meeting_participants mp
      JOIN public.meetings m ON m.id = mp.meeting_id
      JOIN public.groups g ON g.id = m.group_id
      WHERE mp.user_id = _user_id
        AND mp.status IN ('pending', 'accepted', 'counter_proposed')
        AND g.status = 'active'
        AND m.status <> 'cancelled'
        AND m.meeting_date BETWEEN v_start AND v_end
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
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'meetings' THEN

    FOR v_user_id IN
      SELECT DISTINCT user_id
      FROM public.meeting_participants
      WHERE meeting_id = NEW.id
        AND status IN ('pending', 'accepted', 'counter_proposed')
    LOOP
      PERFORM public.schedule_conflict_lock_user(v_user_id);

      IF public.schedule_conflict_for_event(
        'meeting',
        NEW.id,
        v_user_id
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'SCHEDULE_CONFLICT';
      END IF;
    END LOOP;

    RETURN NEW;
  END IF;


  IF TG_TABLE_NAME = 'trips' THEN

    FOR v_user_id IN
      SELECT DISTINCT user_id
      FROM public.trip_participants
      WHERE trip_id = NEW.id
        AND status IN ('pending', 'accepted', 'counter_proposed')
    LOOP
      PERFORM public.schedule_conflict_lock_user(v_user_id);

      IF public.schedule_conflict_for_event(
        'trip',
        NEW.id,
        v_user_id
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


CREATE OR REPLACE FUNCTION public.validate_schedule_participant_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status NOT IN ('pending', 'accepted', 'counter_proposed') THEN
    RETURN NEW;
  END IF;

  PERFORM public.schedule_conflict_lock_user(NEW.user_id);

  IF public.schedule_conflict_for_event(
    CASE
      WHEN TG_TABLE_NAME = 'meeting_participants' THEN 'meeting'
      ELSE 'trip'
    END,
    CASE
      WHEN TG_TABLE_NAME = 'meeting_participants' THEN NEW.meeting_id
      ELSE NEW.trip_id
    END,
    NEW.user_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'SCHEDULE_CONFLICT';
  END IF;

  RETURN NEW;
END;
$function$;


DROP TRIGGER IF EXISTS meetings_validate_schedule_conflict
  ON public.meetings;

CREATE TRIGGER meetings_validate_schedule_conflict
BEFORE INSERT OR UPDATE OF meeting_date, meeting_time, status
ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.validate_schedule_event_conflict();


DROP TRIGGER IF EXISTS trips_validate_schedule_conflict
  ON public.trips;

CREATE TRIGGER trips_validate_schedule_conflict
BEFORE INSERT OR UPDATE OF start_date, end_date, status
ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.validate_schedule_event_conflict();


DROP TRIGGER IF EXISTS meeting_participants_validate_schedule_conflict
  ON public.meeting_participants;

CREATE TRIGGER meeting_participants_validate_schedule_conflict
BEFORE INSERT OR UPDATE OF user_id, meeting_id, status
ON public.meeting_participants
FOR EACH ROW
EXECUTE FUNCTION public.validate_schedule_participant_conflict();


DROP TRIGGER IF EXISTS trip_participants_validate_schedule_conflict
  ON public.trip_participants;

CREATE TRIGGER trip_participants_validate_schedule_conflict
BEFORE INSERT OR UPDATE OF user_id, trip_id, status
ON public.trip_participants
FOR EACH ROW
EXECUTE FUNCTION public.validate_schedule_participant_conflict();


REVOKE ALL ON FUNCTION public.schedule_conflict_lock_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_conflict_for_event(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_schedule_event_conflict() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_schedule_participant_conflict() FROM PUBLIC;
