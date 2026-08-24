import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Users, Receipt, Coffee, Plane, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Group, Meeting, Expense, ExpenseParticipant } from '@/types';
import { calculateBalances } from '@/lib/expenses/debtCalculator';
import { format, parseISO, isToday, isFuture } from 'date-fns';
import { ru } from 'date-fns/locale';

export function DashboardPage() {
  const { user, profile } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseParticipants, setExpenseParticipants] = useState<ExpenseParticipant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        // Get groups where user is a member
        const { data: memberRows } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', user.id);

        const groupIds = (memberRows || []).map((r) => r.group_id);

        if (groupIds.length === 0) {
          setLoading(false);
          return;
        }

        const { data: groupsData } = await supabase
          .from('groups')
          .select('*')
          .in('id', groupIds)
          .order('created_at', { ascending: false });

        setGroups(groupsData as Group[] || []);

        // Get meetings
        const { data: meetingsData } = await supabase
          .from('meetings')
          .select('*')
          .order('meeting_date', { ascending: true });

        setMeetings((meetingsData as Meeting[]) || []);

        // Get expenses
        const { data: expensesData } = await supabase
          .from('expenses')
          .select('*')
          .in('group_id', groupIds)
          .order('expense_date', { ascending: false });

        setExpenses((expensesData as Expense[]) || []);

        if (expensesData && expensesData.length > 0) {
          const { data: epData } = await supabase
            .from('expense_participants')
            .select('*')
            .in('expense_id', expensesData.map((e) => e.id));

          setExpenseParticipants((epData as ExpenseParticipant[]) || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const upcomingMeetings = meetings.filter((m) => {
    const d = parseISO(m.meeting_date);
    return isToday(d) || isFuture(d);
  });

  const balances = calculateBalances(expenses, expenseParticipants);
  const myBalance = balances.get(user?.id || '');
  const iOwe = myBalance && myBalance.netBalance < 0 ? Math.abs(myBalance.netBalance) : 0;
  const owedToMe = myBalance && myBalance.netBalance > 0 ? myBalance.netBalance : 0;

  const greetingName = profile?.display_name || 'подруга';
  const greetingEmoji = profile?.avatar_emoji || '🌸';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-stone-400">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-stone-800">
          Привет, {greetingName} {greetingEmoji}
        </h1>
        <p className="text-stone-500 mt-1">Давайте соберёмся ❤️</p>
      </div>

      {/* Upcoming meeting */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Ближайшая встреча</h2>
        {upcomingMeetings.length > 0 ? (
          <Link
            to="/meetings"
            className="block bg-white rounded-2xl p-5 shadow-sm border border-stone-100 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <Coffee className="text-rose-400" size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-stone-800 truncate">{upcomingMeetings[0].title}</p>
                <p className="text-sm text-stone-500 mt-0.5">
                  {format(parseISO(upcomingMeetings[0].meeting_date), 'd MMMM', { locale: ru })}
                  {upcomingMeetings[0].meeting_time ? `, ${upcomingMeetings[0].meeting_time}` : ''}
                </p>
                {upcomingMeetings[0].location && (
                  <p className="text-sm text-stone-400 mt-0.5 truncate">{upcomingMeetings[0].location}</p>
                )}
              </div>
            </div>
          </Link>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100 text-center">
            <p className="text-stone-400 mb-3">Пока нет запланированных встреч</p>
            <Link
              to="/meetings"
              className="inline-flex items-center gap-2 text-rose-500 font-medium text-sm hover:text-rose-600"
            >
              <Sparkles size={16} />
              Создать встречу
            </Link>
          </div>
        )}
      </section>

      {/* Groups */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Твои группы</h2>
        {groups.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {groups.slice(0, 4).map((g) => (
              <Link
                key={g.id}
                to="/groups"
                className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 hover:shadow-md transition-shadow"
              >
                <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center mb-2">
                  <Users className="text-stone-500" size={20} />
                </div>
                <p className="font-medium text-stone-800 text-sm truncate">{g.name}</p>
                <p className="text-xs text-stone-400 mt-0.5">Группа</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100 text-center">
            <p className="text-stone-400 mb-3">Добавьте подруг, чтобы начать планировать встречи</p>
            <Link
              to="/groups"
              className="inline-flex items-center gap-2 text-rose-500 font-medium text-sm hover:text-rose-600"
            >
              <Users size={16} />
              Создать группу
            </Link>
          </div>
        )}
      </section>

      {/* Expenses summary */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Расходы</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="text-orange-400" size={16} />
              <span className="text-xs text-stone-500">Ты должна</span>
            </div>
            <p className="text-xl font-bold text-stone-800">
              {iOwe > 0 ? `${iOwe.toLocaleString('ru-RU')} ₽` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="text-emerald-500" size={16} />
              <span className="text-xs text-stone-500">Тебе должны</span>
            </div>
            <p className="text-xl font-bold text-stone-800">
              {owedToMe > 0 ? `${owedToMe.toLocaleString('ru-RU')} ₽` : '—'}
            </p>
          </div>
        </div>
      </section>

      {/* Quick links */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Быстрый доступ</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/calendar"
            className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 hover:shadow-md transition-shadow flex items-center gap-3"
          >
            <Calendar className="text-rose-400" size={22} />
            <span className="text-sm font-medium text-stone-700">Календарь</span>
          </Link>
          <Link
            to="/trips"
            className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 hover:shadow-md transition-shadow flex items-center gap-3"
          >
            <Plane className="text-rose-400" size={22} />
            <span className="text-sm font-medium text-stone-700">Поездки</span>
          </Link>
          <Link
            to="/expenses"
            className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 hover:shadow-md transition-shadow flex items-center gap-3"
          >
            <Receipt className="text-rose-400" size={22} />
            <span className="text-sm font-medium text-stone-700">Расходы</span>
          </Link>
          <Link
            to="/meetings"
            className="bg-white rounded-2xl p-4 shadow-sm border border-stone-100 hover:shadow-md transition-shadow flex items-center gap-3"
          >
            <Coffee className="text-rose-400" size={22} />
            <span className="text-sm font-medium text-stone-700">Встречи</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
