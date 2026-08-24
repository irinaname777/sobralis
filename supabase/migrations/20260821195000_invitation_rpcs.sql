/*
# Invitation lookup and join

Lets a user who is not yet a group member resolve a single invite by exact
invite_code (no listing of other invitations) and join atomically.
Honours expires_at and used_by from the existing schema.
*/

CREATE OR REPLACE FUNCTION public.get_invitation_by_code(_code text)
RETURNS TABLE (
  id uuid,
  group_id uuid,
  group_name text,
  group_description text,
  expires_at timestamptz,
  used_by uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.group_id,
    g.name,
    g.description,
    i.expires_at,
    i.used_by,
    i.created_at
  FROM public.group_invitations i
  JOIN public.groups g ON g.id = i.group_id
  WHERE i.invite_code = trim(_code)
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group_by_invite(_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  inv public.group_invitations%ROWTYPE;
  prof public.profiles%ROWTYPE;
  already boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF _code IS NULL OR length(trim(_code)) = 0 THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  SELECT * INTO inv
  FROM public.group_invitations
  WHERE invite_code = trim(_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF inv.expires_at IS NOT NULL AND inv.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = inv.group_id AND user_id = uid
  ) INTO already;

  IF already THEN
    RETURN json_build_object(
      'ok', true,
      'already_member', true,
      'group_id', inv.group_id
    );
  END IF;

  IF inv.used_by IS NOT NULL AND inv.used_by <> uid THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid;

  INSERT INTO public.group_members (group_id, user_id, role, display_name, avatar_emoji)
  VALUES (
    inv.group_id,
    uid,
    'member',
    COALESCE(prof.display_name, prof.email),
    COALESCE(prof.avatar_emoji, '🌸')
  );

  UPDATE public.group_invitations
  SET used_by = uid
  WHERE id = inv.id
    AND used_by IS NULL;

  RETURN json_build_object(
    'ok', true,
    'already_member', false,
    'group_id', inv.group_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_invitation_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_group_by_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite(text) TO authenticated;
