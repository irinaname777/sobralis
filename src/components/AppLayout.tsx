import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Home, Users, Calendar, Coffee, Plane, Receipt, User, Bell, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/groups', icon: Users, label: 'Группы' },
  { to: '/calendar', icon: Calendar, label: 'Календарь' },
  { to: '/meetings', icon: Coffee, label: 'Встречи' },
  { to: '/trips', icon: Plane, label: 'Поездки' },
  { to: '/expenses', icon: Receipt, label: 'Расходы' },
  { to: '/notifications', icon: Bell, label: 'Уведомления' },
  { to: '/profile', icon: User, label: 'Профиль' },
];

type PopupNotification = {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: {
    title?: string;
    amount?: number;
    payment_amount?: number;
    remaining_amount?: number;
  } | null;
  read_at: string | null;
  created_at: string;
  actionable?: boolean;
};

const notificationLabels: Record<string, string> = {
  meeting_invitation: 'Вас пригласили на встречу',
  meeting_accepted: 'Участница подтвердила встречу',
  meeting_confirmed: 'Встреча согласована',
  meeting_declined: 'Участница отказалась от встречи',
  meeting_counter_proposed: 'Предложено изменение встречи',

  trip_invitation: 'Вас пригласили в поездку',
  trip_accepted: 'Участница подтвердила поездку',
  trip_confirmed: 'Поездка согласована',
  trip_declined: 'Участница отказалась от поездки',
  trip_counter_proposed: 'Предложено изменение поездки',

  expense_debt_created: 'Создано обязательство по расходу',
  expense_payment_pending: 'Требуется подтверждение платежа',
  expense_payment_confirmed: 'Оплата подтверждена',
  expense_payment_rejected: 'Платёж не подтверждён',

  group_participant_added: 'В группу добавилась новая участница',
  group_participant_removed: 'Состав группы изменился',
};

function getNotificationRoute(notification: PopupNotification): string {
  switch (notification.entity_type) {
    case 'meeting':
      return '/meetings';
    case 'trip':
      return '/trips';
    case 'expense_obligation':
    case 'expense':
      return '/expenses';
    case 'group':
      return '/groups';
    default:
      return '/notifications';
  }
}

function NotificationPopup({
  notification,
  onClose,
  onOpen,
}: {
  notification: PopupNotification;
  onClose: () => void;
  onOpen: () => void;
}) {
  const payload = notification.payload || {};
  const title = notificationLabels[notification.type] || notification.type;

  const paymentAmount =
    payload.payment_amount ?? payload.amount;

  const isActionable =
    notification.actionable ||
    notification.type === 'expense_payment_pending' ||
    notification.type === 'meeting_invitation' ||
    notification.type === 'trip_invitation' ||
    notification.type === 'meeting_counter_proposed' ||
    notification.type === 'trip_counter_proposed';

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md z-[100] animate-slide-up">
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-500 flex items-center justify-center shrink-0">
              <Bell size={20} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-stone-800 text-sm">
                  {title}
                </p>

                <button
                  onClick={onClose}
                  className="p-1 rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                  aria-label="Закрыть"
                >
                  <X size={18} />
                </button>
              </div>

              {payload.title && (
                <p className="text-sm text-stone-600 mt-1">
                  {payload.title}
                </p>
              )}

              {paymentAmount != null && (
                <p className="text-sm text-stone-600 mt-1">
                  Сумма платежа:{' '}
                  <b>{Number(paymentAmount).toLocaleString('ru-RU')} ₽</b>
                </p>
              )}

              {payload.remaining_amount != null && (
                <p className="text-xs text-stone-500 mt-1">
                  Остаток после подтверждения:{' '}
                  <b>{Number(payload.remaining_amount).toLocaleString('ru-RU')} ₽</b>
                </p>
              )}

              {isActionable && (
                <p className="text-xs text-rose-500 font-medium mt-2">
                  Требуется ваше действие
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={onOpen}
              className="flex-1 rounded-xl bg-stone-800 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 transition-colors"
            >
              Открыть
            </button>

            <button
              onClick={onClose}
              className="rounded-xl bg-stone-100 text-stone-600 px-4 py-2.5 text-sm font-medium hover:bg-stone-200 transition-colors"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [popupNotification, setPopupNotification] =
    useState<PopupNotification | null>(null);

  useEffect(() => {
    if (!user) {
      setPopupNotification(null);
      return;
    }

    const channel = supabase
      .channel(`global-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => {
          setPopupNotification(payload.new as PopupNotification);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const closePopup = () => {
    setPopupNotification(null);
  };

  const openNotification = async () => {
    if (!popupNotification) return;

    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', popupNotification.id);

    const route = getNotificationRoute(popupNotification);

    setPopupNotification(null);
    navigate(route);
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {popupNotification && (
        <NotificationPopup
          notification={popupNotification}
          onClose={closePopup}
          onOpen={openNotification}
        />
      )}

      {/* Desktop sidebar / mobile top bar */}
      <div className="hidden sm:flex fixed top-0 left-0 h-full w-20 flex-col items-center py-6 bg-white border-r border-stone-100 z-40">
        <div className="text-2xl mb-8">{profile?.avatar_emoji || '🌸'}</div>

        <nav className="flex flex-col gap-2 flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                  isActive
                    ? 'bg-rose-100 text-rose-500'
                    : 'text-stone-400 hover:bg-stone-100 hover:text-stone-600'
                }`
              }
            >
              <item.icon size={22} />
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-stone-100 z-40">
        <div className="flex items-center justify-around px-2 py-2 overflow-x-auto no-scrollbar">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors min-w-[52px] ${
                  isActive ? 'text-rose-500' : 'text-stone-400'
                }`
              }
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="sm:ml-20 pb-20 sm:pb-0 min-h-screen">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
