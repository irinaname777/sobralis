import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, Link2, Copy, Check, Trash2, UserPlus, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, GroupMember, GroupInvitation } from '@/types';
import { Modal, Input, Button, FormField, EmptyState, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { formatUserError } from '@/lib/errors';

export function GroupsPage() {
  const { user, profile } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Create group form
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const { loading: creating, error: createError, run: runCreate } = useAsyncAction();

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
      if (groupIds.length === 0) {
        setGroups([]);
        setMembers({});
        setLoading(false);
        return;
      }

      const { data: groupsData } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds)
        .order('created_at', { ascending: false });

      setGroups((groupsData as Group[]) || []);

      // Load members for each group
      const { data: membersData } = await supabase
        .from('group_members')
        .select('*')
        .in('group_id', groupIds)
        .order('created_at', { ascending: true });

      const membersMap: Record<string, GroupMember[]> = {};
      for (const m of (membersData as GroupMember[]) || []) {
        if (!membersMap[m.group_id]) membersMap[m.group_id] = [];
        membersMap[m.group_id].push(m);
      }
      setMembers(membersMap);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateGroup = async () => {
    if (!user || !groupName.trim()) return;
    const result = await runCreate(async () => {
      const { data, error } = await supabase
        .from('groups')
        .insert({ name: groupName.trim(), description: groupDesc.trim() || null, owner_id: user.id })
        .select()
        .single();

      if (error) throw error;
      return data;
    });

    if (result) {
      setShowCreate(false);
      setGroupName('');
      setGroupDesc('');
      showToast('Группа создана');
      loadData();
    }
  };

  const handleCreateInvite = async (groupId: string) => {
    if (!user) return;
    const code = Math.random().toString(36).substring(2, 10);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('group_invitations')
      .insert({
        group_id: groupId,
        invite_code: code,
        created_by: user.id,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error || !data) {
      showToast(formatUserError(error, 'Не удалось создать приглашение'));
      return;
    }
    setInviteCode(code);
    setShowInvite(groupId);
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/invite/${inviteCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemoveMember = async (memberId: string, groupId: string) => {
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('id', memberId);

    if (!error) {
      showToast('Участница удалена');
      loadData();
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('Удалить группу? Все данные группы будут потеряны.')) return;
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    if (!error) {
      showToast('Группа удалена');
      loadData();
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-stone-400">Загрузка…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Группы</h1>
          <p className="text-stone-500 mt-1">Твои компании подруг</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="!px-3">
          <Plus size={18} className="sm:mr-1" />
          <span className="hidden sm:inline">Создать</span>
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Здесь пока никого нет"
          description="Создайте группу и пригласите подруг, чтобы планировать встречи вместе"
          action={<Button onClick={() => setShowCreate(true)}><Plus size={16} className="mr-1" />Создать группу</Button>}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const groupMembers = members[group.id] || [];
            const isOwner = group.owner_id === user?.id;
            return (
              <div key={group.id} className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-stone-800">{group.name}</h3>
                    {group.description && <p className="text-sm text-stone-500 mt-0.5">{group.description}</p>}
                  </div>
                  {isOwner && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleCreateInvite(group.id)}
                        className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors"
                        title="Пригласить"
                      >
                        <UserPlus size={18} />
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(group.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-400 transition-colors"
                        title="Удалить группу"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {groupMembers.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-1.5">
                      <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-lg">
                        {m.avatar_emoji || '🌸'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-700 truncate">
                          {m.display_name || 'Без имени'}
                          {m.role === 'owner' && <span className="text-xs text-rose-400 ml-1.5">владелец</span>}
                        </p>
                        {m.user_id === user?.id && <p className="text-xs text-stone-400">это вы</p>}
                      </div>
                      {isOwner && m.user_id !== user?.id && (
                        <button
                          onClick={() => handleRemoveMember(m.id, group.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {isOwner && (
                  <button
                    onClick={() => handleCreateInvite(group.id)}
                    className="mt-3 flex items-center gap-2 text-sm text-rose-500 font-medium hover:text-rose-600"
                  >
                    <Link2 size={14} />
                    Пригласить подругу
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create group modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Новая группа">
        <div className="space-y-4">
          <FormField label="Название группы">
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Например, Наши девочки ❤️"
              autoFocus
            />
          </FormField>
          <FormField label="Описание (необязательно)">
            <Input
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="О чём ваша группа"
            />
          </FormField>
          {createError && <ErrorMessage message={createError} />}
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" onClick={() => setShowCreate(false)} className="flex-1">Отмена</Button>
            <Button onClick={handleCreateGroup} loading={creating} disabled={!groupName.trim()} className="flex-1">
              Создать
            </Button>
          </div>
        </div>
      </Modal>

      {/* Invite modal */}
      <Modal open={!!showInvite} onClose={() => { setShowInvite(null); setInviteCode(''); }} title="Приглашение в группу">
        {inviteCode && (
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              Поделитесь этой ссылкой с подругой. Она сможет присоединиться к группе после регистрации.
            </p>
            <div className="flex items-center gap-2 bg-stone-50 rounded-xl p-3 border border-stone-200">
              <input
                readOnly
                value={`${window.location.origin}/invite/${inviteCode}`}
                className="flex-1 bg-transparent text-sm text-stone-600 outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="p-2 rounded-lg bg-rose-100 text-rose-500 hover:bg-rose-200 transition-colors"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <p className="text-xs text-stone-400">
              Код приглашения: <span className="font-mono font-medium">{inviteCode}</span>
              . Ссылка действует 14 дней и рассчитана на одного человека.
            </p>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast} />}
    </div>
  );
}
