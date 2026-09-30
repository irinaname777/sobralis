/*
  `expense_obligations.expense_id` is intentionally RESTRICT to protect
  financial history. Final deletion is the explicit exception: delete its
  dependency rows in the same authorised transaction before expenses.
*/
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

  -- Explicit dependency order: no implicit cascade can erase active history.
  DELETE FROM public.expense_obligations
  WHERE expense_id IN (SELECT id FROM public.expenses WHERE group_id = _group_id);
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

REVOKE ALL ON FUNCTION public.permanently_delete_archived_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.permanently_delete_archived_group(uuid) TO authenticated;
