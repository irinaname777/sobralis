"""Offline source-contract checks for the PostgreSQL payment ledger.

These checks require only Python's standard library. They guard critical SQL
ordering and ACL contracts; they do not execute PL/pgSQL or replace local DB
integration/concurrency tests.
"""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
TESTS = ROOT / "supabase" / "tests"


def function_body(sql: str, name: str) -> str:
    match = re.search(
        rf"CREATE(?: OR REPLACE)? FUNCTION public\.{re.escape(name)}\b.*?"
        rf"AS \$function\$(.*?)\$function\$;",
        sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        raise AssertionError(f"function {name} not found")
    return match.group(1).lower()


class PaymentLedgerSqlContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ledger = (MIGRATIONS / "20261029114000_expense_payment_ledger.sql").read_text()
        cls.idempotency = (MIGRATIONS / "20261029116000_idempotent_expense_payments.sql").read_text()
        cls.race_guards = (MIGRATIONS / "20261029117000_payment_ledger_race_guards.sql").read_text()
        cls.cycle_acl = (MIGRATIONS / "20261029111000_health_consent_gate.sql").read_text()
        cls.cycle_finder = (MIGRATIONS / "20261029115000_cycle_date_finder.sql").read_text()
        cls.calendar = (ROOT / "src" / "pages" / "CalendarPage.tsx").read_text()
        cls.cycle_settings_page = (ROOT / "src" / "pages" / "CycleSettingsPage.tsx").read_text()

    def test_migration_order_and_global_unique_request_key(self) -> None:
        names = [
            "20261029114000_expense_payment_ledger.sql",
            "20261029116000_idempotent_expense_payments.sql",
            "20261029117000_payment_ledger_race_guards.sql",
        ]
        self.assertEqual(names, sorted(names))
        self.assertIn("drop index if exists public.expense_payments_creator_request_id_idx", self.race_guards.lower())
        self.assertRegex(
            self.race_guards.lower(),
            r"create unique index(?: if not exists)? expense_payments_request_id_key\s+on public\.expense_payments\s*\(request_id\)",
        )

    def test_historical_payment_transfer_preserves_debtor_and_creditor_roles(self) -> None:
        normalized = re.sub(r"\s+", " ", self.ledger).lower()
        self.assertIn("set paid_amount = amount where status = 'settled' and paid_amount = 0", normalized)
        self.assertIn("set pending_payment_amount = amount - paid_amount where status = 'payment_pending_confirmation'", normalized)
        self.assertIn("select id, amount, 'confirmed', debtor_id, coalesce(confirmed_at, now())", normalized)
        self.assertIn("where status = 'settled' and paid_amount > 0", normalized)
        self.assertIn("select id, pending_payment_amount, 'pending', debtor_id", normalized)
        resolved = re.sub(r"\s+", " ", self.idempotency).lower()
        self.assertIn("set confirmed_by = o.creditor_id", resolved)
        self.assertIn("where o.id = p.obligation_id and p.status = 'confirmed'", resolved)

    def test_legacy_update_expense_overload_is_conditionally_revoked(self) -> None:
        signature = "public.update_expense(uuid,numeric,text,jsonb)"
        for migration in (self.ledger, self.race_guards):
            normalized = re.sub(r"\s+", " ", migration).lower()
            self.assertIn(f"to_regprocedure('{signature}') is not null", normalized)
            self.assertIn(
                f"revoke all on function {signature} from public, anon, authenticated, service_role",
                normalized,
            )
            self.assertNotIn("drop function if exists public.update_expense", normalized)
        security_test = (TESTS / "security_contracts.sql").read_text().lower()
        self.assertIn("has_function_privilege('anon', 'public.update_expense(uuid,numeric,text,jsonb)', 'execute')", security_test)
        self.assertIn("has_function_privilege('authenticated', 'public.update_expense(uuid,numeric,text,jsonb)', 'execute')", security_test)
        self.assertIn("has_function_privilege('service_role', 'public.update_expense(uuid,numeric,text,jsonb)', 'execute')", security_test)
        self.assertIn("select id, pending_payment_amount, 'pending', debtor_id", re.sub(r"\s+", " ", self.ledger).lower())
        self.assertIn("'confirmed', debtor_id", re.sub(r"\s+", " ", self.ledger).lower())

    def test_same_key_is_serialized_and_returns_original_payment(self) -> None:
        body = function_body(self.race_guards, "mark_obligation_paid")
        lock_at = body.index("pg_advisory_xact_lock")
        lookup_at = body.index("where request_id = _request_id")
        insert_at = body.index("insert into public.expense_payments")
        self.assertLess(lock_at, lookup_at)
        self.assertLess(lookup_at, insert_at)
        self.assertIn("return v_existing.id", body)
        self.assertIn("v_existing.created_by <> v_uid", body)
        self.assertIn("v_existing.obligation_id <> _obligation_id", body)
        self.assertIn("v_existing.amount <> v_payment", body)
        self.assertIn("idempotency_key_reused", body)

    def test_payment_amount_validation_and_expense_edit_share_lock_order(self) -> None:
        body = function_body(self.race_guards, "mark_obligation_paid")
        expense_lock_at = body.index("from public.expenses where id = v_expense_id for update")
        obligation_lock_at = body.index("from public.expense_obligations\n  where id = _obligation_id and expense_id = v_expense_id", expense_lock_at)
        obligation_lock_end = body.index("for update", obligation_lock_at)
        balance_check_at = body.index("v_payment > v_obligation.amount - v_obligation.paid_amount")
        insert_at = body.index("insert into public.expense_payments")
        self.assertLess(expense_lock_at, obligation_lock_at)
        self.assertLess(obligation_lock_end, balance_check_at)
        self.assertLess(balance_check_at, insert_at)
        self.assertIn("payment_exceeds_remaining_amount", body)

    def test_confirmation_and_rejection_are_payment_specific_and_serialized(self) -> None:
        for function, final_status, actor_column in (
            ("confirm_obligation_payment", "confirmed", "confirmed_by"),
            ("reject_obligation_payment", "rejected", "rejected_by"),
        ):
            body = function_body(self.race_guards, function)
            self.assertIn("creditor_id = auth.uid()", body)
            self.assertIn("where id = _payment_id and obligation_id = _obligation_id for update", body)
            self.assertIn("v_payment.status <> 'pending'", body)
            self.assertIn(f"set status = '{final_status}'", body)
            self.assertIn(actor_column, body)
            self.assertIn("from public.expenses where id = v_expense_id for update", body)
        self.assertIn("v_payment.status = 'confirmed' AND v_payment.confirmed_by = auth.uid()".lower(), function_body(self.race_guards, "confirm_obligation_payment"))
        self.assertIn("v_payment.status = 'rejected' AND v_payment.rejected_by = auth.uid()".lower(), function_body(self.race_guards, "reject_obligation_payment"))

    def test_history_transitions_and_direct_writes_are_closed(self) -> None:
        trigger = function_body(self.idempotency, "protect_expense_payment_history")
        self.assertIn("old.status <> 'pending'", trigger)
        self.assertIn("new.status not in ('confirmed', 'rejected')", trigger)
        self.assertIn("new.amount is distinct from old.amount", trigger)
        self.assertIn("new.obligation_id is distinct from old.obligation_id", trigger)
        self.assertIn("new.request_id is distinct from old.request_id", trigger)
        self.assertIn("payment_history_is_immutable", trigger)
        self.assertIn("revoke insert, update, delete, truncate, references, trigger", self.race_guards.lower())
        self.assertIn("on public.expense_obligations from public, anon, authenticated, service_role", self.race_guards.lower())
        self.assertIn("revoke all on public.expense_payments from public, anon, authenticated, service_role", self.race_guards.lower())
        self.assertIn("expense_payments_resolution_fields_valid", self.race_guards.lower())
        delete_expense = function_body(self.ledger, "delete_expense")
        self.assertIn("exists (select 1 from public.expense_obligations", delete_expense)
        self.assertLess(delete_expense.index("expense_has_financial_history"), delete_expense.index("delete from public.expenses"))

    def test_unrelated_users_cannot_confirm_or_read_payment_rows(self) -> None:
        confirm = function_body(self.race_guards, "confirm_obligation_payment")
        reject = function_body(self.race_guards, "reject_obligation_payment")
        self.assertIn("where id = _obligation_id and creditor_id = auth.uid()", confirm)
        self.assertIn("where id = _obligation_id and creditor_id = auth.uid()", reject)
        self.assertIn("where id = _payment_id and obligation_id = _obligation_id", confirm)
        self.assertIn("where id = _payment_id and obligation_id = _obligation_id", reject)
        self.assertIn("expense_payments_select_group_members", self.ledger.lower())
        self.assertIn("o.debtor_id = auth.uid() or o.creditor_id = auth.uid()", self.ledger.lower())

    def test_payment_amount_is_returned_as_stable_rpc_result(self) -> None:
        body = function_body(self.race_guards, "mark_obligation_paid")
        self.assertRegex(self.race_guards.lower(), r"create function public\.mark_obligation_paid\([\s\S]*?\)\s*returns uuid")
        self.assertIn("return v_existing.id", body)
        self.assertIn("return v_payment_id", body)

    def test_expense_split_total_is_exact_after_storage_rounding(self) -> None:
        for function in ("create_expense", "update_expense"):
            body = function_body(self.ledger, function)
            self.assertIn("round(sum(round((entry.value ->> 'share_amount')::numeric, 2)), 2)", body)
            self.assertIn("v_sum <> round(_amount, 2)", body)
            self.assertIn("::numeric <> round((v_item.value ->> 'share_amount')::numeric, 2)", body)

    def test_old_unkeyed_rpcs_are_revoked_and_current_functions_are_hardened(self) -> None:
        sql = self.idempotency.lower() + self.race_guards.lower()
        self.assertIn("revoke all on function public.mark_obligation_paid(uuid, numeric)", sql)
        self.assertIn("revoke all on function public.mark_obligation_paid(uuid)", sql)
        self.assertIn("revoke all on function public.confirm_obligation_payment(uuid)", sql)
        self.assertIn("revoke all on function public.reject_obligation_payment(uuid)", sql)
        for name in ("mark_obligation_paid", "confirm_obligation_payment", "reject_obligation_payment"):
            body = function_body(self.race_guards, name)
            self.assertIn("security definer", self.race_guards.lower())
            self.assertIn("set search_path = pg_catalog, public, pg_temp", self.race_guards.lower())

    def test_cycle_finder_stays_unavailable_through_all_known_paths(self) -> None:
        self.assertIn("const CYCLE_DATE_FINDER_ENABLED = false", self.calendar)
        self.assertIn("if (!CYCLE_DATE_FINDER_ENABLED", self.calendar)
        self.assertIn("p.proname = 'find_best_cycle_dates'", self.cycle_acl)
        self.assertIn("from public, anon, authenticated, service_role", re.sub(r"\s+", " ", self.cycle_acl).lower())
        normalized = re.sub(r"\s+", " ", self.cycle_finder).lower()
        self.assertIn("from public, anon, authenticated, service_role", normalized)
        self.assertNotRegex(self.cycle_finder, r"(?i)GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.find_best_cycle_dates")
        for client_sql in (self.calendar, self.cycle_settings_page):
            self.assertIn("hasCurrentHealthDataConsent".lower(), client_sql.lower())
            self.assertIn(".eq('user_id', user.id)", client_sql)
        self.assertIn("user_id = auth.uid()", self.cycle_acl)


if __name__ == "__main__":
    unittest.main()
