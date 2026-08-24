/*
# Fix recursive RLS between groups and group_members

Policies previously SELECT'd group_members / groups from inside each other's
USING clauses, which caused "infinite recursion detected in policy".

Helper functions run as SECURITY DEFINER (bypass RLS on the lookup) and only
return whether auth.uid() is a member or owner of a given group.
Access rules are unchanged: own groups only; members see their group;
owners manage their group.
*/

-- ============================================================
-- Helper functions (bypass RLS, do not recurse through policies)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_id = _group_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups
    WHERE id = _group_id
      AND owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_group_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_owner(uuid) TO authenticated;

-- ============================================================
-- GROUPS
-- ============================================================
DROP POLICY IF EXISTS "groups_select_member" ON groups;
CREATE POLICY "groups_select_member" ON groups
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR public.is_group_member(id)
  );

-- groups_insert_owner / groups_update_owner / groups_delete_owner
-- already check owner_id = auth.uid() only; left unchanged.

-- ============================================================
-- GROUP MEMBERS
-- ============================================================
DROP POLICY IF EXISTS "group_members_select_member" ON group_members;
CREATE POLICY "group_members_select_member" ON group_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

-- group_members_insert_self already checks user_id = auth.uid(); left unchanged.

DROP POLICY IF EXISTS "group_members_update_owner" ON group_members;
CREATE POLICY "group_members_update_owner" ON group_members
  FOR UPDATE TO authenticated
  USING (public.is_group_owner(group_id))
  WITH CHECK (public.is_group_owner(group_id));

DROP POLICY IF EXISTS "group_members_delete_owner_or_self" ON group_members;
CREATE POLICY "group_members_delete_owner_or_self" ON group_members
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR public.is_group_owner(group_id)
  );

-- ============================================================
-- GROUP INVITATIONS
-- ============================================================
DROP POLICY IF EXISTS "invitations_select_member" ON group_invitations;
CREATE POLICY "invitations_select_member" ON group_invitations
  FOR SELECT TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "invitations_insert_owner" ON group_invitations;
CREATE POLICY "invitations_insert_owner" ON group_invitations
  FOR INSERT TO authenticated WITH CHECK (public.is_group_owner(group_id));

DROP POLICY IF EXISTS "invitations_delete_owner" ON group_invitations;
CREATE POLICY "invitations_delete_owner" ON group_invitations
  FOR DELETE TO authenticated USING (public.is_group_owner(group_id));

-- invitations_update_use left unchanged (out of scope).

-- ============================================================
-- MEETINGS
-- ============================================================
DROP POLICY IF EXISTS "meetings_select_member" ON meetings;
CREATE POLICY "meetings_select_member" ON meetings
  FOR SELECT TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "meetings_insert_member" ON meetings;
CREATE POLICY "meetings_insert_member" ON meetings
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "meetings_update_member" ON meetings;
CREATE POLICY "meetings_update_member" ON meetings
  FOR UPDATE TO authenticated
  USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  )
  WITH CHECK (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "meetings_delete_member" ON meetings;
CREATE POLICY "meetings_delete_member" ON meetings
  FOR DELETE TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

-- ============================================================
-- MEETING PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "meeting_participants_select_member" ON meeting_participants;
CREATE POLICY "meeting_participants_select_member" ON meeting_participants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_participants.meeting_id
        AND (
          public.is_group_member(m.group_id)
          OR public.is_group_owner(m.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "meeting_participants_insert_member" ON meeting_participants;
CREATE POLICY "meeting_participants_insert_member" ON meeting_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_participants.meeting_id
        AND (
          public.is_group_member(m.group_id)
          OR public.is_group_owner(m.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "meeting_participants_delete_member" ON meeting_participants;
CREATE POLICY "meeting_participants_delete_member" ON meeting_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_participants.meeting_id
        AND (
          public.is_group_member(m.group_id)
          OR public.is_group_owner(m.group_id)
        )
    )
  );

-- ============================================================
-- TRIPS
-- ============================================================
DROP POLICY IF EXISTS "trips_select_member" ON trips;
CREATE POLICY "trips_select_member" ON trips
  FOR SELECT TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "trips_insert_member" ON trips;
CREATE POLICY "trips_insert_member" ON trips
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "trips_update_member" ON trips;
CREATE POLICY "trips_update_member" ON trips
  FOR UPDATE TO authenticated
  USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  )
  WITH CHECK (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "trips_delete_member" ON trips;
CREATE POLICY "trips_delete_member" ON trips
  FOR DELETE TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

-- ============================================================
-- TRIP PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "trip_participants_select_member" ON trip_participants;
CREATE POLICY "trip_participants_select_member" ON trip_participants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_participants.trip_id
        AND (
          public.is_group_member(t.group_id)
          OR public.is_group_owner(t.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "trip_participants_insert_member" ON trip_participants;
CREATE POLICY "trip_participants_insert_member" ON trip_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_participants.trip_id
        AND (
          public.is_group_member(t.group_id)
          OR public.is_group_owner(t.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "trip_participants_delete_member" ON trip_participants;
CREATE POLICY "trip_participants_delete_member" ON trip_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_participants.trip_id
        AND (
          public.is_group_member(t.group_id)
          OR public.is_group_owner(t.group_id)
        )
    )
  );

-- ============================================================
-- EXPENSES
-- ============================================================
DROP POLICY IF EXISTS "expenses_select_member" ON expenses;
CREATE POLICY "expenses_select_member" ON expenses
  FOR SELECT TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "expenses_insert_member" ON expenses;
CREATE POLICY "expenses_insert_member" ON expenses
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "expenses_update_member" ON expenses;
CREATE POLICY "expenses_update_member" ON expenses
  FOR UPDATE TO authenticated
  USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  )
  WITH CHECK (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

DROP POLICY IF EXISTS "expenses_delete_member" ON expenses;
CREATE POLICY "expenses_delete_member" ON expenses
  FOR DELETE TO authenticated USING (
    public.is_group_member(group_id)
    OR public.is_group_owner(group_id)
  );

-- ============================================================
-- EXPENSE PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "expense_participants_select_member" ON expense_participants;
CREATE POLICY "expense_participants_select_member" ON expense_participants
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_participants.expense_id
        AND (
          public.is_group_member(e.group_id)
          OR public.is_group_owner(e.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "expense_participants_insert_member" ON expense_participants;
CREATE POLICY "expense_participants_insert_member" ON expense_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_participants.expense_id
        AND (
          public.is_group_member(e.group_id)
          OR public.is_group_owner(e.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "expense_participants_delete_member" ON expense_participants;
CREATE POLICY "expense_participants_delete_member" ON expense_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_participants.expense_id
        AND (
          public.is_group_member(e.group_id)
          OR public.is_group_owner(e.group_id)
        )
    )
  );
