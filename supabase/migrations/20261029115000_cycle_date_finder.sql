BEGIN;

-- Retained only as a disabled prototype. Its caller-selectable cohort permits
-- repeated-query differencing, so no aggregate result is safe to expose yet.
-- A three-person threshold is not an anonymity guarantee.
CREATE OR REPLACE FUNCTION public.find_best_cycle_dates(
  _group_id uuid,
  _user_ids uuid[],
  _range_start date,
  _range_end date
)
RETURNS TABLE (
  date date,
  rating numeric,
  "comfortLevel" text,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF _range_start IS NULL OR _range_end IS NULL OR _range_end < _range_start
     OR _range_end - _range_start > 180 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_date_range';
  END IF;
  IF NOT public.is_group_active(_group_id)
     OR NOT (public.is_group_member(_group_id) OR public.is_group_owner(_group_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'group_access_required';
  END IF;
  IF _user_ids IS NULL OR cardinality(_user_ids) = 0
     OR cardinality(_user_ids) > 100
     OR EXISTS (
       SELECT 1 FROM unnest(_user_ids) AS requested(user_id)
       WHERE requested.user_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = _group_id
              AND gm.user_id = requested.user_id
              AND COALESCE(gm.status, 'active') = 'active'
          )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_member_selection';
  END IF;

  RETURN QUERY
  WITH contributors AS (
    SELECT cs.last_period_start,
           GREATEST(10, LEAST(60, cs.average_cycle_length)) AS cycle_length,
           GREATEST(1, LEAST(15, cs.period_length)) AS period_length
    FROM public.cycle_settings cs
    WHERE cs.user_id = ANY(_user_ids)
      AND cs.tracking_enabled
      AND cs.privacy_level IN ('full', 'comfort')
      AND cs.last_period_start IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.legal_consent_events consent
        WHERE consent.user_id = cs.user_id
          AND consent.consent_type = 'health_data'
          AND consent.decision = 'granted'
          AND consent.document_sha256 =
            '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559'
          AND NOT EXISTS (
            SELECT 1 FROM public.legal_consent_events newer
            WHERE newer.user_id = consent.user_id
              AND newer.consent_type = consent.consent_type
              AND (newer.recorded_at, newer.id) > (consent.recorded_at, consent.id)
          )
      )
  ),
  dates AS (
    SELECT generated_at::date AS target_date FROM generate_series(
      _range_start::timestamp, _range_end::timestamp, interval '1 day'
    ) AS series(generated_at)
  ),
  scores AS (
    SELECT d.target_date,
           CASE
             WHEN mod(mod(d.target_date - c.last_period_start, c.cycle_length)
                      + c.cycle_length, c.cycle_length) < c.period_length THEN 0
             WHEN mod(mod(d.target_date - c.last_period_start, c.cycle_length)
                      + c.cycle_length, c.cycle_length) >= c.cycle_length - 3 THEN 3
             WHEN abs(
               mod(mod(d.target_date - c.last_period_start, c.cycle_length)
                   + c.cycle_length, c.cycle_length)
               - floor(c.cycle_length::numeric / 2)
             ) <= 1 THEN 3
             ELSE 5
           END::numeric AS score
    FROM dates d CROSS JOIN contributors c
  ),
  coverage AS (SELECT count(*) AS participant_count FROM contributors),
  daily AS (
    SELECT d.target_date,
           CASE WHEN coverage.participant_count >= 3 THEN avg(scores.score) END AS avg_score
    FROM dates d CROSS JOIN coverage
    LEFT JOIN scores ON scores.target_date = d.target_date
    GROUP BY d.target_date, coverage.participant_count
  )
  SELECT daily.target_date,
         round(COALESCE(daily.avg_score, 5) * 2) / 2,
         CASE
           WHEN daily.avg_score IS NULL THEN 'comfortable'
           WHEN daily.avg_score >= 4.5 THEN 'comfortable'
           WHEN daily.avg_score >= 3 THEN 'moderate'
           ELSE 'uncomfortable'
         END,
         CASE
           WHEN daily.avg_score IS NULL THEN
             'Недостаточно участниц с добровольно включёнными данными — оценка нейтральная'
           WHEN daily.avg_score >= 4.5 THEN 'Подходит большинству участниц группы'
           WHEN daily.avg_score >= 3 THEN 'Средняя комфортность для группы'
           ELSE 'Неподходящее время для части участниц'
         END
  FROM daily
  ORDER BY round(COALESCE(daily.avg_score, 5) * 2) / 2 DESC,
           daily.target_date ASC
  LIMIT 10;
END;
$function$;

REVOKE ALL ON FUNCTION public.find_best_cycle_dates(uuid, uuid[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
