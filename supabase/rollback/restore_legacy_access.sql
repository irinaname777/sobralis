-- Availability rollback for restoring the pre-transition frontend after
-- 20261029112000_registration_profile_access.sql has been applied.
-- Keeps all legal_consent_events rows and signup validation intact. This does
-- not record consent; it temporarily exempts only the explicitly marked
-- pre-existing cohort from the app-access gate.
BEGIN;

CREATE OR REPLACE FUNCTION public.registration_is_complete()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid())
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND legacy_legal_transition
      )
      OR (
        EXISTS (
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
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.registration_is_complete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registration_is_complete() TO authenticated;

COMMIT;
