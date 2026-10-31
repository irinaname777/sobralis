-- Static database contract checks. Run against a disposable local Supabase DB
-- after every migration is applied: psql -v ON_ERROR_STOP=1 -f this_file.sql
BEGIN;

DO $test$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'profiles', 'groups', 'group_members', 'group_invitations', 'cycle_settings',
    'meetings', 'meeting_participants', 'trips', 'trip_participants', 'expenses',
    'expense_participants', 'notifications', 'expense_obligations'
  ];
BEGIN
  IF to_regprocedure('public.registration_is_complete()') IS NULL THEN
    RAISE EXCEPTION 'registration_is_complete is missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.registration_is_complete()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.registration_is_complete()', 'EXECUTE') THEN
    RAISE EXCEPTION 'registration_is_complete grants are incorrect';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed', 'UPDATE') THEN
    RAISE EXCEPTION 'clients can create or self-complete a profile';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') THEN
    RAISE EXCEPTION 'profile display-name update was removed';
  END IF;

  IF has_table_privilege('authenticated', 'public.legal_consent_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.legal_consent_events', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.legal_consent_events', 'DELETE') THEN
    RAISE EXCEPTION 'clients can mutate legal consent events';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.legal_consent_events'::regclass
      AND tgname = 'legal_consent_events_append_only' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only consent trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.legal_consent_events'::regclass
      AND tgname = 'legal_consent_events_require_existing_user' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'deleted users can still write consent events with old JWTs';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = format('public.%I', v_table)::regclass) THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
        AND policyname = 'require_completed_registration' AND permissive = 'RESTRICTIVE'
    ) THEN
      RAISE EXCEPTION 'registration gate is missing on public.%', v_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.join_group_by_invite(text)') IS NULL
     OR NOT has_function_privilege('authenticated', 'public.join_group_by_invite(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.join_group_by_invite(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'invite join RPC grants are incorrect';
  END IF;

  IF to_regprocedure('public.delete_my_account()') IS NULL
     OR NOT has_function_privilege('authenticated', 'public.delete_my_account()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.delete_my_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'account deletion RPC grants are incorrect';
  END IF;

  IF to_regclass('public.expense_payments') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
             WHERE oid = 'public.expense_payments'::regclass)
     OR has_table_privilege('authenticated', 'public.expense_payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.expense_payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.expense_payments', 'DELETE') THEN
    RAISE EXCEPTION 'payment history is missing RLS or is client-writable';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.mark_obligation_paid(uuid,numeric,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_obligation_paid(uuid,numeric,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_obligation_paid(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_obligation_paid(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.confirm_obligation_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.confirm_obligation_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirm_obligation_payment(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.reject_obligation_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reject_obligation_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.mark_obligation_paid(uuid,numeric,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.confirm_obligation_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.reject_obligation_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reject_obligation_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'payment RPC grants are incorrect';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND tablename = 'expense_payments'
      AND indexname = 'expense_payments_request_id_key' AND indexdef LIKE '%UNIQUE% (request_id)%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.expense_payments'::regclass
      AND tgname = 'expense_payments_immutable_history' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'payment idempotency or immutable history contract is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'expense_payments'
      AND policyname = 'expense_payments_require_completed_registration'
      AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'payment history is missing the registration gate';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname IN ('mark_obligation_paid', 'confirm_obligation_payment', 'reject_obligation_payment')
      AND p.prosecdef
      AND owner_role.rolname IN ('anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'a payment SECURITY DEFINER function is owned by an API role';
  END IF;
  IF has_table_privilege('authenticated', 'public.expense_obligations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.expense_obligations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.expense_obligations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.expense_payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.expense_payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.expense_payments', 'DELETE') THEN
    RAISE EXCEPTION 'clients can bypass the financial RPCs with direct table writes';
  END IF;
  IF has_table_privilege('authenticated', 'public.expenses', 'UPDATE')
     OR NOT has_function_privilege('authenticated', 'public.update_expense(uuid,text,numeric,uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_expense(uuid,text,numeric,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'expense edits bypass the authorised atomic RPC';
  END IF;
  IF to_regprocedure('public.update_expense(uuid,numeric,text,jsonb)') IS NOT NULL
     AND (
       has_function_privilege('anon', 'public.update_expense(uuid,numeric,text,jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.update_expense(uuid,numeric,text,jsonb)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.update_expense(uuid,numeric,text,jsonb)', 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'legacy update_expense overload is executable by an API role';
  END IF;
  IF has_table_privilege('authenticated', 'public.expenses', 'INSERT')
     OR has_table_privilege('authenticated', 'public.expenses', 'DELETE')
     OR has_table_privilege('authenticated', 'public.expense_participants', 'INSERT')
     OR has_table_privilege('authenticated', 'public.expense_participants', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.expense_participants', 'DELETE')
     OR NOT has_function_privilege('authenticated', 'public.create_expense(uuid,text,numeric,uuid,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.delete_expense(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'expense records can bypass atomic and history-preserving RPCs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.expense_participants'::regclass
      AND tgname = 'expense_participants_protect_payment_history' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'expense split edits can rewrite payment history';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.groups'::regclass
      AND conname = 'groups_owner_id_fkey' AND confdeltype = 'n'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.meetings'::regclass
      AND conname = 'meetings_created_by_fkey' AND confdeltype = 'n'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.trips'::regclass
      AND conname = 'trips_created_by_fkey' AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'account deletion would cascade shared groups or events';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND NOT COALESCE(array_to_string(p.proconfig, ','), '')
        LIKE '%search_path=pg_catalog, public, pg_temp%'
  ) THEN
    RAISE EXCEPTION 'a SECURITY DEFINER function lacks the hardened search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.cycle_settings'::regclass
      AND tgname = 'cycle_settings_require_health_consent' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'cycle consent write gate is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'find_best_cycle_dates'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'cycle date finder RPC grants are incorrect';
  END IF;
END;
$test$;

ROLLBACK;
