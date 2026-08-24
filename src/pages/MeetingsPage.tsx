import { useEffect, useState, useCallback } from 'react';
import { Coffee, Plus, Trash2, MapPin, Clock, Calendar as CalIcon, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Meeting, Group, GroupMember, MeetingParticipant } from '@/types';
import { Modal, Input, Button, FormField, EmptyState, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { fetchGroupMembers, syncEventParticipants, organizerOnlySelection, withOrganizer } from '@/lib/participants';
import { formatUserError } from '@/lib/errors';
import { format, parseISO, isToday, isFuture, isPast } from 'date-fns';
import { ru } from 'date-fns/locale';

export function MeetingsPage() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<(Meeting & { group_name?: string })[]>([]);
  const [participants, setParticipants] = useState<Record<string, MeetingParticipant[]>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Form state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
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

      const { data: meetingsData } = await supabase
        .from('meetings')
        .select('*, groups(name)')
        .order('meeting_date', { ascending: true });

      const meetingsWithGroup = (meetingsData as (Meeting & { groups: { name: string } | null })[]) || [];
      setMeetings(meetingsWithGroup.map((m) => ({ ...m, group_name: m.groups?.name })));

      // Load participants
      if (meetingsWithGroup.length > 0) {
        const { data: partsData } = await supabase
          .from('meeting_participants')
          .select('*')
          .in('meeting_id', meetingsWithGroup.map((m) => m.id));
        const partsMap: Record<string, MeetingParticipant[]> = {};
        for (const p of (partsData as MeetingParticipant[]) || []) {
          if (!partsMap[p.meeting_id]) partsMap[p.meeting_id] = [];
          partsMap[p.meeting_id].push(p);
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
        for (const m of (allMembers as GroupMember[]) || []) {
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
    setDate('');
    setTime('');
    setLocation('');
    setDescription('');
    setSelectedParticipants(new Set());
    setValidationError(null);
    setEditingMeeting(null);
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
    const groupId = groups[0]?.id || '';
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

  const openEditForm = async (meeting: Meeting) => {
    setEditingMeeting(meeting);
    setSelectedGroup(meeting.group_id);
    setTitle(meeting.title);
    setDate(meeting.meeting_date);
    setTime(meeting.meeting_time || '');
    setLocation(meeting.location || '');
    setDescription(meeting.description || '');
    const parts = participants[meeting.id] || [];
    setSelectedParticipants(withOrganizer(parts.map((p) => p.user_id), user?.id || meeting.created_by));
    setShowForm(true);
    try {
      await loadMembersForGroup(meeting.group_id);
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

    if (!title.trim()) {
      setValidationError('Введите название встречи');
      return;
    }
    if (!selectedGroup) {
      setValidationError('Выберите группу');
      return;
    }
    if (!date) {
      setValidationError('Выберите дату');
      return;
    }

    const invitees = withOrganizer(selectedParticipants, user.id);

    const result = await runSave(async () => {
      const payload = {
        group_id: selectedGroup,
        title: title.trim(),
        meeting_date: date,
        meeting_time: time || null,
        location: location.trim() || null,
        description: description.trim() || null,
      };

      if (editingMeeting) {
        const { error } = await supabase
          .from('meetings')
          .update(payload)
          .eq('id', editingMeeting.id);
        if (error) throw error;

        const existing = (participants[editingMeeting.id] || []).map((p) => p.user_id);
        await syncEventParticipants(
          'meeting',
          editingMeeting.id,
          Array.from(invitees),
          existing,
          user.id
        );
      } else {
        const { data, error } = await supabase
          .from('meetings')
          .insert({ ...payload, created_by: user.id })
          .select()
          .single();
        if (error) throw error;
        const createdId = data.id as string;

        try {
          await syncEventParticipants(
            'meeting',
            createdId,
            Array.from(invitees),
            [],
            user.id
          );
        } catch (partError) {
          await supabase.from('meetings').delete().eq('id', createdId);
          throw partError;
        }
      }
    });

    if (result !== null) {
      setShowForm(false);
      resetForm();
      showToast(editingMeeting ? 'Встреча обновлена' : 'Встреча создана');
      loadData();
    }
  };

  const handleDelete = async (meeting: Meeting) => {
    if (!confirm(`Удалить встречу «${meeting.title}»?`)) return;
    const { error } = await supabase.from('meetings').delete().eq('id', meeting.id);
    if (!error) {
      showToast('Встреча удалена');
      loadData();
    }
  };

  const upcoming = meetings.filter((m) => {
    const d = parseISO(m.meeting_date);
    return isToday(d) || isFuture(d);
  });
  const past = meetings.filter((m) => isPast(parseISO(m.meeting_date)) && !isToday(parseISO(m.meeting_date)));

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-stone-400">Загрузка…</div>;
  }

  const renderMeeting = (m: Meeting & { group_name?: string }) => {
    const parts = participants[m.id] || [];
    const groupMembersList = groupMembers[m.group_id] || [];
    return (
      <div key={m.id} className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-stone-800">{m.title}</h3>
            <p className="text-xs text-stone-400 mt-0.5">{m.group_name}</p>
          </div>
          {m.created_by === user?.id && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => openEditForm(m)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors text-xs font-medium"
              title="Редактировать"
            >
              <Pencil size={14} />
              Редактировать
            </button>
            <button
              type="button"
              onClick={() => handleDelete(m)}
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
            <span>{format(parseISO(m.meeting_date), 'd MMMM, EEE', { locale: ru })}</span>
            {m.meeting_time && (
              <>
                <Clock size={14} className="text-stone-400 ml-2" />
                <span>{m.meeting_time}</span>
              </>
            )}
          </div>
          {m.location && (
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-stone-400" />
              <span>{m.location}</span>
            </div>
          )}
        </div>
        {m.description && <p className="text-sm text-stone-500 mt-2">{m.description}</p>}
        {parts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {parts.map((p) => {
              const member = groupMembersList.find((gm) => gm.user_id === p.user_id);
              return (
                <span key={p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-50 text-xs text-stone-600">
                  <span>{member?.avatar_emoji || '🌸'}</span>
                  {member?.display_name || 'Участница'}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Встречи</h1>
          <p className="text-stone-500 mt-1">Планируйте встречи с подругами</p>
        </div>
        <Button onClick={openCreateForm} disabled={groups.length === 0} className="!px-3">
          <Plus size={18} className="sm:mr-1" />
          <span className="hidden sm:inline">Встреча</span>
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Coffee size={28} />}
          title="Сначала создайте группу"
          description="Встречи привязаны к группам. Создайте группу и добавьте подруг."
        />
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          icon={<Coffee size={28} />}
          title="Пока нет запланированных встреч"
          description="Создайте первую встречу и пригласите подруг"
          action={<Button onClick={openCreateForm}><Plus size={16} className="mr-1" />Создать встречу</Button>}
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">Предстоящие</h2>
              {upcoming.map(renderMeeting)}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">Прошедшие</h2>
              {past.map(renderMeeting)}
            </div>
          )}
        </>
      )}

      {/* Form Modal */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); resetForm(); }}
        title={editingMeeting ? 'Редактировать встречу' : 'Новая встреча'}
      >
        <div className="space-y-4">
          <FormField label="Группа">
            <select
              value={selectedGroup}
              onChange={(e) => handleGroupChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
            >
              <option value="">Выберите группу</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Название">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Девичник" autoFocus />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Дата">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label="Время">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Место">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Например, Москва" />
          </FormField>

          <FormField label="Описание">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Дополнительная информация" />
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
              {editingMeeting ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast} />}
    </div>
  );
}
