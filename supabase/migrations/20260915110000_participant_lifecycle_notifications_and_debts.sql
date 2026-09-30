/* Explicit RSVP, in-app notifications, and per-expense payment verification. */
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'accepted', 'active', 'removed')), ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE public.meeting_participants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'declined', 'counter_proposed')), ADD COLUMN IF NOT EXISTS counter_date date, ADD COLUMN IF NOT EXISTS counter_time text, ADD COLUMN IF NOT EXISTS counter_location text;
ALTER TABLE public.trip_participants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'declined', 'counter_proposed')), ADD COLUMN IF NOT EXISTS counter_date date, ADD COLUMN IF NOT EXISTS counter_time text, ADD COLUMN IF NOT EXISTS counter_location text;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, type text NOT NULL, entity_type text, entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON public.notifications(recipient_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated USING (recipient_id = auth.uid());
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.expense_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  debtor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, creditor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0), status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'payment_pending_confirmation', 'settled', 'archived')),
  marked_at timestamptz, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(expense_id, debtor_id, creditor_id), CHECK (debtor_id <> creditor_id)
);
CREATE INDEX IF NOT EXISTS idx_expense_obligations_debtor ON public.expense_obligations(debtor_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_obligations_creditor ON public.expense_obligations(creditor_id, status);
ALTER TABLE public.expense_obligations ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.can_access_expense_obligation(_expense_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = _expense_id AND (public.is_group_member(e.group_id) OR public.is_group_owner(e.group_id)));
$$;
REVOKE ALL ON FUNCTION public.can_access_expense_obligation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_expense_obligation(uuid) TO authenticated;
CREATE POLICY "obligations_select_parties" ON public.expense_obligations FOR SELECT TO authenticated USING (debtor_id = auth.uid() OR creditor_id = auth.uid() OR public.can_access_expense_obligation(expense_id));

CREATE OR REPLACE FUNCTION public.create_expense_obligation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE payer uuid;
BEGIN
  SELECT paid_by INTO payer FROM public.expenses WHERE id = NEW.expense_id;
  IF NEW.user_id <> payer AND NEW.share_amount > 0 THEN
    INSERT INTO public.expense_obligations (expense_id, debtor_id, creditor_id, amount) VALUES (NEW.expense_id, NEW.user_id, payer, NEW.share_amount)
    ON CONFLICT (expense_id, debtor_id, creditor_id) DO UPDATE SET amount = EXCLUDED.amount;
    INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload) VALUES (NEW.user_id, payer, 'expense_debt_created', 'expense', NEW.expense_id, jsonb_build_object('amount', NEW.share_amount, 'creditor_id', payer));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS expense_participant_creates_obligation ON public.expense_participants;
CREATE TRIGGER expense_participant_creates_obligation AFTER INSERT OR UPDATE OF share_amount ON public.expense_participants FOR EACH ROW EXECUTE FUNCTION public.create_expense_obligation();

CREATE OR REPLACE FUNCTION public.notify_event_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE organizer uuid; event_title text; event_kind text; event_uuid uuid;
BEGIN
  IF TG_TABLE_NAME = 'meeting_participants' THEN SELECT created_by, title, id INTO organizer, event_title, event_uuid FROM public.meetings WHERE id = NEW.meeting_id; event_kind := 'meeting';
  ELSE SELECT created_by, title, id INTO organizer, event_title, event_uuid FROM public.trips WHERE id = NEW.trip_id; event_kind := 'trip'; END IF;
  IF NEW.user_id <> organizer AND NEW.status = 'pending' THEN INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload) VALUES (NEW.user_id, organizer, event_kind || '_invitation', event_kind, event_uuid, jsonb_build_object('title', event_title)); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS meeting_participant_notification ON public.meeting_participants;
CREATE TRIGGER meeting_participant_notification AFTER INSERT ON public.meeting_participants FOR EACH ROW EXECUTE FUNCTION public.notify_event_invitation();
DROP TRIGGER IF EXISTS trip_participant_notification ON public.trip_participants;
CREATE TRIGGER trip_participant_notification AFTER INSERT ON public.trip_participants FOR EACH ROW EXECUTE FUNCTION public.notify_event_invitation();

CREATE OR REPLACE FUNCTION public.respond_to_event_invitation(_kind text, _event_id uuid, _status text, _counter_date date DEFAULT NULL, _counter_time text DEFAULT NULL, _counter_location text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE organizer uuid; title_text text;
BEGIN
  IF _kind NOT IN ('meeting', 'trip') OR _status NOT IN ('accepted', 'declined', 'counter_proposed') THEN RAISE EXCEPTION 'Invalid invitation response'; END IF;
  IF _kind = 'meeting' THEN
    UPDATE public.meeting_participants SET status = _status, counter_date = _counter_date, counter_time = _counter_time, counter_location = _counter_location WHERE meeting_id = _event_id AND user_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
    SELECT created_by, title INTO organizer, title_text FROM public.meetings WHERE id = _event_id;
  ELSE
    UPDATE public.trip_participants SET status = _status, counter_date = _counter_date, counter_time = _counter_time, counter_location = _counter_location WHERE trip_id = _event_id AND user_id = auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
    SELECT created_by, title INTO organizer, title_text FROM public.trips WHERE id = _event_id;
  END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload) VALUES (organizer, auth.uid(), _kind || '_' || _status, _kind, _event_id, jsonb_build_object('title', title_text));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_obligation_paid(_obligation_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE creditor uuid; expense uuid;
BEGIN
  UPDATE public.expense_obligations SET status = 'payment_pending_confirmation', marked_at = now() WHERE id = _obligation_id AND debtor_id = auth.uid() AND status = 'unpaid' RETURNING creditor_id, expense_id INTO creditor, expense;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unpaid obligation not found for debtor'; END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload) VALUES (creditor, auth.uid(), 'expense_payment_pending', 'expense_obligation', _obligation_id, jsonb_build_object('expense_id', expense));
END;
$$;
CREATE OR REPLACE FUNCTION public.confirm_obligation_payment(_obligation_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE debtor uuid; expense uuid;
BEGIN
  UPDATE public.expense_obligations SET status = 'settled', confirmed_at = now() WHERE id = _obligation_id AND creditor_id = auth.uid() AND status = 'payment_pending_confirmation' RETURNING debtor_id, expense_id INTO debtor, expense;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending obligation not found for creditor'; END IF;
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id, payload) VALUES (debtor, auth.uid(), 'expense_payment_confirmed', 'expense_obligation', _obligation_id, jsonb_build_object('expense_id', expense));
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_event_invitation(text, uuid, text, date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_obligation_paid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_obligation_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_event_invitation(text, uuid, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_obligation_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_obligation_payment(uuid) TO authenticated;

-- Any active group participant may invite; joining informs the existing members.
DROP POLICY IF EXISTS "invitations_insert_owner" ON public.group_invitations;
CREATE POLICY "invitations_insert_owner" ON public.group_invitations FOR INSERT TO authenticated WITH CHECK (
  public.is_group_active(group_id) AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
);

CREATE OR REPLACE FUNCTION public.notify_group_member_added() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  SELECT gm.user_id, NEW.user_id, 'group_participant_added', 'group', NEW.group_id
  FROM public.group_members gm
  WHERE gm.group_id = NEW.group_id AND gm.user_id <> NEW.user_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS group_member_added_notification ON public.group_members;
CREATE TRIGGER group_member_added_notification AFTER INSERT ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.notify_group_member_added();

CREATE OR REPLACE FUNCTION public.notify_group_member_removed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, type, entity_type, entity_id)
  SELECT gm.user_id, auth.uid(), 'group_participant_removed', 'group', OLD.group_id
  FROM public.group_members gm WHERE gm.group_id = OLD.group_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS group_member_removed_notification ON public.group_members;
CREATE TRIGGER group_member_removed_notification AFTER DELETE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.notify_group_member_removed();

-- A former participant retains read access to her own financial history only.
CREATE OR REPLACE FUNCTION public.is_expense_participant(_expense_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.expense_participants WHERE expense_id = _expense_id AND user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_expense_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_expense_participant(uuid) TO authenticated;
DROP POLICY IF EXISTS "expenses_select_member" ON public.expenses;
CREATE POLICY "expenses_select_member" ON public.expenses FOR SELECT TO authenticated USING (
  public.is_group_member(group_id) OR public.is_group_owner(group_id) OR public.is_expense_participant(id)
);
DROP POLICY IF EXISTS "expense_participants_select_member" ON public.expense_participants;
CREATE POLICY "expense_participants_select_member" ON public.expense_participants FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.can_access_expense_obligation(expense_id)
);
