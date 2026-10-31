BEGIN;

-- API roles must not be able to create objects in a schema used by definer RPCs.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Harden existing SECURITY DEFINER functions without changing their logic.
-- Keeping pg_temp last prevents temporary objects from shadowing public names.
DO $block$
DECLARE
  v_signature regprocedure;
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp',
      v_signature
    );
  END LOOP;
END;
$block$;

-- Only the registration transaction creates profiles. Authenticated clients may
-- edit presentation fields, but cannot create profiles or self-assert completion.
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
REVOKE INSERT, UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (display_name, avatar_emoji) ON public.profiles TO authenticated;

-- Restrictive policies layer a completed-registration check over each existing
-- table policy, so permissive RLS policies cannot be used through the REST API.
DO $block$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'profiles', 'groups', 'group_members', 'group_invitations', 'cycle_settings',
    'meetings', 'meeting_participants', 'trips', 'trip_participants', 'expenses',
    'expense_participants', 'notifications', 'expense_obligations'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS require_completed_registration ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY require_completed_registration ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.registration_is_complete()) WITH CHECK (public.registration_is_complete())',
      v_table
    );
  END LOOP;
END;
$block$;

CREATE OR REPLACE FUNCTION public.complete_sobralis_onboarding(
  _display_name text,
  _avatar_emoji text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'registration_incomplete';
  END IF;
  IF _display_name IS NULL OR length(btrim(_display_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_display_name';
  END IF;

  UPDATE public.profiles
  SET display_name = btrim(_display_name),
      avatar_emoji = COALESCE(NULLIF(_avatar_emoji, ''), '🌸'),
      onboarding_completed = true
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'profile_not_found';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_sobralis_onboarding(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_sobralis_onboarding(text, text)
  TO authenticated;

-- A completion check is tied to the exact document editions recorded by signup.
CREATE OR REPLACE FUNCTION public.registration_is_complete()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.legal_consent_events
      WHERE user_id = auth.uid() AND consent_type = 'age_confirmation'
        AND decision = 'confirmed' AND source IN ('signup', 'legal_update')
        AND document_id = 'user-agreement' AND document_version = '1.0'
        AND document_sha256 = '65147e8243648429633f4883526b429addcf4b49a0c68072a2e2c9bd6b1466f4'
    )
    AND EXISTS (
      SELECT 1 FROM public.legal_consent_events
      WHERE user_id = auth.uid() AND consent_type = 'user_agreement'
        AND decision = 'accepted' AND source IN ('signup', 'legal_update')
        AND document_id = 'user-agreement' AND document_version = '1.0'
        AND document_sha256 = '65147e8243648429633f4883526b429addcf4b49a0c68072a2e2c9bd6b1466f4'
    )
    AND EXISTS (
      SELECT 1 FROM public.legal_consent_events
      WHERE user_id = auth.uid() AND consent_type = 'license'
        AND decision = 'accepted' AND source IN ('signup', 'legal_update')
        AND document_id = 'license' AND document_version = '1.0'
        AND document_sha256 = '4b6eba864e2735ffe331fd2be1dba00e0bd6f55b6294d50ba461c51350fbe1b1'
    )
    AND EXISTS (
      SELECT 1 FROM public.legal_consent_events
      WHERE user_id = auth.uid() AND consent_type = 'personal_data'
        AND decision = 'accepted' AND source IN ('signup', 'legal_update')
        AND document_id = 'personal-data-consent'
        AND document_sha256 = 'bd60e9fd13615401a3d96669874f69765cf41ec8105b62dc1d00b969cbd3bb8a'
    );
$function$;

REVOKE ALL ON FUNCTION public.registration_is_complete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registration_is_complete() TO authenticated;

COMMIT;
