import { useEffect, useState, useCallback } from 'react';
import { Plane, Plus, Trash2, MapPin, Calendar as CalIcon, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Trip, Group, GroupMember, TripParticipant } from '@/types';
import { Modal, Input, Button, FormField, EmptyState, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { fetchGroupMembers, syncEventParticipants, organizerOnlySelection, withOrganizer, respondToEventInvitation, submitTripCounterProposal, invitationStatusLabel, isActiveMember } from '@/lib/participants';
import { formatUserError } from '@/lib/errors';
import { findScheduleConflicts, suggestFreeSlots, formatConflictHint } from '@/lib/schedule';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

export function TripsPage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<(Trip & { group_name?: string })[]>([]);
  const [participants, setParticipants] = useState<Record<string, TripParticipant[]>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [counterTrip, setCounterTrip] = useState<Trip | null>(null);
  const [counterStartDate, setCounterStartDate] = useState('');
  const [counterEndDate, setCounterEndDate] = useState('');
  const [counterLocation, setCounterLocation] = useState('');

  // Form state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [validationError, setValidationError] = useState<string | null>(null);
  const { loading: saving, error: saveError, run: runSave } = useAsyncAction();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: memberRows } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user.id);
      const groupIds = (memberRows || []).map((r) => r.group_id);

      const { data: groupsData } = groupIds.length
        ? await supabase.from('groups').select('*').in('id', groupIds).order('created_at', { ascending: false })
        : { data: [] as Group[] };
      setGroups((groupsData as Group[]) || []);

      const { data: tripsData } = await supabase
        .from('trips')
        .select('*, groups(name)')
        .order('start_date', { ascending: true });

      const tripsWithGroup = (tripsData as (Trip & { groups: { name: string } | null })[]) || [];
      setTrips(tripsWithGroup.map((t) => ({ ...t, group_name: t.groups?.name })));

      if (tripsWithGroup.length > 0) {
        const { data: partsData } = await supabase
          .from('trip_participants')
          .select('*')
          .in('trip_id', tripsWithGroup.map((t) => t.id));
        const partsMap: Record<string, TripParticipant[]> = {};
        for (const p of (partsData as TripParticipant[]) || []) {
          if (!partsMap[p.trip_id]) partsMap[p.trip_id] = [];
          partsMap[p.trip_id].push(p);
        }
        setParticipants(partsMap);
      }

      if (groupIds.length > 0) {
        const { data: allMembers } = await supabase
          .from('group_members')
          .select('*')
          .in('group_id', groupIds)
          .order('created_at', { ascending: true });
        const membersMap: Record<string, GroupMember[]> = {};
        for (const m of ((allMembers as GroupMember[]) || []).filter(isActiveMember)) {
          if (!membersMap[m.group_id]) membersMap[m.group_id] = [];
          membersMap[m.group_id].push(m);
        }
        setGroupMembers(membersMap);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setSelectedGroup('');
    setTitle('');
    setDestination('');
    setStartDate('');
    setEndDate('');
    setNotes('');
    setSelectedParticipants(new Set());
    setValidationError(null);
    setEditingTrip(null);
  };

  const mergeMembers = (groupId: string, list: GroupMember[]) => {
    setGroupMembers((prev) => ({ ...prev, [groupId]: list }));
    return list;
  };

  const loadMembersForGroup = async (groupId: string) => {
    const list = await fetchGroupMembers(groupId);
    return mergeMembers(groupId, list);
  };

  const openCreateForm = async () => {
    resetForm();
    const groupId = groups.find((g) => g.status !== 'archived')?.id || '';
    if (groupId) {
      setSelectedGroup(groupId);
      try {
        await loadMembersForGroup(groupId);
        setSelectedParticipants(organizerOnlySelection(user?.id || ''));
      } catch (err) {
        setValidationError(formatUserError(err, 'Не удалось загрузить участниц'));
      }
    }
    setShowForm(true);
  };

  const openEditForm = async (trip: Trip) => {
    setEditingTrip(trip);
    setSelectedGroup(trip.group_id);
    setTitle(trip.title);
    setDestination(trip.destination || '');
    setStartDate(trip.start_date);
    setEndDate(trip.end_date);
    setNotes(trip.notes || '');
    const parts = participants[trip.id] || [];
    setSelectedParticipants(withOrganizer(parts.map((p) => p.user_id), user?.id || trip.created_by));
    setShowForm(true);
    try {
      await loadMembersForGroup(trip.group_id);
    } catch (err) {
      setValidationError(formatUserError(err, 'Не удалось загрузить участниц'));
    }
  };

  const handleGroupChange = async (groupId: string) => {
    setSelectedGroup(groupId);
    try {
      await loadMembersForGroup(groupId);
      setSelectedParticipants(organizerOnlySelection(user?.id || ''));
    } catch (err) {
      setValidationError(formatUserError(err, 'Не удалось загрузить участниц'));
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setValidationError(null);

    if (!title.trim()) { setValidationError('Введите название поездки'); return; }
    if (!selectedGroup) { setValidationError('Выберите группу'); return; }
    if (!startDate || !endDate) { setValidationError('Выберите даты'); return; }
    if (new Date(endDate) < new Date(startDate)) {
      setValidationError('Дата окончания не может быть раньше даты начала');
      return;
    }

    const invitees = withOrganizer(selectedParticipants, user.id);

    const result = await runSave(async () => {
      const conflicts = await findScheduleConflicts({
        userIds: Array.from(invitees),
        start: startDate,
        end: endDate,
        excludeKind: editingTrip ? 'trip' : null,
        excludeId: editingTrip?.id || null,
      });
      if (conflicts.length > 0) {
        const slots = await suggestFreeSlots({
          userIds: Array.from(invitees),
          from: startDate,
          days: 21,
        });
        throw new Error(formatConflictHint(conflicts, slots));
      }
      const payload = {
        group_id: selectedGroup,
        title: title.trim(),
        destination: destination.trim() || null,
        start_date: startDate,
        end_date: endDate,
        notes: notes.trim() || null,
      };

      if (editingTrip) {
        const { error } = await supabase.from('trips').update(payload).eq('id', editingTrip.id);
        if (error) throw error;
        const existing = (participants[editingTrip.id] || []).map((p) => p.user_id);
        await syncEventParticipants(
          'trip',
          editingTrip.id,
          Array.from(invitees),
          existing,
          user.id
        );
      } else {
        const { data, error } = await supabase
          .from('trips')
          .insert({ ...payload, created_by: user.id })
          .select()
          .single();
        if (error) throw error;
        const createdId = data.id as string;
        try {
          await syncEventParticipants(
            'trip',
            createdId,
            Array.from(invitees),
            [],
            user.id
          );
        } catch (partError) {
          await supabase.from('trips').delete().eq('id', createdId);
          throw partError;
        }
      }
    });

    if (result !== null) {
      setShowForm(false);
      resetForm();
      showToast(editingTrip ? 'Поездка обновлена' : 'Поездка создана');
      loadData();
    }
  };

  const handleDelete = async (trip: Trip) => {
    if (!confirm(`Удалить поездку «${trip.title}»?`)) return;
    const { error } = await supabase.from('trips').delete().eq('id', trip.id);
    if (!error) {
      showToast('Поездка удалена');
      loadData();
    }
  };

  const handleResponse = async (tripId: string, status: 'accepted' | 'declined' | 'counter_proposed') => {
    try {
      if (status === 'counter_proposed') {
        if (!counterStartDate || !counterEndDate || counterEndDate < counterStartDate) {
          setValidationError('Укажите корректные даты поездки');
          return;
        }
        await submitTripCounterProposal(tripId, { startDate: counterStartDate, endDate: counterEndDate, location: counterLocation });
      } else {
        await respondToEventInvitation('trip', tripId, status);
      }
      showToast(status === 'accepted' ? 'Участие принято' : status === 'declined' ? 'Вы отказались от поездки' : 'Предложение отправлено организатору');
      loadData();
      setCounterTrip(null); setCounterStartDate(''); setCounterEndDate(''); setCounterLocation('');
    } catch (err) { showToast(formatUserError(err, 'Не удалось обновить ответ')); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-stone-400">Загрузка…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Поездки</h1>
          <p className="text-stone-500 mt-1">Планируйте путешествия вместе</p>
        </div>
        <Button onClick={openCreateForm} disabled={groups.filter((g) => g.status !== 'archived').length === 0} className="!px-3">
          <Plus size={18} className="sm:mr-1" />
          <span className="hidden sm:inline">Поездка</span>
        </Button>
      </div>

      {groups.filter((g) => g.status !== 'archived').length === 0 ? (
        <EmptyState
          icon={<Plane size={28} />}
          title="Сначала создайте группу"
          description="Поездки привязаны к группам. Создайте группу и добавьте подруг."
        />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<Plane size={28} />}
          title="Поездок пока нет"
          description="Запланируйте первое путешествие с подругами"
          action={<Button onClick={openCreateForm}><Plus size={16} className="mr-1" />Создать поездку</Button>}
        />
      ) : (
        <div className="space-y-3">
          {trips.map((t) => {
            const parts = participants[t.id] || [];
            const groupMembersList = groupMembers[t.group_id] || [];
            return (
              <div key={t.id} className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-stone-800">{t.title}</h3>
                    <p className="text-xs text-stone-400 mt-0.5">{t.group_name}</p>
                  </div>
                  {t.created_by === user?.id && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEditForm(t)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors text-xs font-medium"
                      title="Редактировать"
                    >
                      <Pencil size={14} />
                      Редактировать
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      className="p-2 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-400 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  )}
                </div>
                <div className="space-y-1.5 text-sm text-stone-600">
                  <div className="flex items-center gap-2">
                    <CalIcon size={14} className="text-stone-400" />
                    <span>
                      {format(parseISO(t.start_date), 'd MMM', { locale: ru })} — {format(parseISO(t.end_date), 'd MMMM', { locale: ru })}
                    </span>
                  </div>
                  {t.destination && (
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-stone-400" />
                      <span>{t.destination}</span>
                    </div>
                  )}
                </div>
                {t.notes && <p className="text-sm text-stone-500 mt-2">{t.notes}</p>}
                {parts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {parts.map((p) => {
                      const member = groupMembersList.find((gm) => gm.user_id === p.user_id);
                      return (
                        <span key={p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-50 text-xs text-stone-600">
                          <span>{member?.avatar_emoji || '🌸'}</span>
                          {member?.display_name || 'Участница'} · {invitationStatusLabel(p.status)}
                          {p.status === 'counter_proposed' && (
                            <span className="text-stone-400">
                              {p.counter_start_date || p.counter_date || p.counter_location
                                ? ` (${[p.counter_start_date || p.counter_date, p.counter_end_date, p.counter_location].filter(Boolean).join(' — ')})`
                                : ''}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
                {parts.find((p) => p.user_id === user?.id)?.status === 'pending' && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button onClick={() => handleResponse(t.id, 'accepted')} className="!py-1.5 !px-3 text-xs">Подтвердить</Button>
                    <Button variant="secondary" onClick={() => handleResponse(t.id, 'declined')} className="!py-1.5 !px-3 text-xs">Отказаться</Button>
                    <Button variant="secondary" onClick={() => { setCounterTrip(t); setCounterStartDate(t.start_date); setCounterEndDate(t.end_date); setCounterLocation(t.destination || ''); }} className="!py-1.5 !px-3 text-xs">Предложить другое</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); resetForm(); }}
        title={editingTrip ? 'Редактировать поездку' : 'Новая поездка'}
      >
        <div className="space-y-4">
          <FormField label="Группа">
            <select
              value={selectedGroup}
              onChange={(e) => handleGroupChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
            >
              <option value="">Выберите группу</option>
              {groups.filter((g) => g.status !== 'archived').map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Название">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Питер с девочками" autoFocus />
          </FormField>

          <FormField label="Куда едете">
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Город или страна" />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Дата начала">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormField>
            <FormField label="Дата окончания">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Заметки">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Что-то важное" />
          </FormField>

          {selectedGroup && (groupMembers[selectedGroup] || []).length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-700">Участницы</p>
              {(groupMembers[selectedGroup] || []).map((m) => {
                const isOrganizer = m.user_id === user?.id;
                return (
                <label key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(m.user_id) || isOrganizer}
                    disabled={isOrganizer}
                    onChange={(e) => {
                      if (isOrganizer) return;
                      const next = new Set(selectedParticipants);
                      if (e.target.checked) next.add(m.user_id);
                      else next.delete(m.user_id);
                      setSelectedParticipants(withOrganizer(next, user?.id || ''));
                    }}
                    className="w-4 h-4 rounded accent-rose-400"
                  />
                  <span className="text-lg">{m.avatar_emoji || '🌸'}</span>
                  <span className="text-sm text-stone-700">
                    {m.display_name || 'Без имени'}
                    {isOrganizer && <span className="text-xs text-rose-400 ml-1.5">организатор</span>}
                  </span>
                </label>
                );
              })}
            </div>
          ) : selectedGroup ? (
            <p className="text-sm text-stone-400">В этой группе пока нет участниц</p>
          ) : null}

          {(validationError || saveError) && (
            <ErrorMessage message={validationError || saveError || ''} />
          )}

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }} className="flex-1">Отмена</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">
              {editingTrip ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!counterTrip} onClose={() => setCounterTrip(null)} title="Предложить другую поездку">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Дата начала"><Input type="date" value={counterStartDate} onChange={(e) => setCounterStartDate(e.target.value)} /></FormField>
            <FormField label="Дата окончания"><Input type="date" value={counterEndDate} onChange={(e) => setCounterEndDate(e.target.value)} /></FormField>
          </div>
          <FormField label="Место"><Input value={counterLocation} onChange={(e) => setCounterLocation(e.target.value)} placeholder="Например, другое направление" /></FormField>
          <div className="flex gap-3"><Button variant="secondary" onClick={() => setCounterTrip(null)} className="flex-1">Отмена</Button><Button onClick={() => counterTrip && handleResponse(counterTrip.id, 'counter_proposed')} className="flex-1">Отправить</Button></div>
        </div>
      </Modal>

      {toast && <Toast message={toast} />}
    </div>
  );
}
