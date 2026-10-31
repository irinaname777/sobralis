BEGIN;

-- Auth access tokens are stateless and can remain valid until expiry. Reject
-- writes made through a still-valid token after its auth.users row is gone.
CREATE OR REPLACE FUNCTION public.require_existing_auth_user_for_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_existing_auth_user_for_consent()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS legal_consent_events_require_existing_user
  ON public.legal_consent_events;
CREATE TRIGGER legal_consent_events_require_existing_user
  BEFORE INSERT ON public.legal_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.require_existing_auth_user_for_consent();

-- Preserve collaborative events when their author account is removed.
ALTER TABLE public.groups ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_owner_id_fkey;
ALTER TABLE public.groups
  ADD CONSTRAINT groups_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.meetings ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_created_by_fkey;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.trips ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_created_by_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_iat bigint;
  v_group_id uuid;
  v_successor uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;

  v_iat := NULLIF(auth.jwt() ->> 'iat', '')::bigint;
  IF v_iat IS NULL OR to_timestamp(v_iat) < now() - interval '10 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account_deletion_requires_recent_login';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;

  -- Financial history cannot yet be detached from a participant without losing
  -- attribution. Stop before making any changes and preserve every ledger row.
  IF EXISTS (
    SELECT 1 FROM public.expenses
    WHERE paid_by = v_uid OR created_by = v_uid
  ) OR EXISTS (
    SELECT 1 FROM public.expense_participants WHERE user_id = v_uid
  ) OR EXISTS (
    SELECT 1 FROM public.expense_obligations
    WHERE debtor_id = v_uid OR creditor_id = v_uid
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'account_deletion_blocked_financial_records';
  END IF;

  -- Transfer each owned group to an active member. Groups with no successor are
  -- archived and become ownerless instead of cascading away with the account.
  FOR v_group_id IN
    SELECT id FROM public.groups WHERE owner_id = v_uid FOR UPDATE
  LOOP
    v_successor := NULL;
    SELECT user_id INTO v_successor
    FROM public.group_members
    WHERE group_id = v_group_id
      AND user_id <> v_uid
      AND COALESCE(status, 'active') = 'active'
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at, id
    LIMIT 1
    FOR UPDATE;

    IF v_successor IS NULL THEN
      UPDATE public.groups
      SET status = 'archived', owner_id = NULL
      WHERE id = v_group_id;
    ELSE
      UPDATE public.groups SET owner_id = v_successor WHERE id = v_group_id;
      UPDATE public.group_members SET role = 'member'
      WHERE group_id = v_group_id AND user_id = v_uid;
      UPDATE public.group_members SET role = 'owner'
      WHERE group_id = v_group_id AND user_id = v_successor;
    END IF;
  END LOOP;

  DELETE FROM public.cycle_settings WHERE user_id = v_uid;
  DELETE FROM public.profiles WHERE id = v_uid;

  -- The auth.users delete revokes the identity and cascades its sessions,
  -- personal memberships, notifications and cycle data. FK SET NULL rules above
  -- preserve groups and events shared with other people.
  DELETE FROM auth.users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

COMMIT;
