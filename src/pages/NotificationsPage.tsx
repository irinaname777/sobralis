import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/components/ui';

type Notification = { id: string; type: string; payload: { title?: string; amount?: number }; read_at: string | null; created_at: string };

const labels: Record<string, string> = {
  meeting_invitation: 'Вас пригласили на встречу', trip_invitation: 'Вас пригласили в поездку',
  meeting_accepted: 'Участница подтвердила встречу', meeting_declined: 'Участница отказалась от встречи', meeting_counter_proposed: 'Предложено изменение встречи',
  trip_accepted: 'Участница подтвердила поездку', trip_declined: 'Участница отказалась от поездки', trip_counter_proposed: 'Предложено изменение поездки',
  expense_debt_created: 'Создано обязательство по расходу', expense_payment_pending: 'Перевод ожидает вашего подтверждения', expense_payment_confirmed: 'Оплата подтверждена',
  group_participant_added: 'В группу добавилась новая участница',
  group_participant_removed: 'Состав группы изменился: участница удалена',
};

export function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    setItems((data as Notification[]) || []);
  }, [user]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel('my-notifications').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, user]);
  const markRead = async (id: string) => { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id); load(); };
  return <div className="space-y-5 animate-fade-in">
    <div><h1 className="text-2xl font-bold text-stone-800">Уведомления</h1><p className="text-stone-500 mt-1">Приглашения, ответы и расчёты</p></div>
    {items.length === 0 ? <EmptyState icon={<Bell size={28} />} title="Пока нет уведомлений" description="Новые приглашения и ответы появятся здесь" /> : <div className="space-y-2">{items.map((item) => <button key={item.id} onClick={() => !item.read_at && markRead(item.id)} className={`w-full text-left rounded-xl p-4 border ${item.read_at ? 'bg-white border-stone-100' : 'bg-rose-50 border-rose-100'}`}><p className="text-sm font-medium text-stone-700">{labels[item.type] || item.type}</p>{item.payload.title && <p className="text-sm text-stone-500 mt-1">{item.payload.title}</p>}{item.payload.amount && <p className="text-sm text-stone-500 mt-1">{Number(item.payload.amount).toLocaleString('ru-RU')} ₽</p>}</button>)}</div>}
  </div>;
}
