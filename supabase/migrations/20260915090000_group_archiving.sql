/*
  Preserve a group's history until an owner explicitly removes an archived group.
  Group deletion is deliberately blocked for API clients; the SECURITY DEFINER
  function below is the only final-delete path and verifies archived ownership.
*/

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

-- A direct DELETE must never implicitly erase a group's history.
ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_group_id_fkey;
ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;

ALTER TABLE public.group_invitations DROP CONSTRAINT IF EXISTS group_invitations_group_id_fkey;
ALTER TABLE public.group_invitations
  ADD CONSTRAINT group_invitations_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;

ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_group_id_fkey;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_group_id_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_group_id_fkey;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;

ALTER TABLE public.expense_participants DROP CONSTRAINT IF EXISTS expense_participants_expense_id_fkey;
ALTER TABLE public.expense_participants
  ADD CONSTRAINT expense_participants_expense_id_fkey
  FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.is_group_active(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_group_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_group_active(uuid) TO authenticated;

-- Preserve the membership rows: they are the historical-access boundary.
DROP POLICY IF EXISTS "groups_delete_owner" ON public.groups;

DROP POLICY IF EXISTS "group_members_delete_owner_or_self" ON public.group_members;
CREATE POLICY "group_members_delete_owner_or_self" ON public.group_members
  FOR DELETE TO authenticated USING (
    public.is_group_active(group_id)
    AND (user_id = auth.uid() OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "invitations_insert_owner" ON public.group_invitations;
CREATE POLICY "invitations_insert_owner" ON public.group_invitations
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_active(group_id) AND public.is_group_owner(group_id)
  );

-- Archived meetings, trips and expenses remain readable, but are immutable.
DROP POLICY IF EXISTS "meetings_insert_member" ON public.meetings;
CREATE POLICY "meetings_insert_member" ON public.meetings
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_active(group_id)
    AND created_by = auth.uid()
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "meetings_update_member" ON public.meetings;
CREATE POLICY "meetings_update_member" ON public.meetings
  FOR UPDATE TO authenticated USING (
    created_by = auth.uid() AND public.is_group_active(group_id)
  ) WITH CHECK (
    created_by = auth.uid()
    AND public.is_group_active(group_id)
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "meetings_delete_member" ON public.meetings;
CREATE POLICY "meetings_delete_member" ON public.meetings
  FOR DELETE TO authenticated USING (
    created_by = auth.uid() AND public.is_group_active(group_id)
  );

DROP POLICY IF EXISTS "trips_insert_member" ON public.trips;
CREATE POLICY "trips_insert_member" ON public.trips
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_active(group_id)
    AND created_by = auth.uid()
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "trips_update_member" ON public.trips;
CREATE POLICY "trips_update_member" ON public.trips
  FOR UPDATE TO authenticated USING (
    created_by = auth.uid() AND public.is_group_active(group_id)
  ) WITH CHECK (
    created_by = auth.uid()
    AND public.is_group_active(group_id)
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "trips_delete_member" ON public.trips;
CREATE POLICY "trips_delete_member" ON public.trips
  FOR DELETE TO authenticated USING (
    created_by = auth.uid() AND public.is_group_active(group_id)
  );

DROP POLICY IF EXISTS "expenses_insert_member" ON public.expenses;
CREATE POLICY "expenses_insert_member" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (
    public.is_group_active(group_id)
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "expenses_update_member" ON public.expenses;
CREATE POLICY "expenses_update_member" ON public.expenses
  FOR UPDATE TO authenticated USING (
    public.is_group_active(group_id)
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  ) WITH CHECK (
    public.is_group_active(group_id)
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

DROP POLICY IF EXISTS "expenses_delete_member" ON public.expenses;
CREATE POLICY "expenses_delete_member" ON public.expenses
  FOR DELETE TO authenticated USING (
    public.is_group_active(group_id)
    AND (public.is_group_member(group_id) OR public.is_group_owner(group_id))
  );

CREATE OR REPLACE FUNCTION public.archive_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.groups
  SET status = 'archived'
  WHERE id = _group_id AND owner_id = auth.uid() AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the owner can archive an active group';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.groups
  SET status = 'active'
  WHERE id = _group_id AND owner_id = auth.uid() AND status = 'archived';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the owner can restore an archived group';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.permanently_delete_archived_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND owner_id = auth.uid() AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'Only the owner can permanently delete an archived group';
  END IF;

  DELETE FROM public.expense_participants
  WHERE expense_id IN (SELECT id FROM public.expenses WHERE group_id = _group_id);
  DELETE FROM public.meeting_participants
  WHERE meeting_id IN (SELECT id FROM public.meetings WHERE group_id = _group_id);
  DELETE FROM public.trip_participants
  WHERE trip_id IN (SELECT id FROM public.trips WHERE group_id = _group_id);
  DELETE FROM public.group_invitations WHERE group_id = _group_id;
  DELETE FROM public.expenses WHERE group_id = _group_id;
  DELETE FROM public.meetings WHERE group_id = _group_id;
  DELETE FROM public.trips WHERE group_id = _group_id;
  DELETE FROM public.group_members WHERE group_id = _group_id;
  DELETE FROM public.groups WHERE id = _group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.permanently_delete_archived_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.permanently_delete_archived_group(uuid) TO authenticated;
