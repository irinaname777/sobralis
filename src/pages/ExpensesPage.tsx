import { useEffect, useState, useCallback, useMemo } from 'react';
import { Receipt, Plus, Trash2, Pencil, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Expense, ExpenseParticipant, ExpenseObligation, Group, GroupMember } from '@/types';
import { calculateBalances, optimizeDebts, calculateEqualShares, type DebtSettlement } from '@/lib/expenses/debtCalculator';
import { Modal, Input, Button, FormField, EmptyState, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

export function ExpensesPage() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<(Expense & { group_name?: string })[]>([]);
  const [expenseParts, setExpenseParts] = useState<Record<string, ExpenseParticipant[]>>({});
  const [obligations, setObligations] = useState<ExpenseObligation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [showSettlements, setShowSettlements] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [paymentObligation, setPaymentObligation] = useState<ExpenseObligation | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

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

        const { data: obligationData } = await supabase
          .from('expense_obligations')
          .select('*')
          .in('expense_id', expWithGroup.map((e) => e.id))
          .order('created_at', { ascending: false });
        setObligations((obligationData as ExpenseObligation[]) || []);
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
    setEditingExpense(null);
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

  const openEditForm = (expense: Expense) => {
    const parts = expenseParts[expense.id] || [];

    setEditingExpense(expense);
    setSelectedGroup(expense.group_id);
    setTitle(expense.title);
    setAmount(String(expense.amount));
    setPaidBy(expense.paid_by);
    setSplitMethod(expense.split_method as 'equal' | 'manual');

    const participantIds = new Set(parts.map((p) => p.user_id));
    setSelectedParticipants(participantIds);

    const shares: Record<string, string> = {};
    for (const p of parts) {
      shares[p.user_id] = String(p.share_amount);
    }
    setManualShares(shares);

    setValidationError(null);
    setShowForm(true);
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

  const handleUpdate = async () => {
    if (!user || !editingExpense) return;

    setValidationError(null);

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setValidationError('Сумма должна быть больше нуля');
      return;
    }

    const participantArray = Array.from(selectedParticipants);

    if (participantArray.length === 0) {
      setValidationError('У расхода должна остаться хотя бы одна участница');
      return;
    }

    const shares: Record<string, number> = {};

    if (splitMethod === 'equal') {
      const equalShares = calculateEqualShares(amt, participantArray.length);

      participantArray.forEach((uid, i) => {
        shares[uid] = equalShares[i];
      });
    } else {
      let total = 0;

      for (const uid of participantArray) {
        const s = parseFloat(manualShares[uid] || '0');

        if (isNaN(s) || s < 0) {
          setValidationError('Все суммы должны быть неотрицательными числами');
          return;
        }

        shares[uid] = s;
        total += s;
      }

      const roundedTotal = Math.round(total * 100) / 100;
      const roundedAmt = Math.round(amt * 100) / 100;

      if (Math.abs(roundedTotal - roundedAmt) > 0.01) {
        setValidationError(
          `Сумма распределения (${roundedTotal} ₽) не равна общей сумме (${roundedAmt} ₽)`
        );
        return;
      }
    }

    const result = await runSave(async () => {
      const { error } = await supabase.rpc('update_expense', {
        _expense_id: editingExpense.id,
        _amount: amt,
        _split_method: splitMethod,
        _shares: participantArray.map((userId) => ({
          user_id: userId,
          share_amount: shares[userId],
        })),
      });

      if (error) throw error;
    });

    if (result !== null) {
      setShowForm(false);
      setEditingExpense(null);
      resetForm();
      showToast('Расход изменён');
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

  const handleMarkPaid = (obligation: ExpenseObligation) => {
    setPaymentObligation(obligation);
    setPaymentAmount('');
    setPaymentError(null);
  };

  const handleSubmitPayment = async () => {
    if (!paymentObligation) return;

    const value = Number(paymentAmount.replace(',', '.'));
    const remaining = Number(paymentObligation.amount);

    if (!Number.isFinite(value) || value <= 0) {
      setPaymentError('Введите сумму больше нуля');
      return;
    }

    if (value > remaining) {
      setPaymentError(
        `Сумма не может быть больше остатка ${remaining.toLocaleString('ru-RU')} ₽`
      );
      return;
    }

    setPaymentLoading(true);

    const { error } = await supabase.rpc('mark_obligation_paid', {
      _obligation_id: paymentObligation.id,
      _payment_amount: value,
    });

    setPaymentLoading(false);

    if (error) {
      setPaymentError(error.message || 'Не удалось отметить перевод');
      return;
    }

    setPaymentObligation(null);
    setPaymentAmount('');
    setPaymentError(null);
    showToast('Перевод заявлен и ожидает подтверждения');
    loadData();
  };

  const handleConfirmPaid = async (id: string) => {
    const { error } = await supabase.rpc('confirm_obligation_payment', { _obligation_id: id });
    if (error) { showToast('Не удалось подтвердить перевод'); return; }
    showToast('Оплата подтверждена');
    loadData();
  };

  const handleRejectPaid = async (id: string) => {
    const { error } = await supabase.rpc('reject_obligation_payment', {
      _obligation_id: id,
    });
    if (error) { showToast('Не удалось отклонить подтверждение'); return; }
    showToast('Оплата не подтверждена, долг снова отмечен как неоплаченный');
    loadData();
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
            const expenseObligations = obligations.filter((o) => o.expense_id === e.id);
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

                    {groups.find((g) => g.id === e.group_id)?.owner_id === user?.id && (
                      <button
                        onClick={() => openEditForm(e)}
                        className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-300 hover:text-stone-600 transition-colors"
                        title="Редактировать расход"
                      >
                        <Pencil size={16} />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(e)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
                    >
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
                {expenseObligations.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Обязательства</p>
                    {expenseObligations.map((o) => (
                      <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm bg-stone-50 rounded-xl px-3 py-2">
                        <span className="text-stone-700">{getMemberName(e.group_id, o.debtor_id)} должна {getMemberName(e.group_id, o.creditor_id)} — <b>{Number(o.amount).toLocaleString('ru-RU')} ₽</b></span>
                        {o.status === 'unpaid' && o.debtor_id === user?.id && (
  <Button
    onClick={() => handleMarkPaid(o)}
    className="!py-1 !px-2 text-xs"
  >
    Я перечислила
  </Button>
)}
                        {o.status === 'payment_pending_confirmation' && o.creditor_id === user?.id && (
                          <div className="w-full space-y-2">
                            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-stone-700">
                              <div>
                                Остаток обязательства:{' '}
                                <b>{Number(o.amount).toLocaleString('ru-RU')} ₽</b>
                              </div>
                              <div>
                                Должник указал платёж:{' '}
                                <b>{Number(o.pending_payment_amount || 0).toLocaleString('ru-RU')} ₽</b>
                              </div>
                              <div className="text-stone-500">
                                После подтверждения останется:{' '}
                                <b>
                                  {Math.max(
                                    0,
                                    Number(o.amount) - Number(o.pending_payment_amount || 0)
                                  ).toLocaleString('ru-RU')}{' '}
                                  ₽
                                </b>
                              </div>
                            </div>

                            <div className="flex gap-2 flex-wrap">
                              <Button
                                onClick={() => handleConfirmPaid(o.id)}
                                className="!py-1 !px-2 text-xs"
                              >
                                Получила деньги
                              </Button>
                              <Button
                                onClick={() => handleRejectPaid(o.id)}
                                className="!py-1 !px-2 text-xs"
                              >
                                Не получила
                              </Button>
                            </div>
                          </div>
                        )}
                        {o.status === 'unpaid' && o.debtor_id !== user?.id && <span className="text-xs text-amber-600">Не оплачено</span>}
                        {o.status === 'payment_pending_confirmation' && o.creditor_id !== user?.id && <span className="text-xs text-amber-600">Ожидает подтверждения</span>}
                        {o.status === 'settled' && <span className="text-xs text-emerald-600">Погашено</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create expense modal */}
      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          resetForm();
        }}
        title={editingExpense ? 'Редактировать расход' : 'Новый расход'}
      >
        <div className="space-y-4">
          {!editingExpense && (
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
          )}

          {!editingExpense && (
            <FormField label="Название">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например, Такси"
                autoFocus
              />
            </FormField>
          )}

          <FormField label="Сумма (₽)">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" min="0" step="0.01" />
          </FormField>

          {!editingExpense && selectedGroup && (groupMembers[selectedGroup] || []).length > 0 && (
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
              {(groupMembers[selectedGroup] || [])
                .filter((m) => !editingExpense || selectedParticipants.has(m.user_id))
                .map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(m.user_id)}
                    disabled={!!editingExpense}
                    onChange={(e) => {
                      const next = new Set(selectedParticipants);
                      if (e.target.checked) next.add(m.user_id);
                      else next.delete(m.user_id);
                      setSelectedParticipants(next);
                    }}
                    className="w-4 h-4 rounded accent-rose-400 disabled:opacity-50"
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
            <Button
              onClick={editingExpense ? handleUpdate : handleSave}
              loading={saving}
              className="flex-1"
            >
              {editingExpense ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Settlements modal */}
      <Modal
        open={!!paymentObligation}
        onClose={() => {
          if (paymentLoading) return;
          setPaymentObligation(null);
          setPaymentAmount('');
          setPaymentError(null);
        }}
        title="Внести оплату"
      >
        {paymentObligation && (
          <div className="space-y-4">
            <div className="rounded-xl bg-stone-50 px-4 py-3">
              <p className="text-sm text-stone-500">Остаток долга</p>
              <p className="text-xl font-semibold text-stone-800">
                {Number(paymentObligation.amount).toLocaleString('ru-RU')} ₽
              </p>
            </div>

            <FormField
              label="Сколько вы перечислили?"
              error={paymentError || undefined}
            >
              <Input
                type="number"
                value={paymentAmount}
                onChange={(e) => {
                  setPaymentAmount(e.target.value);
                  setPaymentError(null);
                }}
                placeholder="Например, 500"
                min="0.01"
                max={Number(paymentObligation.amount)}
                step="0.01"
                autoFocus
              />
            </FormField>

            <p className="text-xs text-stone-500">
              Можно внести часть долга. Оставшаяся сумма сохранится как новый остаток.
            </p>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPaymentObligation(null);
                  setPaymentAmount('');
                  setPaymentError(null);
                }}
                disabled={paymentLoading}
                className="flex-1"
              >
                Отмена
              </Button>

              <Button
                onClick={handleSubmitPayment}
                loading={paymentLoading}
                className="flex-1"
              >
                Внести оплату
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
