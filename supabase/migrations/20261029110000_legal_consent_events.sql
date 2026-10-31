BEGIN;

CREATE TABLE public.legal_consent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  consent_type text NOT NULL CHECK (
    consent_type IN (
      'age_confirmation',
      'user_agreement',
      'license',
      'personal_data',
      'health_data',
      'advertising',
      'cookie_storage'
    )
  ),
  decision text NOT NULL CHECK (
    decision IN ('confirmed', 'accepted', 'granted', 'declined', 'revoked')
  ),
  document_id text NOT NULL,
  document_version text,
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  checkbox_text_sha256 text NOT NULL DEFAULT
    '815c6a1ac75a7140f5887f24ab6ee82b941907b263f7f387c75d360663867d6b'
    CHECK (checkbox_text_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source text NOT NULL CHECK (source IN ('signup', 'settings'))
);

CREATE INDEX legal_consent_events_user_type_recorded_idx
  ON public.legal_consent_events (user_id, consent_type, recorded_at DESC, id DESC);

ALTER TABLE public.legal_consent_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legal_consent_events
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.legal_consent_events
  TO authenticated;

CREATE POLICY legal_consent_events_select_own
  ON public.legal_consent_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE FUNCTION public.reject_legal_consent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'legal_consent_events_are_append_only';
END;
$function$;

CREATE TRIGGER legal_consent_events_append_only
BEFORE UPDATE OR DELETE ON public.legal_consent_events
FOR EACH ROW
EXECUTE FUNCTION public.reject_legal_consent_event_mutation();

REVOKE ALL ON FUNCTION public.reject_legal_consent_event_mutation()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.validate_sobralis_signup_consents()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_consents jsonb := COALESCE(
    NEW.raw_user_meta_data -> 'sobralis_consents',
    '{}'::jsonb
  );
BEGIN
  IF v_consents ->> 'age_confirmed' IS DISTINCT FROM 'true'
     OR v_consents ->> 'user_agreement' IS DISTINCT FROM 'true'
     OR v_consents ->> 'license' IS DISTINCT FROM 'true'
     OR v_consents ->> 'personal_data' IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'signup_consents_required';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER sobralis_validate_signup_consents
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.validate_sobralis_signup_consents();

CREATE FUNCTION public.record_sobralis_signup_consents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_consents jsonb := COALESCE(
    NEW.raw_user_meta_data -> 'sobralis_consents',
    '{}'::jsonb
  );
BEGIN
  INSERT INTO public.legal_consent_events (
    user_id, consent_type, decision, document_id,
    document_version, document_sha256, source
  )
  VALUES
    (
      NEW.id, 'age_confirmation', 'confirmed', 'user-agreement', '1.0',
      '65147e8243648429633f4883526b429addcf4b49a0c68072a2e2c9bd6b1466f4',
      'signup'
    ),
    (
      NEW.id, 'user_agreement', 'accepted', 'user-agreement', '1.0',
      '65147e8243648429633f4883526b429addcf4b49a0c68072a2e2c9bd6b1466f4',
      'signup'
    ),
    (
      NEW.id, 'license', 'accepted', 'license', '1.0',
      '4b6eba864e2735ffe331fd2be1dba00e0bd6f55b6294d50ba461c51350fbe1b1',
      'signup'
    ),
    (
      NEW.id, 'personal_data', 'accepted', 'personal-data-consent', NULL,
      'bd60e9fd13615401a3d96669874f69765cf41ec8105b62dc1d00b969cbd3bb8a',
      'signup'
    ),
    (
      NEW.id,
      'health_data',
      CASE WHEN v_consents ->> 'health_data' = 'true' THEN 'granted' ELSE 'declined' END,
      'health-data-consent',
      NULL,
      '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559',
      'signup'
    ),
    (
      NEW.id,
      'advertising',
      CASE WHEN v_consents ->> 'advertising' = 'true' THEN 'granted' ELSE 'declined' END,
      'advertising-consent',
      NULL,
      'c90bccdf86dfee94d24bc8cf41eb96379cbb7a6c1bb83c66a442d576a416d416',
      'signup'
    ),
    (
      NEW.id,
      'cookie_storage',
      CASE WHEN v_consents ->> 'cookie_storage' = 'true' THEN 'granted' ELSE 'declined' END,
      'cookie-consent',
      NULL,
      'a3a492c454e9c00a05250ce43816b68574ce0f6a2cc1e3fd3416e3e79dc8d025',
      'signup'
    );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER sobralis_record_signup_consents
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.record_sobralis_signup_consents();

CREATE FUNCTION public.apply_health_consent_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.consent_type = 'health_data'
     AND NEW.decision IN ('declined', 'revoked')
  THEN
    UPDATE public.cycle_settings
    SET tracking_enabled = false
    WHERE user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_health_consent_revocation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER legal_consent_events_apply_health_revocation
AFTER INSERT ON public.legal_consent_events
FOR EACH ROW
EXECUTE FUNCTION public.apply_health_consent_revocation();

REVOKE ALL ON FUNCTION public.validate_sobralis_signup_consents()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_sobralis_signup_consents()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_health_data_consent(_granted boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_locked_user uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id
  INTO v_locked_user
  FROM auth.users
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO public.legal_consent_events (
    user_id, consent_type, decision, document_id,
    document_version, document_sha256, source
  )
  VALUES (
    v_uid,
    'health_data',
    CASE WHEN _granted THEN 'granted' ELSE 'revoked' END,
    'health-data-consent',
    NULL,
    '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559',
    'settings'
  );

  IF _granted THEN
    UPDATE public.cycle_settings
    SET tracking_enabled = false
    WHERE user_id = v_uid;
  END IF;
END;
$function$;

CREATE FUNCTION public.save_cycle_settings(
  _tracking_enabled boolean,
  _last_period_start date,
  _average_cycle_length integer,
  _period_length integer,
  _privacy_level text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_locked_user uuid;
  v_health_decision text;
  v_health_document_sha256 text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id
  INTO v_locked_user
  FROM auth.users
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

    SELECT decision, document_sha256
    INTO v_health_decision, v_health_document_sha256
  FROM public.legal_consent_events
  WHERE user_id = v_uid
    AND consent_type = 'health_data'
  ORDER BY recorded_at DESC, id DESC
  LIMIT 1;

  IF _tracking_enabled
     AND (
       v_health_decision IS DISTINCT FROM 'granted'
       OR v_health_document_sha256 IS DISTINCT FROM
         '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559'
     )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'cycle_consent_required';
  END IF;

  IF _tracking_enabled
     AND (
       _last_period_start IS NULL
       OR _average_cycle_length NOT BETWEEN 10 AND 60
       OR _period_length NOT BETWEEN 1 AND 15
     )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid_cycle_settings';
  END IF;

  IF _privacy_level NOT IN ('full', 'comfort', 'hidden') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid_cycle_settings';
  END IF;

  INSERT INTO public.cycle_settings (
    user_id,
    tracking_enabled,
    last_period_start,
    average_cycle_length,
    period_length,
    privacy_level
  )
  VALUES (
    v_uid,
    _tracking_enabled,
    CASE WHEN _tracking_enabled THEN _last_period_start ELSE NULL END,
    CASE WHEN _tracking_enabled THEN COALESCE(_average_cycle_length, 28) ELSE 28 END,
    CASE WHEN _tracking_enabled THEN COALESCE(_period_length, 5) ELSE 5 END,
    CASE WHEN _tracking_enabled THEN _privacy_level ELSE 'hidden' END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET tracking_enabled = EXCLUDED.tracking_enabled,
      last_period_start = EXCLUDED.last_period_start,
      average_cycle_length = EXCLUDED.average_cycle_length,
      period_length = EXCLUDED.period_length,
      privacy_level = EXCLUDED.privacy_level;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_health_data_consent(boolean)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_health_data_consent(boolean)
  TO authenticated;

REVOKE ALL ON FUNCTION public.save_cycle_settings(boolean, date, integer, integer, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_cycle_settings(boolean, date, integer, integer, text)
  TO authenticated;


CREATE FUNCTION public.delete_cycle_settings()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'authentication_required';
  END IF;

  DELETE FROM public.cycle_settings
  WHERE user_id = v_uid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_cycle_settings()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cycle_settings()
  TO authenticated;

COMMIT;
