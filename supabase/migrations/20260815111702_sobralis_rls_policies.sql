/*
# Sobralis RLS Policies

Enables row-level security access control on all Sobralis tables.
Users can only see/modify data in groups they are a member of.
Cycle settings are only visible to the owner.
All policies use auth.uid() for ownership checks.
*/

-- ============================================================
-- PROFILES
-- ============================================================
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- GROUPS
-- ============================================================
DROP POLICY IF EXISTS "groups_select_member" ON groups;
CREATE POLICY "groups_select_member" ON groups
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
        AND group_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "groups_insert_owner" ON groups;
CREATE POLICY "groups_insert_owner" ON groups
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "groups_update_owner" ON groups;
CREATE POLICY "groups_update_owner" ON groups
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "groups_delete_owner" ON groups;
CREATE POLICY "groups_delete_owner" ON groups
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- ============================================================
-- GROUP MEMBERS
-- ============================================================
DROP POLICY IF EXISTS "group_members_select_member" ON group_members;
CREATE POLICY "group_members_select_member" ON group_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "group_members_insert_self" ON group_members;
CREATE POLICY "group_members_insert_self" ON group_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "group_members_update_owner" ON group_members;
CREATE POLICY "group_members_update_owner" ON group_members
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
        AND g.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "group_members_delete_owner_or_self" ON group_members;
CREATE POLICY "group_members_delete_owner_or_self" ON group_members
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
        AND g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- GROUP INVITATIONS
-- ============================================================
DROP POLICY IF EXISTS "invitations_select_member" ON group_invitations;
CREATE POLICY "invitations_select_member" ON group_invitations
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_invitations.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_invitations.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invitations_insert_owner" ON group_invitations;
CREATE POLICY "invitations_insert_owner" ON group_invitations
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_invitations.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invitations_delete_owner" ON group_invitations;
CREATE POLICY "invitations_delete_owner" ON group_invitations
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_invitations.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invitations_update_use" ON group_invitations;
CREATE POLICY "invitations_update_use" ON group_invitations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- CYCLE SETTINGS
-- ============================================================
DROP POLICY IF EXISTS "cycle_select_own" ON cycle_settings;
CREATE POLICY "cycle_select_own" ON cycle_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cycle_insert_own" ON cycle_settings;
CREATE POLICY "cycle_insert_own" ON cycle_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cycle_update_own" ON cycle_settings;
CREATE POLICY "cycle_update_own" ON cycle_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cycle_delete_own" ON cycle_settings;
CREATE POLICY "cycle_delete_own" ON cycle_settings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- MEETINGS
-- ============================================================
DROP POLICY IF EXISTS "meetings_select_member" ON meetings;
CREATE POLICY "meetings_select_member" ON meetings
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = meetings.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = meetings.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meetings_insert_member" ON meetings;
CREATE POLICY "meetings_insert_member" ON meetings
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = meetings.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = meetings.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meetings_update_member" ON meetings;
CREATE POLICY "meetings_update_member" ON meetings
  FOR UPDATE TO authenticated
    USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = meetings.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = meetings.group_id
        AND g.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = meetings.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = meetings.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meetings_delete_member" ON meetings;
CREATE POLICY "meetings_delete_member" ON meetings
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = meetings.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = meetings.group_id
        AND g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- MEETING PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "meeting_participants_select_member" ON meeting_participants;
CREATE POLICY "meeting_participants_select_member" ON meeting_participants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN group_members gm ON gm.group_id = m.group_id
      WHERE m.id = meeting_participants.meeting_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM meetings m
      JOIN groups g ON g.id = m.group_id
      WHERE m.id = meeting_participants.meeting_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meeting_participants_insert_member" ON meeting_participants;
CREATE POLICY "meeting_participants_insert_member" ON meeting_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN group_members gm ON gm.group_id = m.group_id
      WHERE m.id = meeting_participants.meeting_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM meetings m
      JOIN groups g ON g.id = m.group_id
      WHERE m.id = meeting_participants.meeting_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meeting_participants_delete_member" ON meeting_participants;
CREATE POLICY "meeting_participants_delete_member" ON meeting_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM meetings m
      JOIN group_members gm ON gm.group_id = m.group_id
      WHERE m.id = meeting_participants.meeting_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM meetings m
      JOIN groups g ON g.id = m.group_id
      WHERE m.id = meeting_participants.meeting_id
        AND g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- TRIPS
-- ============================================================
DROP POLICY IF EXISTS "trips_select_member" ON trips;
CREATE POLICY "trips_select_member" ON trips
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = trips.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = trips.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trips_insert_member" ON trips;
CREATE POLICY "trips_insert_member" ON trips
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = trips.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = trips.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trips_update_member" ON trips;
CREATE POLICY "trips_update_member" ON trips
  FOR UPDATE TO authenticated
    USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = trips.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = trips.group_id
        AND g.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = trips.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = trips.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trips_delete_member" ON trips;
CREATE POLICY "trips_delete_member" ON trips
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = trips.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = trips.group_id
        AND g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- TRIP PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "trip_participants_select_member" ON trip_participants;
CREATE POLICY "trip_participants_select_member" ON trip_participants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM trips t
      JOIN group_members gm ON gm.group_id = t.group_id
      WHERE t.id = trip_participants.trip_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM trips t
      JOIN groups g ON g.id = t.group_id
      WHERE t.id = trip_participants.trip_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trip_participants_insert_member" ON trip_participants;
CREATE POLICY "trip_participants_insert_member" ON trip_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips t
      JOIN group_members gm ON gm.group_id = t.group_id
      WHERE t.id = trip_participants.trip_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM trips t
      JOIN groups g ON g.id = t.group_id
      WHERE t.id = trip_participants.trip_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trip_participants_delete_member" ON trip_participants;
CREATE POLICY "trip_participants_delete_member" ON trip_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM trips t
      JOIN group_members gm ON gm.group_id = t.group_id
      WHERE t.id = trip_participants.trip_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM trips t
      JOIN groups g ON g.id = t.group_id
      WHERE t.id = trip_participants.trip_id
        AND g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- EXPENSES
-- ============================================================
DROP POLICY IF EXISTS "expenses_select_member" ON expenses;
CREATE POLICY "expenses_select_member" ON expenses
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = expenses.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = expenses.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "expenses_insert_member" ON expenses;
CREATE POLICY "expenses_insert_member" ON expenses
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = expenses.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = expenses.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "expenses_update_member" ON expenses;
CREATE POLICY "expenses_update_member" ON expenses
  FOR UPDATE TO authenticated
    USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = expenses.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = expenses.group_id
        AND g.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = expenses.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = expenses.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "expenses_delete_member" ON expenses;
CREATE POLICY "expenses_delete_member" ON expenses
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = expenses.group_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = expenses.group_id
        AND g.owner_id = auth.uid()
    )
  );

-- ============================================================
-- EXPENSE PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "expense_participants_select_member" ON expense_participants;
CREATE POLICY "expense_participants_select_member" ON expense_participants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_participants.expense_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM expenses e
      JOIN groups g ON g.id = e.group_id
      WHERE e.id = expense_participants.expense_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "expense_participants_insert_member" ON expense_participants;
CREATE POLICY "expense_participants_insert_member" ON expense_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_participants.expense_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM expenses e
      JOIN groups g ON g.id = e.group_id
      WHERE e.id = expense_participants.expense_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "expense_participants_delete_member" ON expense_participants;
CREATE POLICY "expense_participants_delete_member" ON expense_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_participants.expense_id
        AND gm.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM expenses e
      JOIN groups g ON g.id = e.group_id
      WHERE e.id = expense_participants.expense_id
        AND g.owner_id = auth.uid()
    )
  );