import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/components/ui';
import { formatUserError } from '@/lib/errors';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

type Notification = {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: { title?: string; amount?: number } | null;
  read_at: string | null;
  created_at: string;
};

const labels: Record<string, string> = {
  meeting_invitation: 'Вас пригласили на встречу', trip_invitation: 'Вас пригласили в поездку',
  meeting_accepted: 'Участница подтвердила встречу', meeting_confirmed: 'Встреча согласована',
  meeting_declined: 'Участница отказалась от встречи', meeting_counter_proposed: 'Предложено изменение встречи',
  trip_accepted: 'Участница подтвердила поездку', trip_confirmed: 'Поездка согласована',
  trip_declined: 'Участница отказалась от поездки', trip_counter_proposed: 'Предложено изменение поездки',
  expense_created: 'В группе создан новый расход', expense_updated: 'Расход изменён',
  expense_debt_created: 'Создано обязательство по расходу', expense_payment_pending: 'Перевод ожидает вашего подтверждения',
  expense_payment_confirmed: 'Оплата подтверждена', expense_payment_rejected: 'Платёж не подтверждён',
  group_participant_added: 'В группу добавилась новая участница',
  group_participant_removed: 'Состав группы изменился: участница удалена',
  group_you_were_added: 'Вас добавили в группу', group_you_were_removed: 'Вас удалили из группы',
};

const notificationPath = (item: Notification) => {
  if (!item.entity_id) return null;
  const basePath = item.entity_type === 'meeting' ? '/meetings'
    : item.entity_type === 'trip' ? '/trips'
      : item.entity_type === 'expense' || item.entity_type === 'expense_obligation' ? '/expenses'
        : item.entity_type === 'group' ? '/groups' : null;
  return basePath ? `${basePath}#${encodeURIComponent(item.entity_id)}` : null;
};

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: queryError } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    if (queryError) setError(formatUserError(queryError, 'Не удалось загрузить уведомления. Попробуйте ещё раз.'));
    else {
      setItems((data as Notification[]) || []);
      setError(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel('my-notifications').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, () => { void load(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, user]);

  const openNotification = async (item: Notification) => {
    if (busyId) return;
    setError(null);
    setBusyId(item.id);
    if (!item.read_at) {
      const { error: updateError } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
      if (updateError) {
        setError(formatUserError(updateError, 'Не удалось отметить уведомление прочитанным. Попробуйте ещё раз.'));
        setBusyId(null);
        return;
      }
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry));
    }
    setBusyId(null);
    const path = notificationPath(item);
    if (path) navigate(path);
    else setError('Связанный объект больше недоступен. Уведомление отмечено прочитанным.');
  };

  return <div className="space-y-5 animate-fade-in">
    <div><h1 className="page-title">Уведомления</h1><p className="text-stone-500 mt-1">Приглашения, ответы и расчёты</p></div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {loading ? <p className="py-8 text-center text-sm text-stone-500">Загружаем уведомления…</p>
      : items.length === 0 ? <EmptyState icon={<Bell size={28} />} title="Пока нет уведомлений" description="Новые приглашения и ответы появятся здесь" />
        : <div className="space-y-2">{items.map((item) => <button key={item.id} type="button" disabled={busyId !== null} onClick={() => void openNotification(item)} className={`w-full rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${item.read_at ? 'bg-white border-stone-100 hover:border-stone-300' : 'bg-rose-50 border-rose-200 hover:border-rose-300'}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-stone-700">{labels[item.type] || 'Новое уведомление'}</p>
            {!item.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="Новое" />}
          </div>
          <time dateTime={item.created_at} className="mt-1 block text-xs text-stone-400">{format(parseISO(item.created_at), 'd MMM, HH:mm', { locale: ru })}</time>
          {item.payload?.title && <p className="text-sm text-stone-500 mt-1">{item.payload.title}</p>}
          {item.payload?.amount != null && <p className="text-sm text-stone-500 mt-1">{Number(item.payload.amount).toLocaleString('ru-RU')} ₽</p>}
        </button>)}</div>}
  </div>;
}
