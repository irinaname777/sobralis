import { useEffect, useState, useCallback, useMemo } from 'react';
import { Receipt, Plus, Trash2, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Expense, ExpenseParticipant, Group, GroupMember } from '@/types';
import { calculateBalances, optimizeDebts, calculateEqualShares, type DebtSettlement } from '@/lib/expenses/debtCalculator';
import { Modal, Input, Button, FormField, EmptyState, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

export function ExpensesPage() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<(Expense & { group_name?: string })[]>([]);
  const [expenseParts, setExpenseParts] = useState<Record<string, ExpenseParticipant[]>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSettlements, setShowSettlements] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Form state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [splitMethod, setSplitMethod] = useState<'equal' | 'manual'>('equal');
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [manualShares, setManualShares] = useState<Record<string, string>>({});
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

      if (groupIds.length === 0) {
        setExpenses([]);
        setGroups([]);
        setLoading(false);
        return;
      }

      const { data: groupsData } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds)
        .order('created_at', { ascending: false });
      setGroups((groupsData as Group[]) || []);

      const { data: expensesData } = await supabase
        .from('expenses')
        .select('*, groups(name)')
        .in('group_id', groupIds)
        .order('expense_date', { ascending: false });

      const expWithGroup = (expensesData as (Expense & { groups: { name: string } | null })[]) || [];
      setExpenses(expWithGroup.map((e) => ({ ...e, group_name: e.groups?.name })));

      if (expWithGroup.length > 0) {
        const { data: partsData } = await supabase
          .from('expense_participants')
          .select('*')
          .in('expense_id', expWithGroup.map((e) => e.id));
        const partsMap: Record<string, ExpenseParticipant[]> = {};
        for (const p of (partsData as ExpenseParticipant[]) || []) {
          if (!partsMap[p.expense_id]) partsMap[p.expense_id] = [];
          partsMap[p.expense_id].push(p);
        }
        setExpenseParts(partsMap);
      }

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
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate balances and settlements
  const allParticipants = useMemo(() => {
    return Object.values(expenseParts).flat();
  }, [expenseParts]);

  const balances = useMemo(() => calculateBalances(expenses, allParticipants), [expenses, allParticipants]);
  const settlements = useMemo(() => optimizeDebts(balances), [balances]);

  const myBalance = balances.get(user?.id || '');
  const iOwe = myBalance && myBalance.netBalance < 0 ? Math.abs(myBalance.netBalance) : 0;
  const owedToMe = myBalance && myBalance.netBalance > 0 ? myBalance.netBalance : 0;

  const resetForm = () => {
    setSelectedGroup('');
    setTitle('');
    setAmount('');
    setPaidBy('');
    setSplitMethod('equal');
    setSelectedParticipants(new Set());
    setManualShares({});
    setValidationError(null);
  };

  const openCreateForm = () => {
    resetForm();
    if (groups.length > 0) {
      setSelectedGroup(groups[0].id);
      const members = groupMembers[groups[0].id] || [];
      setSelectedParticipants(new Set(members.map((m) => m.user_id)));
      if (members.length > 0) setPaidBy(user?.id || '');
    }
    setShowForm(true);
  };

  const handleGroupChange = (groupId: string) => {
    setSelectedGroup(groupId);
    const members = groupMembers[groupId] || [];
    setSelectedParticipants(new Set(members.map((m) => m.user_id)));
    setManualShares({});
    if (members.length > 0) setPaidBy(user?.id || '');
  };

  const handleSave = async () => {
    if (!user) return;
    setValidationError(null);

    if (!title.trim()) { setValidationError('Введите название расхода'); return; }
    if (!selectedGroup) { setValidationError('Выберите группу'); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setValidationError('Сумма должна быть больше нуля'); return; }
    if (!paidBy) { setValidationError('Укажите, кто заплатил'); return; }
    if (selectedParticipants.size === 0) { setValidationError('Выберите участниц'); return; }

    // Calculate shares
    const participantArray = Array.from(selectedParticipants);
    let shares: Record<string, number> = {};

    if (splitMethod === 'equal') {
      const equalShares = calculateEqualShares(amt, participantArray.length);
      participantArray.forEach((uid, i) => {
        shares[uid] = equalShares[i];
      });
    } else {
      // Manual
      let total = 0;
      for (const uid of participantArray) {
        const s = parseFloat(manualShares[uid] || '0');
        if (isNaN(s) || s < 0) {
          setValidationError('Все суммы должны быть положительными числами');
          return;
        }
        shares[uid] = s;
        total += s;
      }
      const roundedTotal = Math.round(total * 100) / 100;
      const roundedAmt = Math.round(amt * 100) / 100;
      if (Math.abs(roundedTotal - roundedAmt) > 0.01) {
        setValidationError(`Сумма распределения (${roundedTotal} ₽) не равна общей сумме (${roundedAmt} ₽)`);
        return;
      }
    }

    const result = await runSave(async () => {
      const { data: expense, error } = await supabase
        .from('expenses')
        .insert({
          group_id: selectedGroup,
          title: title.trim(),
          amount: amt,
          paid_by: paidBy,
          split_method: splitMethod,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const partRows = participantArray.map((uid) => ({
        expense_id: expense.id,
        user_id: uid,
        share_amount: shares[uid],
      }));

      const { error: partError } = await supabase
        .from('expense_participants')
        .insert(partRows);
      if (partError) throw partError;
    });

    if (result !== null) {
      setShowForm(false);
      resetForm();
      showToast('Расход добавлен');
      loadData();
    }
  };

  const handleDelete = async (expense: Expense) => {
    if (!confirm(`Удалить расход «${expense.title}»?`)) return;
    const { error } = await supabase.from('expenses').delete().eq('id', expense.id);
    if (!error) {
      showToast('Расход удалён');
      loadData();
    }
  };

  const getMemberName = (groupId: string, userId: string) => {
    const m = (groupMembers[groupId] || []).find((gm) => gm.user_id === userId);
    return m?.display_name || 'Участница';
  };

  const getMemberEmoji = (groupId: string, userId: string) => {
    const m = (groupMembers[groupId] || []).find((gm) => gm.user_id === userId);
    return m?.avatar_emoji || '🌸';
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-stone-400">Загрузка…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Расходы</h1>
          <p className="text-stone-500 mt-1">Делите расходы и считайте долги</p>
        </div>
        <div className="flex gap-2">
          {settlements.length > 0 && (
            <Button variant="secondary" onClick={() => setShowSettlements(true)} className="!px-3">
              <ArrowRight size={18} className="sm:mr-1" />
              <span className="hidden sm:inline">Долги</span>
            </Button>
          )}
          <Button onClick={openCreateForm} disabled={groups.length === 0} className="!px-3">
            <Plus size={18} className="sm:mr-1" />
            <span className="hidden sm:inline">Расход</span>
          </Button>
        </div>
      </div>

      {/* Balance summary */}
      {expenses.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="text-orange-400" size={16} />
              <span className="text-xs text-stone-500">Ты должна</span>
            </div>
            <p className="text-xl font-bold text-stone-800">{iOwe > 0 ? `${iOwe.toLocaleString('ru-RU')} ₽` : '—'}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="text-emerald-500" size={16} />
              <span className="text-xs text-stone-500">Тебе должны</span>
            </div>
            <p className="text-xl font-bold text-stone-800">{owedToMe > 0 ? `${owedToMe.toLocaleString('ru-RU')} ₽` : '—'}</p>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Сначала создайте группу"
          description="Расходы привязаны к группам. Создайте группу и добавьте подруг."
        />
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Расходов пока нет"
          description="Добавьте первый расход и разделите его между участницами"
          action={<Button onClick={openCreateForm}><Plus size={16} className="mr-1" />Добавить расход</Button>}
        />
      ) : (
        <div className="space-y-3">
          {expenses.map((e) => {
            const parts = expenseParts[e.id] || [];
            return (
              <div key={e.id} className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-stone-800">{e.title}</h3>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {e.group_name} · {format(parseISO(e.expense_date), 'd MMMM', { locale: ru })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-800">{Number(e.amount).toLocaleString('ru-RU')} ₽</span>
                    <button onClick={() => handleDelete(e)} className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="text-sm text-stone-600">
                  Заплатила: <span className="font-medium">{getMemberEmoji(e.group_id, e.paid_by)} {getMemberName(e.group_id, e.paid_by)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {parts.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-50 text-xs text-stone-600">
                      <span>{getMemberEmoji(e.group_id, p.user_id)}</span>
                      {getMemberName(e.group_id, p.user_id)}: {Number(p.share_amount).toLocaleString('ru-RU')} ₽
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create expense modal */}
      <Modal open={showForm} onClose={() => { setShowForm(false); resetForm(); }} title="Новый расход">
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
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Такси" autoFocus />
          </FormField>

          <FormField label="Сумма (₽)">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" min="0" step="0.01" />
          </FormField>

          {selectedGroup && (groupMembers[selectedGroup] || []).length > 0 && (
            <FormField label="Кто заплатил">
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
              >
                {(groupMembers[selectedGroup] || []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.avatar_emoji} {m.display_name || 'Участница'}</option>
                ))}
              </select>
            </FormField>
          )}

          {/* Split method */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-700">Как делить</p>
            <div className="flex gap-2">
              <button
                onClick={() => setSplitMethod('equal')}
                className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                  splitMethod === 'equal' ? 'border-rose-400 bg-rose-50 text-rose-600' : 'border-stone-200 text-stone-500 hover:border-stone-300'
                }`}
              >
                Поровну
              </button>
              <button
                onClick={() => setSplitMethod('manual')}
                className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                  splitMethod === 'manual' ? 'border-rose-400 bg-rose-50 text-rose-600' : 'border-stone-200 text-stone-500 hover:border-stone-300'
                }`}
              >
                Вручную
              </button>
            </div>
          </div>

          {/* Participants */}
          {selectedGroup && (groupMembers[selectedGroup] || []).length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-700">Участницы расхода</p>
              {(groupMembers[selectedGroup] || []).map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(m.user_id)}
                    onChange={(e) => {
                      const next = new Set(selectedParticipants);
                      if (e.target.checked) next.add(m.user_id);
                      else next.delete(m.user_id);
                      setSelectedParticipants(next);
                    }}
                    className="w-4 h-4 rounded accent-rose-400"
                  />
                  <span className="text-lg">{m.avatar_emoji || '🌸'}</span>
                  <span className="text-sm text-stone-700 flex-1">{m.display_name || 'Без имени'}</span>
                  {splitMethod === 'manual' && selectedParticipants.has(m.user_id) && (
                    <Input
                      type="number"
                      value={manualShares[m.user_id] || ''}
                      onChange={(e) => setManualShares({ ...manualShares, [m.user_id]: e.target.value })}
                      placeholder="0"
                      className="!w-24 !py-1.5 text-sm"
                      min="0"
                      step="0.01"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {(validationError || saveError) && (
            <ErrorMessage message={validationError || saveError || ''} />
          )}

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }} className="flex-1">Отмена</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">Добавить</Button>
          </div>
        </div>
      </Modal>

      {/* Settlements modal */}
      <Modal open={showSettlements} onClose={() => setShowSettlements(false)} title="Взаиморасчёты">
        <div className="space-y-3">
          {settlements.length === 0 ? (
            <p className="text-center text-stone-400 py-4">Все долги закрыты!</p>
          ) : (
            settlements.map((s: DebtSettlement, i) => (
              <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex -space-x-2">
                  <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-sm ring-2 ring-white">
                    {getMemberEmoji('', s.fromUserId)}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-sm ring-2 ring-white">
                    {getMemberEmoji('', s.toUserId)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-600">
                    <span className="font-medium text-stone-800">{getMemberName('', s.fromUserId)}</span>
                    {' → '}
                    <span className="font-medium text-stone-800">{getMemberName('', s.toUserId)}</span>
                  </p>
                </div>
                <span className="font-bold text-stone-800">{s.amount.toLocaleString('ru-RU')} ₽</span>
              </div>
            ))
          )}
        </div>
      </Modal>

      {toast && <Toast message={toast} />}
    </div>
  );
}
