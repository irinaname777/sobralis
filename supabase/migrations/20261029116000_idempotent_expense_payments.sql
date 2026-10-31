BEGIN;

ALTER TABLE public.expense_payments
  ADD COLUMN request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN confirmed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN rejected_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX expense_payments_creator_request_id_idx
  ON public.expense_payments (created_by, request_id);

UPDATE public.expense_payments p
SET confirmed_by = o.creditor_id
FROM public.expense_obligations o
WHERE o.id = p.obligation_id AND p.status = 'confirmed';
UPDATE public.expense_payments p
SET rejected_by = o.creditor_id
FROM public.expense_obligations o
WHERE o.id = p.obligation_id AND p.status = 'rejected';

CREATE OR REPLACE FUNCTION public.protect_expense_payment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'payment_history_is_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.status <> 'pending'
     OR NEW.status NOT IN ('confirmed', 'rejected')
     OR (NEW.status = 'confirmed' AND (NEW.confirmed_by IS DISTINCT FROM auth.uid() OR NEW.confirmed_at IS NULL OR NEW.rejected_by IS NOT NULL OR NEW.rejected_at IS NOT NULL))
     OR (NEW.status = 'rejected' AND (NEW.rejected_by IS DISTINCT FROM auth.uid() OR NEW.rejected_at IS NULL OR NEW.confirmed_by IS NOT NULL OR NEW.confirmed_at IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'payment_history_is_immutable';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.protect_expense_payment_history() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER expense_payments_immutable_history
  BEFORE UPDATE OR DELETE ON public.expense_payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_expense_payment_history();

CREATE OR REPLACE FUNCTION public.mark_obligation_paid(
  _obligation_id uuid,
  _payment_amount numeric,
  _request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment numeric(12,2) := round(_payment_amount, 2);
  v_existing public.expense_payments%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF _request_id IS NULL OR v_payment IS NULL OR v_payment::text = 'NaN' OR v_payment <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_payment_request';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text || ':' || _request_id::text, 0)
  );
  SELECT * INTO v_existing FROM public.expense_payments
  WHERE created_by = v_uid AND request_id = _request_id;
  IF FOUND THEN
    IF v_existing.obligation_id <> _obligation_id OR v_existing.amount <> v_payment THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_key_reused';
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_obligation
  FROM public.expense_obligations
  WHERE id = _obligation_id AND debtor_id = v_uid
  FOR UPDATE;
  IF NOT FOUND OR v_obligation.status <> 'unpaid' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'obligation_not_payable';
  END IF;
  IF v_payment > v_obligation.amount - v_obligation.paid_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_exceeds_remaining_amount';
  END IF;

  INSERT INTO public.expense_payments
    (obligation_id, amount, status, created_by, request_id)
  VALUES (_obligation_id, v_payment, 'pending', v_uid, _request_id);
  UPDATE public.expense_obligations
  SET status = 'payment_pending_confirmation',
      pending_payment_amount = v_payment,
      marked_at = now()
  WHERE id = _obligation_id;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload)
  VALUES (v_obligation.creditor_id, v_uid, 'expense_payment_pending',
          'expense_obligation', _obligation_id, jsonb_build_object('amount', v_payment));
END;
$function$;

-- Old client signatures cannot create unkeyed payment attempts.
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_obligation_paid(uuid, numeric, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_obligation_payment(_obligation_id uuid, _payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment public.expense_payments%ROWTYPE;
  v_paid numeric(12,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT * INTO v_obligation FROM public.expense_obligations
  WHERE id = _obligation_id AND creditor_id = auth.uid() FOR UPDATE;
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
  v_obligation public.expense_obligations%ROWTYPE;
  v_payment public.expense_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.registration_is_complete() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  SELECT * INTO v_obligation FROM public.expense_obligations
  WHERE id = _obligation_id AND creditor_id = auth.uid() FOR UPDATE;
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

REVOKE ALL ON FUNCTION public.confirm_obligation_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_obligation_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_obligation_payment(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_obligation_payment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_obligation_payment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_obligation_payment(uuid, uuid) TO authenticated;

COMMIT;
