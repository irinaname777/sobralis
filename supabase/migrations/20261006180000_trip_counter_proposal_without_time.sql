CREATE OR REPLACE FUNCTION public.submit_trip_counter_proposal(
  _trip_id uuid,
  _start_date date,
  _end_date date,
  _location text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _start_date IS NULL
     OR _end_date IS NULL
     OR _end_date < _start_date
     OR _start_date < CURRENT_DATE
  THEN
    RAISE EXCEPTION 'Invalid proposed trip dates';
  END IF;

  PERFORM public.caller_event_participant_status('trip', _trip_id);

  PERFORM set_config('sobralis.skip_coordination_round', '1', true);

  UPDATE public.trips
  SET start_date = _start_date,
      end_date = _end_date,
      destination = COALESCE(NULLIF(_location, ''), destination),
      updated_at = now()
  WHERE id = _trip_id;

  PERFORM set_config('sobralis.skip_coordination_round', '0', true);

  UPDATE public.trip_participants
  SET counter_date = _start_date,
      counter_start_date = _start_date,
      counter_end_date = _end_date,
      counter_time = NULL,
      counter_location = _location
  WHERE trip_id = _trip_id
    AND user_id = auth.uid();

  PERFORM public.begin_coordination_round(
    'trip',
    _trip_id,
    auth.uid(),
    'trip_counter_proposed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_trip_counter_proposal(uuid, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_trip_counter_proposal(uuid, date, date, text) TO authenticated;
