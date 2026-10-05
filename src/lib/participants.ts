import { supabase } from '@/lib/supabase';
import type { GroupMember } from '@/types';

export function isActiveMember(member: GroupMember) {
  return member.status !== 'removed';
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data as GroupMember[]) || []).filter(isActiveMember);
}

export async function removeGroupMember(memberId: string) {
  const { error } = await supabase.rpc('remove_group_member', { _member_id: memberId });
  if (error) throw error;
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
    const rows = toAdd.map((user_id) => ({ [fk]: eventId, user_id, status: user_id === organizerId ? 'accepted' : 'pending' }));
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

export type InvitationStatus = 'accepted' | 'declined' | 'counter_proposed';

export async function respondToEventInvitation(
  kind: ParticipantKind,
  eventId: string,
  status: InvitationStatus,
  counter?: { date?: string; time?: string; location?: string }
) {
  const { error } = await supabase.rpc('respond_to_event_invitation', {
    _kind: kind,
    _event_id: eventId,
    _status: status,
    _counter_date: counter?.date || null,
    _counter_time: counter?.time || null,
    _counter_location: counter?.location || null,
  });
  if (error) throw error;
}

export async function submitTripCounterProposal(
  tripId: string,
  proposal: { startDate: string; endDate: string; location?: string }
) {
  const { error } = await supabase.rpc('submit_trip_counter_proposal', {
    _trip_id: tripId,
    _start_date: proposal.startDate,
    _end_date: proposal.endDate,
    _location: proposal.location || null,
  });
  if (error) throw error;
}

export function invitationStatusLabel(status: string) {
  return ({ pending: 'Ожидает ответа', accepted: 'Участие принято', declined: 'Отказ', counter_proposed: 'Ожидает ответа' } as Record<string, string>)[status] || status;
}

export function eventCoordinationLabel(status?: string) {
  return ({ pending: 'На согласовании', confirmed: 'Согласовано', cancelled: 'Отменено' } as Record<string, string>)[status || 'pending'] || status || '';
}

export function canRespondToEvent(myStatus?: string, eventStatus?: string) {
  if (!myStatus || myStatus === 'declined') return false;
  if (eventStatus === 'cancelled') return false;
  return true;
}

export function needsConfirmation(myStatus?: string, eventStatus?: string) {
  return canRespondToEvent(myStatus, eventStatus) && myStatus !== 'accepted';
}
