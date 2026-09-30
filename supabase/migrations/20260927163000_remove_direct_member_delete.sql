-- Membership history must be preserved.
-- Physical member deletion is allowed only inside
-- permanently_delete_archived_group().

DROP POLICY IF EXISTS "group_members_delete_owner_or_self" ON public.group_members;
