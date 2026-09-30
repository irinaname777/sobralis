-- Restore owner-only group invitations.
-- Participants may be allowed to invite later via an explicit group setting.

DROP POLICY IF EXISTS "invitations_insert_owner"
ON public.group_invitations;

CREATE POLICY "invitations_insert_owner"
ON public.group_invitations
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_group_active(group_id)
  AND public.is_group_owner(group_id)
);
