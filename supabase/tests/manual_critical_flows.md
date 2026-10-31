# Manual integration checks

Run these against a disposable local Supabase project only, after applying the
local migrations to that test project. Do not use production or a linked remote
database. `security_contracts.sql` checks catalog-level contracts; these flows
exercise real Auth, PostgREST, RPC and trigger behavior.

## Registration and recovery

1. Register without each required consent in turn. Expect the UI and Auth API to
   reject signup; verify no `auth.users`, profile or consent rows were committed.
2. Register with the required consents and without optional health consent.
   Confirm email, sign in, reload, and verify access after server validation.
   Optional consent rows must not prevent normal app access.
3. Attempt authenticated REST inserts/updates/deletes on
   `legal_consent_events`; expect permission/RLS denial.
4. Request a password reset, follow the email to `/reset-password`, update the
   password, then sign in with the new password. An expired link must not update
   the account.
5. Remove the test profile row in a disposable transaction/setup, then verify
   protected routes remain closed. Make the registration RPC fail and verify
   access remains closed with retry available.

## Invitations and groups

1. Join with a valid invitation. Verify exactly one membership and a claimed
   invite. Repeat the same request and verify it does not duplicate membership.
2. Try an expired, already claimed and unknown code; each must leave membership
   and invitation state unchanged.
3. Submit simultaneous joins for one single-use code from two test accounts;
   at most one account may claim it.
4. Try direct `group_members` insertion and invitation-use updates through the
   API; both must be denied. Verify public invitation lookup omits group
   description and does not disclose `used_by`.
5. Transfer/archive a group, restore it, and permanently delete it in the test
   project; verify other groups remain unchanged.

## Events, expenses and cycle data

1. Create a meeting and trip, submit date counters and RSVP as a participant;
   verify another participant cannot submit or confirm on their behalf.
2. Exercise schedule-conflict validation with overlapping dates, including
   concurrent submissions.
3. Create equal and manual expenses, update a split, submit a partial payment,
   retry the same request ID after a simulated lost response and verify only one
   ledger entry exists; retry the same ID with a changed amount and expect a
   conflict. Reuse it from another user or for another obligation and expect
   `idempotency_key_reused` without disclosure of the original row. Confirm it
   as creditor, retry confirmation and verify it is
   idempotent, then verify the remainder can be paid in a second
   installment. Reject another pending payment and verify it remains in the
   payment history without changing the paid total. Attempt payment actions as
   unrelated users and verify they are rejected. Verify expense title and split
   edits work before any payment, then fail atomically after a payment attempt;
   direct table updates must be denied. Permanently deleting an archived group
   with expenses must fail without removing its financial history.
4. Enable cycle tracking only after granting the separate current consent. Revoke
   it and verify tracking is disabled and direct table/RPC reads are denied.
5. Verify `find_best_cycle_dates` is not executable through authenticated or
   anonymous API roles while repeated-query differencing remains possible. The
   date-finder UI must remain disabled until a privacy design prevents that
   attack; do not expose aggregate results through the current subset-selectable
   RPC.

## PostgreSQL concurrency checks

These require two authenticated sessions against the same disposable local
database and pre-created debtor/creditor/expense fixtures. Set each session's
`request.jwt.claim.sub` to the fixture user's UUID before invoking the RPCs.
Do not point these sessions at any linked or production database.

1. Submit `mark_obligation_paid` concurrently twice with the same request UUID,
   same debtor, obligation, and amount. Both calls must return one payment UUID;
   exactly one ledger row and one pending notification must exist.
2. Reuse that UUID from another debtor, with another amount, or with another
   obligation from a different expense. Each call must fail with
   `idempotency_key_reused`; the original row must remain unchanged.
3. Submit two different request UUIDs concurrently for one unpaid obligation.
   Exactly one may create a pending payment. The other must fail after waiting
   for the expense/obligation locks; `paid_amount` must never exceed `amount`.
4. Confirm the same pending `payment_id` concurrently twice as creditor. Both
   calls may succeed idempotently, while the paid total and confirmation
   notification change exactly once. Race confirm against reject; at most one
   terminal status may win, and the losing action must fail.
5. Race `update_expense` or `delete_expense` with `mark_obligation_paid`.
   If edit/delete locks the expense first, the old obligation ID must become
   unusable. If payment locks it first, the edit/delete must fail on history.
   No execution may leave a payment attached to rewritten or deleted splits.
6. Archive the group during a pending payment, then confirm or reject it. The
   ledger row and obligation must remain consistent; permanent group deletion
   must still fail while the expense exists.

Run the offline source checks with
`python3 -m unittest discover -s supabase/tests -p 'test_*.py' -v`. They verify
lock ordering and RPC guards structurally; they do not simulate PostgreSQL
scheduling. Run this section only when a local Postgres/Supabase test database
is available.

## Account deletion

1. Create a group with another active member and shared meetings/trips. Re-enter
   the account password, confirm deletion, and verify ownership transfers, event
   rows remain with `created_by IS NULL` where applicable, the deleted user's
   membership/profile/auth identity/cycle data are gone, and old sessions cannot
   pass `registration_is_complete()` or append consent events using a stale JWT.
2. Repeat with a group that has no other active member. Verify it is archived
   with a null owner rather than deleted.
3. Add any expense, expense participant or payment obligation for the account.
   Deletion must stop before side effects; verify group ownership, auth identity,
   profile, cycle data and every financial row are unchanged.
4. Verify the append-only consent events remain present and are no longer
   associated with a live auth user. Legal retention duration and basis require
   separate confirmation before production launch.
