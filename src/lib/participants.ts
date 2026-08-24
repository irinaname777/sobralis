import { supabase } from '@/lib/supabase';
import type { GroupMember } from '@/types';

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as GroupMember[]) || [];
}

type ParticipantKind = 'meeting' | 'trip';

export async function syncEventParticipants(
  kind: ParticipantKind,
  eventId: string,
  selectedUserIds: string[],
  existingUserIds: string[],
  organizerId?: string
) {
  const table = kind === 'meeting' ? 'meeting_participants' : 'trip_participants';
  const fk = kind === 'meeting' ? 'meeting_id' : 'trip_id';

  const selected = new Set(selectedUserIds);
  if (organizerId) selected.add(organizerId);

  const existing = new Set(existingUserIds);
  const selectedList = Array.from(selected);

  const toAdd = selectedList.filter((id) => !existing.has(id));
  const toRemove = existingUserIds.filter((id) => !selected.has(id) && id !== organizerId);

  if (toAdd.length > 0) {
    const rows = toAdd.map((user_id) => ({ [fk]: eventId, user_id }));
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw error;
  }

  if (toRemove.length > 0) {
    const { error } = await supabase.from(table).delete().eq(fk, eventId).in('user_id', toRemove);
    if (error) throw error;
  }
}

export function organizerOnlySelection(organizerId: string) {
  return new Set(organizerId ? [organizerId] : []);
}

export function withOrganizer(ids: Iterable<string>, organizerId: string) {
  const next = new Set(ids);
  if (organizerId) next.add(organizerId);
  return next;
}
