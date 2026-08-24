/*
# Event access by participation, not group membership

Meetings/trips are visible only to created_by (organizer) or rows in
meeting_participants / trip_participants. Group membership is not enough.

Helpers are SECURITY DEFINER so policies do not recurse
(meetings <-> meeting_participants).
*/

CREATE OR REPLACE FUNCTION public.is_meeting_participant(_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_participants
    WHERE meeting_id = _meeting_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_meeting_organizer(_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meetings
    WHERE id = _meeting_id
      AND created_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_participant(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_participants
    WHERE trip_id = _trip_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_organizer(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trips
    WHERE id = _trip_id
      AND created_by = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_meeting_participant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_meeting_organizer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_trip_participant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_trip_organizer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_meeting_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_meeting_organizer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trip_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trip_organizer(uuid) TO authenticated;

-- ============================================================
-- MEETINGS
-- ============================================================
DROP POLICY IF EXISTS "meetings_select_member" ON meetings;
CREATE POLICY "meetings_select_member" ON meetings
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR public.is_meeting_participant(id)
  );

DROP POLICY IF EXISTS "meetings_insert_member" ON meetings;
CREATE POLICY "meetings_insert_member" ON meetings
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_group_member(group_id)
      OR public.is_group_owner(group_id)
    )
  );

DROP POLICY IF EXISTS "meetings_update_member" ON meetings;
CREATE POLICY "meetings_update_member" ON meetings
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_group_member(group_id)
      OR public.is_group_owner(group_id)
    )
  );

DROP POLICY IF EXISTS "meetings_delete_member" ON meetings;
CREATE POLICY "meetings_delete_member" ON meetings
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ============================================================
-- MEETING PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "meeting_participants_select_member" ON meeting_participants;
CREATE POLICY "meeting_participants_select_member" ON meeting_participants
  FOR SELECT TO authenticated USING (
    public.is_meeting_organizer(meeting_id)
    OR public.is_meeting_participant(meeting_id)
  );

DROP POLICY IF EXISTS "meeting_participants_insert_member" ON meeting_participants;
CREATE POLICY "meeting_participants_insert_member" ON meeting_participants
  FOR INSERT TO authenticated WITH CHECK (
    public.is_meeting_organizer(meeting_id)
  );

DROP POLICY IF EXISTS "meeting_participants_delete_member" ON meeting_participants;
CREATE POLICY "meeting_participants_delete_member" ON meeting_participants
  FOR DELETE TO authenticated USING (
    public.is_meeting_organizer(meeting_id)
    OR user_id = auth.uid()
  );

-- ============================================================
-- TRIPS
-- ============================================================
DROP POLICY IF EXISTS "trips_select_member" ON trips;
CREATE POLICY "trips_select_member" ON trips
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR public.is_trip_participant(id)
  );

DROP POLICY IF EXISTS "trips_insert_member" ON trips;
CREATE POLICY "trips_insert_member" ON trips
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_group_member(group_id)
      OR public.is_group_owner(group_id)
    )
  );

DROP POLICY IF EXISTS "trips_update_member" ON trips;
CREATE POLICY "trips_update_member" ON trips
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_group_member(group_id)
      OR public.is_group_owner(group_id)
    )
  );

DROP POLICY IF EXISTS "trips_delete_member" ON trips;
CREATE POLICY "trips_delete_member" ON trips
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ============================================================
-- TRIP PARTICIPANTS
-- ============================================================
DROP POLICY IF EXISTS "trip_participants_select_member" ON trip_participants;
CREATE POLICY "trip_participants_select_member" ON trip_participants
  FOR SELECT TO authenticated USING (
    public.is_trip_organizer(trip_id)
    OR public.is_trip_participant(trip_id)
  );

DROP POLICY IF EXISTS "trip_participants_insert_member" ON trip_participants;
CREATE POLICY "trip_participants_insert_member" ON trip_participants
  FOR INSERT TO authenticated WITH CHECK (
    public.is_trip_organizer(trip_id)
  );

DROP POLICY IF EXISTS "trip_participants_delete_member" ON trip_participants;
CREATE POLICY "trip_participants_delete_member" ON trip_participants
  FOR DELETE TO authenticated USING (
    public.is_trip_organizer(trip_id)
    OR user_id = auth.uid()
  );
