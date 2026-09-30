CREATE OR REPLACE FUNCTION public.caller_can_check_schedule(_user_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _user_ids IS NOT NULL
    AND array_length(_user_ids, 1) IS NOT NULL
    AND (
      (
        array_length(_user_ids, 1) = 1
        AND auth.uid() = _user_ids[1]
      )
      OR
      EXISTS (
        SELECT 1
        FROM public.group_members caller
        JOIN public.groups g
          ON g.id = caller.group_id
        WHERE caller.user_id = auth.uid()
          AND COALESCE(caller.status, 'active') IN ('active', 'accepted')
          AND g.status = 'active'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(_user_ids) AS uid(id)
            WHERE NOT public.is_active_group_member(caller.group_id, uid.id)
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.caller_can_check_schedule(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_can_check_schedule(uuid[]) TO authenticated;
