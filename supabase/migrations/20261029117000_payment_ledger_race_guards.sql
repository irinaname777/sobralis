BEGIN;

-- Reassert the legacy overload ACL in case it exists in production; do not
-- drop it because database objects may depend on its signature.
DO $block$
BEGIN
  IF to_regprocedure('public.update_expense(uuid,numeric,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.update_expense(uuid,numeric,text,jsonb) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$block$;

-- Idempotency keys are global to the ledger: even a different account or
-- obligation cannot accidentally claim an already-used request UUID.
DROP INDEX IF EXISTS public.expense_payments_creator_request_id_idx;
CREATE UNIQUE INDEX IF NOT EXISTS expense_payments_request_id_key
  ON public.expense_payments (request_id);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.expense_payments'::regclass
      AND conname = 'expense_payments_resolution_fields_valid'
  ) THEN
    ALTER TABLE public.expense_payments
      ADD CONSTRAINT expense_payments_resolution_fields_valid CHECK (
    (status = 'pending'
      AND confirmed_at IS NULL AND confirmed_by IS NULL
      AND rejected_at IS NULL AND rejected_by IS NULL)
    OR (status = 'confirmed'
      AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL
      AND rejected_at IS NULL AND rejected_by IS NULL)
    OR (status = 'rejected'
      AND rejected_at IS NOT NULL AND rejected_by IS NOT NULL
      AND confirmed_at IS NULL AND confirmed_by IS NULL)
      );
  END IF;
END;
$migration$;

-- API clients can read their obligations, but may only mutate them through the
-- payment RPCs below. SECURITY DEFINER owners retain their table access.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.expense_obligations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.expense_obligations TO authenticated;
REVOKE ALL ON public.expense_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.expense_payments TO authenticated;

-- Return the ledger row ID. A retry returns that same ID; a reused key for a
-- different user, amount, obligation, or expense is rejected.
DROP FUNCTION public.mark_obligation_paid(uuid, numeric, uuid);
CREATE FUNCTION public.mark_obligation_paid(
  _obligation_id uuid,
  _payment_amount numeric,
  _request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expense_id uuid;
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment numeric(12,2) := round(_payment_amount, 2);
  v_existing public.expense_payments%ROWTYPE;
  v_payment_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF _request_id IS NULL OR v_payment IS NULL OR v_payment::text = 'NaN' OR v_payment <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_payment_request';
  END IF;

  -- Serialize the same key globally before lookup/insert, including calls made
  -- simultaneously by different authenticated users.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_request_id::text, 0)
  );
  SELECT * INTO v_existing
  FROM public.expense_payments
  WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_existing.created_by <> v_uid
       OR v_existing.obligation_id <> _obligation_id
       OR v_existing.amount <> v_payment THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_key_reused';
    END IF;
    RETURN v_existing.id;
  END IF;

  -- Match update_expense/delete_expense lock order: expense first, obligation
  -- second. This prevents an edit/delete from passing its no-history check
  -- while a payment is being inserted.
  SELECT expense_id INTO v_expense_id
  FROM public.expense_obligations
  WHERE id = _obligation_id AND debtor_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'obligation_not_payable';
  END IF;
  PERFORM 1 FROM public.expenses WHERE id = v_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'obligation_not_payable';
  END IF;
  SELECT * INTO v_obligation
  FROM public.expense_obligations
  WHERE id = _obligation_id AND expense_id = v_expense_id AND debtor_id = v_uid
  FOR UPDATE;
  IF NOT FOUND OR v_obligation.status <> 'unpaid' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'obligation_not_payable';
  END IF;
  IF v_payment > v_obligation.amount - v_obligation.paid_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_exceeds_remaining_amount';
  END IF;

  INSERT INTO public.expense_payments
    (obligation_id, amount, status, created_by, request_id)
  VALUES (_obligation_id, v_payment, 'pending', v_uid, _request_id)
  RETURNING id INTO v_payment_id;
  UPDATE public.expense_obligations
  SET status = 'payment_pending_confirmation',
      pending_payment_amount = v_payment,
      marked_at = now()
  WHERE id = _obligation_id;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.creditor_id, v_uid, 'expense_payment_pending',
          'expense_obligation', _obligation_id, jsonb_build_object('amount', v_payment));
  RETURN v_payment_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid, numeric, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_obligation_paid(uuid, numeric, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_obligation_payment(_obligation_id uuid, _payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_expense_id uuid;
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment public.expense_payments%ROWTYPE;
  v_paid numeric(12,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT expense_id INTO v_expense_id FROM public.expense_obligations
  WHERE id = _obligation_id AND creditor_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  PERFORM 1 FROM public.expenses WHERE id = v_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  SELECT * INTO v_obligation FROM public.expense_obligations
  WHERE id = _obligation_id AND expense_id = v_expense_id AND creditor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  SELECT * INTO v_payment FROM public.expense_payments
  WHERE id = _payment_id AND obligation_id = _obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  IF v_payment.status = 'confirmed' AND v_payment.confirmed_by = auth.uid() THEN RETURN; END IF;
  IF v_payment.status <> 'pending' OR v_obligation.status <> 'payment_pending_confirmation'
     OR v_payment.created_by <> v_obligation.debtor_id THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found';
  END IF;
  v_paid := v_obligation.paid_amount + v_payment.amount;
  UPDATE public.expense_payments SET status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
  WHERE id = _payment_id;
  UPDATE public.expense_obligations
  SET paid_amount = v_paid, pending_payment_amount = NULL,
      status = CASE WHEN v_paid >= amount THEN 'settled' ELSE 'unpaid' END,
      confirmed_at = CASE WHEN v_paid >= amount THEN now() ELSE confirmed_at END,
      marked_at = NULL
  WHERE id = _obligation_id;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.debtor_id, auth.uid(), 'expense_payment_confirmed',
          'expense_obligation', _obligation_id,
          jsonb_build_object('amount', v_payment.amount, 'paid_total', v_paid));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_obligation_payment(_obligation_id uuid, _payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_expense_id uuid;
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment public.expense_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT expense_id INTO v_expense_id FROM public.expense_obligations
  WHERE id = _obligation_id AND creditor_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  PERFORM 1 FROM public.expenses WHERE id = v_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  SELECT * INTO v_obligation FROM public.expense_obligations
  WHERE id = _obligation_id AND expense_id = v_expense_id AND creditor_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  SELECT * INTO v_payment FROM public.expense_payments
  WHERE id = _payment_id AND obligation_id = _obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found'; END IF;
  IF v_payment.status = 'rejected' AND v_payment.rejected_by = auth.uid() THEN RETURN; END IF;
  IF v_payment.status <> 'pending' OR v_obligation.status <> 'payment_pending_confirmation'
     OR v_payment.created_by <> v_obligation.debtor_id THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pending_payment_not_found';
  END IF;
  UPDATE public.expense_payments SET status = 'rejected', rejected_at = now(), rejected_by = auth.uid()
  WHERE id = _payment_id;
  UPDATE public.expense_obligations
  SET status = 'unpaid', pending_payment_amount = NULL, marked_at = NULL
  WHERE id = _obligation_id;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.debtor_id, auth.uid(), 'expense_payment_rejected',
          'expense_obligation', _obligation_id, jsonb_build_object('amount', v_payment.amount));
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_obligation_payment(uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.reject_obligation_payment(uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.confirm_obligation_payment(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_obligation_payment(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_obligation_payment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_obligation_payment(uuid, uuid) TO authenticated;

COMMIT;
