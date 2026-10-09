-- Restrict direct client access to internal coordination functions.
-- Preserve nested calls made by SECURITY DEFINER functions owned by postgres.

BEGIN;

REVOKE ALL ON FUNCTION public.begin_coordination_round(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.caller_event_participant_status(text, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.refresh_event_coordination_status(text, uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.resolve_event_actionable_notifications(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Keep the trip counter-proposal RPC available to signed-in users.
REVOKE ALL ON FUNCTION public.submit_trip_counter_proposal(uuid, date, date, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_trip_counter_proposal(uuid, date, date, text)
  TO authenticated;

-- Keep payment rejection available to signed-in users.
REVOKE ALL ON FUNCTION public.reject_obligation_payment(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reject_obligation_payment(uuid)
  TO authenticated;

-- This is a trigger function, not a client RPC.
REVOKE ALL ON FUNCTION public.event_participants_refresh_status()
  FROM PUBLIC, anon, authenticated;

COMMIT;
