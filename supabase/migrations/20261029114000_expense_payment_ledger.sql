BEGIN;

ALTER TABLE public.expense_obligations
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_payment_amount numeric(12,2);

-- Preserve obligations already marked settled by the earlier all-or-nothing flow.
UPDATE public.expense_obligations
SET paid_amount = amount
WHERE status = 'settled' AND paid_amount = 0;
UPDATE public.expense_obligations
SET pending_payment_amount = amount - paid_amount
WHERE status = 'payment_pending_confirmation';

ALTER TABLE public.expense_obligations
  ADD CONSTRAINT expense_obligations_paid_amount_valid
  CHECK (paid_amount >= 0 AND paid_amount <= amount);

CREATE TABLE public.expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.expense_obligations(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  rejected_at timestamptz
);
CREATE INDEX expense_payments_obligation_history_idx
  ON public.expense_payments (obligation_id, created_at, id);
CREATE UNIQUE INDEX expense_payments_one_pending_per_obligation_idx
  ON public.expense_payments (obligation_id) WHERE status = 'pending';

-- Carry any in-flight all-or-nothing payment into the immutable payment history.
INSERT INTO public.expense_payments
  (obligation_id, amount, status, created_by, created_at)
SELECT id, pending_payment_amount, 'pending', debtor_id, COALESCE(marked_at, now())
FROM public.expense_obligations
WHERE status = 'payment_pending_confirmation'
  AND pending_payment_amount > 0;
INSERT INTO public.expense_payments
  (obligation_id, amount, status, created_by, created_at, confirmed_at)
SELECT id, amount, 'confirmed', debtor_id, COALESCE(confirmed_at, now()), COALESCE(confirmed_at, now())
FROM public.expense_obligations
WHERE status = 'settled' AND paid_amount > 0;

ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.expense_payments TO authenticated;
CREATE POLICY expense_payments_select_group_members
  ON public.expense_payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.expense_obligations AS o
      WHERE o.id = obligation_id
        AND (o.debtor_id = auth.uid() OR o.creditor_id = auth.uid()
             OR public.can_access_expense_obligation(o.expense_id))
    )
  );
CREATE POLICY expense_payments_require_completed_registration
  ON public.expense_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.registration_is_complete())
  WITH CHECK (public.registration_is_complete());

CREATE OR REPLACE FUNCTION public.prevent_expense_split_change_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_expense_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM public.expense_obligations AS o
    JOIN public.expense_payments AS p ON p.obligation_id = o.id
    WHERE o.expense_id = OLD.expense_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'expense_has_payment_history';
  END IF;
  v_expense_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_id ELSE NEW.expense_id END;
  IF EXISTS (
    SELECT 1
    FROM public.expense_obligations AS o
    JOIN public.expense_payments AS p ON p.obligation_id = o.id
    WHERE o.expense_id = v_expense_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'expense_has_payment_history';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_expense_split_change_after_payment()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS expense_participants_protect_payment_history
  ON public.expense_participants;
CREATE TRIGGER expense_participants_protect_payment_history
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_participants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_split_change_after_payment();

-- Split and payer changes must go through one transaction before any payment
-- attempt exists, so old obligations cannot be left behind or rewritten later.
REVOKE INSERT, UPDATE, DELETE ON public.expenses FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.expense_participants FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_expense(
  _group_id uuid,
  _title text,
  _amount numeric,
  _paid_by uuid,
  _split_method text,
  _shares jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense_id uuid;
  v_count integer;
  v_sum numeric(12,2);
  v_item record;
BEGIN
  IF v_uid IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF NOT public.is_group_active(_group_id)
     OR NOT (public.is_group_member(_group_id) OR public.is_group_owner(_group_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'expense_create_forbidden';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) NOT BETWEEN 1 AND 120
     OR _amount IS NULL OR _amount <= 0
     OR _split_method NOT IN ('equal', 'manual')
     OR _paid_by IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense';
  END IF;
  IF jsonb_typeof(_shares) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_split';
  END IF;
  IF jsonb_array_length(_shares) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_split';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = _paid_by
      AND COALESCE(status, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_payer';
  END IF;

  SELECT count(*), round(sum(round((entry.value ->> 'share_amount')::numeric, 2)), 2)
  INTO v_count, v_sum
  FROM jsonb_array_elements(_shares) AS entry(value);
  IF v_sum IS NULL OR v_sum <> round(_amount, 2) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expense_split_total_mismatch';
  END IF;
  IF v_count <> (SELECT count(DISTINCT (entry.value ->> 'user_id'))
                 FROM jsonb_array_elements(_shares) AS entry(value)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'duplicate_expense_participant';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(_shares) AS s(value) LOOP
    IF (v_item.value ->> 'share_amount') IS NULL
       OR (v_item.value ->> 'share_amount')::numeric < 0
       OR (v_item.value ->> 'share_amount')::numeric <> round((v_item.value ->> 'share_amount')::numeric, 2)
       OR (v_item.value ->> 'share_amount')::numeric > 9999999999.99
       OR NOT EXISTS (
         SELECT 1 FROM public.group_members
         WHERE group_id = _group_id
           AND user_id = (v_item.value ->> 'user_id')::uuid
           AND COALESCE(status, 'active') = 'active'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_participant';
    END IF;
  END LOOP;

  INSERT INTO public.expenses (group_id, title, amount, paid_by, split_method, created_by)
  VALUES (_group_id, btrim(_title), round(_amount, 2), _paid_by, _split_method, v_uid)
  RETURNING id INTO v_expense_id;
  INSERT INTO public.expense_participants (expense_id, user_id, share_amount)
  SELECT v_expense_id, (entry.value ->> 'user_id')::uuid,
         round((entry.value ->> 'share_amount')::numeric, 2)
  FROM jsonb_array_elements(_shares) AS entry(value);
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  SELECT gm.user_id, v_uid, 'expense_created', 'expense', v_expense_id,
         jsonb_build_object('title', btrim(_title), 'amount', round(_amount, 2))
  FROM public.group_members AS gm
  WHERE gm.group_id = _group_id AND gm.user_id <> v_uid
    AND COALESCE(gm.status, 'active') = 'active';
  RETURN v_expense_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_expense(uuid, text, numeric, uuid, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, text, numeric, uuid, text, jsonb)
  TO authenticated;

-- Keep the old production overload for dependency compatibility, but disable
-- execution by every API role so it cannot bypass atomic split/payment checks.
DO $block$
BEGIN
  IF to_regprocedure('public.update_expense(uuid,numeric,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.update_expense(uuid,numeric,text,jsonb) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.update_expense(
  _expense_id uuid,
  _title text,
  _amount numeric,
  _paid_by uuid,
  _split_method text,
  _shares jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_group_id uuid;
  v_uid uuid := auth.uid();
  v_count integer;
  v_sum numeric(12,2);
  v_item record;
BEGIN
  IF v_uid IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) NOT BETWEEN 1 AND 120
     OR _amount IS NULL OR _amount <= 0
     OR _split_method NOT IN ('equal', 'manual') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_update';
  END IF;
  IF jsonb_typeof(_shares) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_update';
  END IF;
  IF jsonb_array_length(_shares) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_update';
  END IF;

  SELECT group_id INTO v_group_id
  FROM public.expenses
  WHERE id = _expense_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_active(v_group_id)
     OR NOT (public.is_group_member(v_group_id) OR public.is_group_owner(v_group_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'expense_update_forbidden';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.expense_obligations o
    JOIN public.expense_payments p ON p.obligation_id = o.id
    WHERE o.expense_id = _expense_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'expense_has_payment_history';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_group_id AND user_id = _paid_by
      AND COALESCE(status, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_payer';
  END IF;

  SELECT count(*), round(sum(round((entry.value ->> 'share_amount')::numeric, 2)), 2)
  INTO v_count, v_sum
  FROM jsonb_array_elements(_shares) AS entry(value);
  IF v_sum IS NULL OR v_sum <> round(_amount, 2) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expense_split_total_mismatch';
  END IF;
  IF v_count <> (SELECT count(DISTINCT (entry.value ->> 'user_id'))
                 FROM jsonb_array_elements(_shares) AS entry(value)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'duplicate_expense_participant';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_shares) AS s(value) LOOP
    IF (v_item.value ->> 'share_amount') IS NULL
       OR (v_item.value ->> 'share_amount')::numeric < 0
       OR (v_item.value ->> 'share_amount')::numeric <> round((v_item.value ->> 'share_amount')::numeric, 2)
       OR (v_item.value ->> 'share_amount')::numeric > 9999999999.99
       OR NOT EXISTS (
         SELECT 1 FROM public.group_members
         WHERE group_id = v_group_id
           AND user_id = (v_item.value ->> 'user_id')::uuid
           AND COALESCE(status, 'active') = 'active'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_expense_participant';
    END IF;
  END LOOP;

  UPDATE public.expenses
  SET title = btrim(_title), amount = round(_amount, 2),
      paid_by = _paid_by, split_method = _split_method
  WHERE id = _expense_id;
  DELETE FROM public.expense_obligations WHERE expense_id = _expense_id;
  DELETE FROM public.expense_participants WHERE expense_id = _expense_id;
  INSERT INTO public.expense_participants (expense_id, user_id, share_amount)
  SELECT _expense_id, (entry.value ->> 'user_id')::uuid,
         round((entry.value ->> 'share_amount')::numeric, 2)
  FROM jsonb_array_elements(_shares) AS entry(value);
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  SELECT gm.user_id, v_uid, 'expense_updated', 'expense', _expense_id,
         jsonb_build_object('title', btrim(_title), 'amount', round(_amount, 2))
  FROM public.group_members AS gm
  WHERE gm.group_id = v_group_id AND gm.user_id <> v_uid
    AND COALESCE(gm.status, 'active') = 'active';
END;
$function$;
REVOKE ALL ON FUNCTION public.update_expense(uuid, text, numeric, uuid, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_expense(uuid, text, numeric, uuid, text, jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_expense(_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT group_id INTO v_group_id
  FROM public.expenses WHERE id = _expense_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_active(v_group_id)
     OR NOT (public.is_group_member(v_group_id) OR public.is_group_owner(v_group_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'expense_delete_forbidden';
  END IF;
  IF EXISTS (SELECT 1 FROM public.expense_obligations WHERE expense_id = _expense_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'expense_has_financial_history';
  END IF;
  DELETE FROM public.expense_participants WHERE expense_id = _expense_id;
  DELETE FROM public.expenses WHERE id = _expense_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_obligation_paid(
  _obligation_id uuid,
  _payment_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment numeric(12,2) := round(_payment_amount, 2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF v_payment IS NULL OR v_payment <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_payment_amount';
  END IF;

  SELECT * INTO v_obligation
  FROM public.expense_obligations
  WHERE id = _obligation_id AND debtor_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_obligation.status <> 'unpaid' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'obligation_not_payable';
  END IF;
  IF v_payment > v_obligation.amount - v_obligation.paid_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_exceeds_remaining_amount';
  END IF;

  INSERT INTO public.expense_payments (obligation_id, amount, status, created_by)
  VALUES (_obligation_id, v_payment, 'pending', auth.uid());
  UPDATE public.expense_obligations
  SET status = 'payment_pending_confirmation',
      pending_payment_amount = v_payment,
      marked_at = now()
  WHERE id = _obligation_id;

  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.creditor_id, auth.uid(), 'expense_payment_pending',
          'expense_obligation', _obligation_id, jsonb_build_object('amount', v_payment));
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_obligation_payment(_obligation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment_id uuid;
  v_debtor uuid;
  v_payment numeric(12,2);
  v_paid numeric(12,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT * INTO v_obligation
  FROM public.expense_obligations
  WHERE id = _obligation_id AND creditor_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_obligation.status <> 'payment_pending_confirmation' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found';
  END IF;

  SELECT id, amount, created_by INTO v_payment_id, v_payment, v_debtor
  FROM public.expense_payments
  WHERE obligation_id = _obligation_id AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND OR v_debtor <> v_obligation.debtor_id THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found';
  END IF;

  v_paid := v_obligation.paid_amount + v_payment;
  UPDATE public.expense_payments SET status = 'confirmed', confirmed_at = now()
  WHERE id = v_payment_id;
  UPDATE public.expense_obligations
  SET paid_amount = v_paid,
      pending_payment_amount = NULL,
      status = CASE WHEN v_paid >= amount THEN 'settled' ELSE 'unpaid' END,
      confirmed_at = CASE WHEN v_paid >= amount THEN now() ELSE confirmed_at END,
      marked_at = NULL
  WHERE id = _obligation_id;

  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.debtor_id, auth.uid(), 'expense_payment_confirmed',
          'expense_obligation', _obligation_id,
          jsonb_build_object('amount', v_payment, 'paid_total', v_paid));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_obligation_payment(_obligation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT * INTO v_obligation
  FROM public.expense_obligations
  WHERE id = _obligation_id AND creditor_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND OR v_obligation.status <> 'payment_pending_confirmation' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found';
  END IF;

  UPDATE public.expense_payments
  SET status = 'rejected', rejected_at = now()
  WHERE obligation_id = _obligation_id AND status = 'pending'
  RETURNING id INTO v_payment_id;
  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found';
  END IF;

  UPDATE public.expense_obligations
  SET status = 'unpaid', pending_payment_amount = NULL, marked_at = NULL
  WHERE id = _obligation_id;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.debtor_id, auth.uid(), 'expense_payment_rejected',
          'expense_obligation', _obligation_id,
          jsonb_build_object('amount', v_obligation.pending_payment_amount));
END;
$function$;

-- The legacy one-argument function must not bypass payment history.
CREATE OR REPLACE FUNCTION public.mark_obligation_paid(_obligation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_remaining numeric(12,2);
BEGIN
  SELECT amount - paid_amount INTO v_remaining
  FROM public.expense_obligations
  WHERE id = _obligation_id AND debtor_id = auth.uid() AND status = 'unpaid';
  IF NOT FOUND THEN RAISE EXCEPTION 'obligation_not_payable'; END IF;
  PERFORM public.mark_obligation_paid(_obligation_id, v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_obligation_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_obligation_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_obligation_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_obligation_paid(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_obligation_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_obligation_payment(uuid) TO authenticated;

-- Permanent group deletion must not erase financial or payment history.
CREATE OR REPLACE FUNCTION public.permanently_delete_archived_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND owner_id = auth.uid() AND status = 'archived'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'archived_group_owner_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.expenses WHERE group_id = _group_id) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'group_has_financial_history';
  END IF;

  DELETE FROM public.meeting_participants
  WHERE meeting_id IN (SELECT id FROM public.meetings WHERE group_id = _group_id);
  DELETE FROM public.trip_participants
  WHERE trip_id IN (SELECT id FROM public.trips WHERE group_id = _group_id);
  DELETE FROM public.group_invitations WHERE group_id = _group_id;
  DELETE FROM public.meetings WHERE group_id = _group_id;
  DELETE FROM public.trips WHERE group_id = _group_id;
  DELETE FROM public.group_members WHERE group_id = _group_id;
  DELETE FROM public.groups WHERE id = _group_id;
END;
$function$;

COMMIT;
