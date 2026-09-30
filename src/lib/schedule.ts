import { supabase } from '@/lib/supabase';

export type ScheduleConflict = {
  busy_user_id: string;
  kind: 'meeting' | 'trip';
  start_date: string;
  end_date: string;
};

export type FreeSlot = {
  slot_date: string;
  slot_time: string | null;
};

export async function findScheduleConflicts(params: {
  userIds: string[];
  start: string;
  end: string;
  time?: string | null;
  excludeKind?: 'meeting' | 'trip' | null;
  excludeId?: string | null;
}): Promise<ScheduleConflict[]> {
  const { data, error } = await supabase.rpc('find_schedule_conflicts', {
    _user_ids: params.userIds,
    _start: params.start,
    _end: params.end,
    _time: params.time || null,
    _exclude_kind: params.excludeKind || null,
    _exclude_id: params.excludeId || null,
  });
  if (error) throw error;
  return (data as ScheduleConflict[]) || [];
}

export async function suggestFreeSlots(params: {
  userIds: string[];
  from: string;
  days?: number;
  preferredTime?: string | null;
}): Promise<FreeSlot[]> {
  const { data, error } = await supabase.rpc('suggest_free_slots', {
    _user_ids: params.userIds,
    _from: params.from,
    _days: params.days ?? 14,
    _preferred_time: params.preferredTime || null,
  });
  if (error) throw error;
  return (data as FreeSlot[]) || [];
}

export function formatConflictHint(conflicts: ScheduleConflict[], slots: FreeSlot[]) {
  const busyDays = [...new Set(conflicts.map((c) => c.start_date))].join(', ');
  const free = slots.slice(0, 5).map((s) => s.slot_date).join(', ');
  if (free) {
    return `Выбранный слот пересекается с уже запланированными встречами или поездками (${busyDays}). Свободные даты: ${free}.`;
  }
  return `Выбранный слот пересекается с уже запланированными встречами или поездками (${busyDays}). Попробуйте другую дату.`;
}
