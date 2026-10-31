BEGIN;

DROP POLICY IF EXISTS "group_members_insert_self"
  ON public.group_members;

DROP POLICY IF EXISTS "invitations_update_use"
  ON public.group_invitations;

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
AS $function$
BEGIN
  IF _code IS NULL OR length(btrim(_code)) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.group_id,
    g.name,
    g.description,
    i.expires_at,
    NULL::uuid AS used_by,
    i.created_at
  FROM public.group_invitations AS i
  JOIN public.groups AS g ON g.id = i.group_id
  WHERE i.invite_code = btrim(_code)
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.join_group_by_invite(_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.group_invitations%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_member public.group_members%ROWTYPE;
  v_has_member boolean;
  v_group_locked boolean;
  v_claimed_invitation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF _code IS NULL OR length(btrim(_code)) = 0 THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.group_invitations
  WHERE invite_code = btrim(_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  -- Keep the existing error precedence for an already archived group.
  IF NOT public.is_group_active(v_inv.group_id) THEN
    RAISE EXCEPTION 'group_archived';
  END IF;

  SELECT *
  INTO v_member
  FROM public.group_members
  WHERE group_id = v_inv.group_id
    AND user_id = v_uid
  FOR UPDATE;

  v_has_member := FOUND;

  -- Archive/restore updates this row. The lock order matches permanent group
  -- deletion, which deletes invitations and memberships before deleting group.
  PERFORM 1
  FROM public.groups
  WHERE id = v_inv.group_id
  FOR NO KEY UPDATE;

  v_group_locked := FOUND;

  IF NOT v_group_locked OR NOT public.is_group_active(v_inv.group_id) THEN
    RAISE EXCEPTION 'group_archived';
  END IF;

  -- A join using a different invite may have committed while this call waited
  -- for the group lock. Re-read without taking a member lock after the group.
  SELECT *
  INTO v_member
  FROM public.group_members
  WHERE group_id = v_inv.group_id
    AND user_id = v_uid;

  v_has_member := FOUND;

  IF v_inv.used_by = v_uid AND NOT v_has_member THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;

  IF v_inv.expires_at IS NOT NULL
     AND v_inv.expires_at < clock_timestamp()
  THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  IF v_inv.used_by IS NOT NULL AND v_inv.used_by <> v_uid THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;

  IF v_has_member
     AND COALESCE(v_member.status, 'active') <> 'removed'
  THEN
    RETURN json_build_object(
      'ok', true,
      'already_member', true,
      'group_id', v_inv.group_id
    );
  END IF;

  IF v_inv.used_by IS NULL THEN
    UPDATE public.group_invitations
    SET used_by = v_uid
    WHERE id = v_inv.id
      AND used_by IS NULL
    RETURNING id INTO v_claimed_invitation_id;

    IF v_claimed_invitation_id IS NULL THEN
      RAISE EXCEPTION 'invite_already_used';
    END IF;
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;

  IF v_has_member THEN
    UPDATE public.group_members
    SET status = 'active',
        removed_at = NULL,
        display_name = COALESCE(v_profile.display_name, v_profile.email, display_name),
        avatar_emoji = COALESCE(v_profile.avatar_emoji, avatar_emoji, '🌸')
    WHERE id = v_member.id
      AND COALESCE(status, 'active') = 'removed';
  ELSE
    INSERT INTO public.group_members (
      group_id,
      user_id,
      role,
      display_name,
      avatar_emoji,
      status
    )
    VALUES (
      v_inv.group_id,
      v_uid,
      'member',
      COALESCE(v_profile.display_name, v_profile.email),
      COALESCE(v_profile.avatar_emoji, '🌸'),
      'active'
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'already_member', false,
    'group_id', v_inv.group_id
  );
END;
$function$;

REVOKE ALL
  ON FUNCTION public.get_invitation_by_code(text)
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.get_invitation_by_code(text)
  TO anon, authenticated;

REVOKE ALL
  ON FUNCTION public.join_group_by_invite(text)
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION public.join_group_by_invite(text)
  TO authenticated;

COMMIT;