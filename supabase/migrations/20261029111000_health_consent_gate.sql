BEGIN;

CREATE FUNCTION public.require_health_data_consent_for_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_latest_decision text;
  v_document_sha256 text;
BEGIN
  IF NOT NEW.tracking_enabled THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL OR v_uid IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'cycle_consent_required';
  END IF;

  SELECT decision, document_sha256
  INTO v_latest_decision, v_document_sha256
  FROM public.legal_consent_events
  WHERE user_id = NEW.user_id
    AND consent_type = 'health_data'
  ORDER BY recorded_at DESC, id DESC
  LIMIT 1;

  IF v_latest_decision IS DISTINCT FROM 'granted'
     OR v_document_sha256 IS DISTINCT FROM
       '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'cycle_consent_required';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_health_data_consent_for_cycle()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cycle_settings_require_health_consent
  ON public.cycle_settings;

CREATE TRIGGER cycle_settings_require_health_consent
BEFORE INSERT OR UPDATE ON public.cycle_settings
FOR EACH ROW
EXECUTE FUNCTION public.require_health_data_consent_for_cycle();

DROP POLICY IF EXISTS "cycle_select_own" ON public.cycle_settings;
CREATE POLICY "cycle_select_own" ON public.cycle_settings
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.legal_consent_events AS consent
      WHERE consent.user_id = cycle_settings.user_id
        AND consent.consent_type = 'health_data'
        AND consent.decision = 'granted'
        AND consent.document_sha256 =
          '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559'
        AND NOT EXISTS (
          SELECT 1
          FROM public.legal_consent_events AS newer
          WHERE newer.user_id = consent.user_id
            AND newer.consent_type = consent.consent_type
            AND (newer.recorded_at, newer.id) > (consent.recorded_at, consent.id)
        )
    )
  );

DROP POLICY IF EXISTS "cycle_insert_own" ON public.cycle_settings;
DROP POLICY IF EXISTS "cycle_update_own" ON public.cycle_settings;

-- The implementation is not present in the local migration history. Disable
-- every public overload for API roles until its definition and ACL are reviewed.
DO $block$
DECLARE
  v_signature regprocedure;
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'find_best_cycle_dates'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_signature
    );
  END LOOP;
END;
$block$;

COMMIT;
