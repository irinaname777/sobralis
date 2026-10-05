import { useEffect, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Calendar as CalendarIcon, Coffee, Plane, Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { CycleSettings, Meeting, Trip, Group, GroupMember } from '@/types';
import { calculatePeriodPredictions, calculateDateComfort, type DateRating } from '@/lib/cycle/calculator';
import { Modal, Input, Button, FormField, EmptyState } from '@/components/ui';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, getDay, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';

type CalendarEvent = {
  date: string;
  type: 'meeting' | 'trip' | 'period';
  label: string;
  color: string;
};

export function CalendarPage() {
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [cycleSettings, setCycleSettings] = useState<CycleSettings | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFinder, setShowFinder] = useState(false);

  // Date finder state
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [bestDates, setBestDates] = useState<DateRating[]>([]);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      try {
        // Load cycle settings
        const { data: cs } = await supabase
          .from('cycle_settings')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        setCycleSettings(cs as CycleSettings | null);

        // Load groups
        const { data: memberRows } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', user.id);
        const groupIds = (memberRows || []).map((r) => r.group_id);

        if (groupIds.length > 0) {
          const { data: groupsData } = await supabase
            .from('groups')
            .select('*')
            .in('id', groupIds);
          setGroups((groupsData as Group[]) || []);

          // Load meetings and trips
          const { data: meetingsData } = await supabase
            .from('meetings')
            .select('*');
          setMeetings((meetingsData as Meeting[]) || []);

          const { data: tripsData } = await supabase
            .from('trips')
            .select('*');
          setTrips((tripsData as Trip[]) || []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // Load members when group selected in finder
  useEffect(() => {
    (async () => {
      if (!selectedGroup) return;
      const { data } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', selectedGroup)
        .order('created_at', { ascending: true });
      setGroupMembers((data as GroupMember[]) || []);
      // Select all by default
      setSelectedMembers(new Set((data || []).map((m) => m.user_id)));
    })();
  }, [selectedGroup]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd]);

  // Build events map
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const monthRangeStart = startOfMonth(currentMonth);
    const monthRangeEnd = endOfMonth(currentMonth);

    // My period predictions
    if (cycleSettings?.tracking_enabled && cycleSettings.last_period_start) {
      const predictions = calculatePeriodPredictions(cycleSettings, monthRangeStart, monthRangeEnd, 6);
      for (const pred of predictions) {
        const cursor = new Date(pred.startDate);
        const end = new Date(pred.endDate);
        while (cursor <= end) {
          const key = cursor.toISOString().split('T')[0];
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push({ date: key, type: 'period', label: 'Менструация', color: 'rose' });
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }

    // Meetings
    for (const m of meetings) {
      const key = m.meeting_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ date: key, type: 'meeting', label: m.title, color: 'blue' });
    }

    // Trips
    for (const t of trips) {
      const cursor = parseISO(t.start_date);
      const end = parseISO(t.end_date);
      while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ date: key, type: 'trip', label: t.title, color: 'emerald' });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return map;
  }, [cycleSettings, meetings, trips, currentMonth]);

  const handleFindDates = async () => {
    if (!selectedGroup || selectedMembers.size === 0 || !rangeStart || !rangeEnd) return;

    setFinding(true);
    try {
      const { data, error } = await supabase.rpc('find_best_cycle_dates', {
        _group_id: selectedGroup,
        _user_ids: Array.from(selectedMembers),
        _range_start: rangeStart,
        _range_end: rangeEnd,
      });

      if (error) throw error;

      setBestDates((data as DateRating[]) || []);
    } catch (error) {
      console.error('Failed to find best dates:', error);
      setBestDates([]);
    } finally {
      setFinding(false);
    }
  };

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-stone-400">Загрузка…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Календарь</h1>
          <p className="text-stone-500 mt-1">Встречи, поездки и цикл</p>
        </div>
        <Button onClick={() => setShowFinder(true)} className="!px-3">
          <Sparkles size={18} className="sm:mr-1" />
          <span className="hidden sm:inline">Найти дату</span>
        </Button>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-stone-100">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-stone-800">
            {format(currentMonth, 'MMMM yyyy', { locale: ru })}
          </h2>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map((d) => (
            <div key={d} className="text-center text-xs font-medium text-stone-400 py-1">{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Empty cells for first week */}
          {Array.from({ length: (getDay(monthStart) + 6) % 7 }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {days.map((day) => {
            const key = day.toISOString().split('T')[0];
            const dayEvents = eventsByDate.get(key) || [];
            const inMonth = isSameMonth(day, currentMonth);
            const today = isToday(day);

            return (
              <div
                key={key}
                className={`min-h-[60px] sm:min-h-[72px] p-1.5 rounded-lg border transition-colors ${
                  today ? 'border-rose-300 bg-rose-50' : 'border-transparent'
                } ${inMonth ? '' : 'opacity-30'}`}
              >
                <span className={`text-xs ${today ? 'font-bold text-rose-500' : 'text-stone-400'}`}>
                  {format(day, 'd')}
                </span>
                <div className="space-y-0.5 mt-1">
                  {dayEvents.slice(0, 2).map((e, i) => (
                    <div
                      key={i}
                      className={`text-[10px] px-1 py-0.5 rounded truncate ${
                        e.color === 'rose' ? 'bg-rose-100 text-rose-600' :
                        e.color === 'blue' ? 'bg-blue-100 text-blue-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}
                    >
                      {e.label}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div className="text-[10px] text-stone-400">+{dayEvents.length - 2}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm text-stone-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-rose-100" />
          <span>Менструация</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-blue-100" />
          <span>Встречи</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-emerald-100" />
          <span>Поездки</span>
        </div>
      </div>

      {/* Date Finder Modal */}
      <Modal open={showFinder} onClose={() => { setShowFinder(false); setBestDates([]); }} title="Найти дату для встречи">
        <div className="space-y-4">
          {groups.length === 0 ? (
            <EmptyState
              icon={<CalendarIcon size={28} />}
              title="Нет групп"
              description="Сначала создайте группу и добавьте подруг"
            />
          ) : (
            <>
              <FormField label="Группа">
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                >
                  <option value="">Выберите группу</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </FormField>

              {groupMembers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-stone-700">Участницы</p>
                  {groupMembers.map((m) => (
                    <label key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-stone-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMembers.has(m.user_id)}
                        onChange={(e) => {
                          const next = new Set(selectedMembers);
                          if (e.target.checked) next.add(m.user_id);
                          else next.delete(m.user_id);
                          setSelectedMembers(next);
                        }}
                        className="w-4 h-4 rounded accent-rose-400"
                      />
                      <span className="text-lg">{m.avatar_emoji || '🌸'}</span>
                      <span className="text-sm text-stone-700">{m.display_name || 'Без имени'}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField label="С даты">
                  <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                </FormField>
                <FormField label="По дату">
                  <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
                </FormField>
              </div>

              <Button
                onClick={handleFindDates}
                loading={finding}
                disabled={!selectedGroup || selectedMembers.size === 0 || !rangeStart || !rangeEnd}
                className="w-full"
              >
                <Sparkles size={16} className="mr-1.5" />
                Подобрать даты
              </Button>

              {bestDates.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="font-semibold text-stone-800">Лучшие даты</h3>
                  {bestDates.map((d) => (
                    <div key={d.date} className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-100">
                      <div>
                        <p className="font-medium text-stone-800">
                          {format(parseISO(d.date), 'd MMMM, EEE', { locale: ru })}
                        </p>
                        <p className="text-xs text-stone-500 mt-0.5">{d.reason}</p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <span key={star} className={star <= d.rating ? 'text-amber-400' : 'text-stone-200'}>★</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-stone-400 pt-1">
                    Расчёт является ориентировочным и не является медицинской рекомендацией.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
