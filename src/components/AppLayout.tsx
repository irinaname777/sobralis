import { NavLink, Outlet } from 'react-router-dom';
import { Home, Users, Calendar, Coffee, Plane, Receipt, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/groups', icon: Users, label: 'Группы' },
  { to: '/calendar', icon: Calendar, label: 'Календарь' },
  { to: '/meetings', icon: Coffee, label: 'Встречи' },
  { to: '/trips', icon: Plane, label: 'Поездки' },
  { to: '/expenses', icon: Receipt, label: 'Расходы' },
  { to: '/profile', icon: User, label: 'Профиль' },
];

export function AppLayout() {
  const { profile } = useAuth();

  return (
    <div className="min-h-screen bg-stone-50">
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
                  isActive ? 'bg-rose-100 text-rose-500' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-600'
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
