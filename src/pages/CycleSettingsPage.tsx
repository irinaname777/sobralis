import { useEffect, useState } from 'react';
import { Heart, AlertCircle, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { CycleSettings, PrivacyLevel } from '@/types';
import { Input, Button, FormField, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';

export function CycleSettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CycleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Form state
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [lastPeriod, setLastPeriod] = useState('');
  const [cycleLength, setCycleLength] = useState('28');
  const [periodLength, setPeriodLength] = useState('5');
  const [privacy, setPrivacy] = useState<PrivacyLevel>('hidden');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { loading: saving, error: saveError, run: runSave } = useAsyncAction();
  const { loading: deleting, run: runDelete } = useAsyncAction();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      try {
        const { data } = await supabase
          .from('cycle_settings')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (data) {
          const s = data as CycleSettings;
          setSettings(s);
          setTrackingEnabled(s.tracking_enabled);
          setLastPeriod(s.last_period_start || '');
          setCycleLength(String(s.average_cycle_length));
          setPeriodLength(String(s.period_length));
          setPrivacy(s.privacy_level);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const validate = (): boolean => {
    setValidationError(null);
    if (trackingEnabled) {
      if (!lastPeriod) {
        setValidationError('Выберите дату последней менструации');
        return false;
      }
      const cl = parseInt(cycleLength);
      if (isNaN(cl) || cl < 10 || cl > 60) {
        setValidationError('Длина цикла должна быть от 10 до 60 дней');
        return false;
      }
      const pl = parseInt(periodLength);
      if (isNaN(pl) || pl < 1 || pl > 15) {
        setValidationError('Продолжительность менструации должна быть от 1 до 15 дней');
        return false;
      }
    }
    return true;
  };

  const handleSave = async () => {
    if (!user || !validate()) return;
    const result = await runSave(async () => {
      const payload = {
        user_id: user.id,
        tracking_enabled: trackingEnabled,
        last_period_start: trackingEnabled ? lastPeriod : null,
        average_cycle_length: parseInt(cycleLength) || 28,
        period_length: parseInt(periodLength) || 5,
        privacy_level: privacy,
      };

      const { error } = await supabase
        .from('cycle_settings')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) throw error;
    });

    if (result !== null) {
      showToast('Данные цикла сохранены');
    }
  };

  const handleDelete = async () => {
    if (!user || !settings) return;
    if (!confirm('Удалить все данные цикла?')) return;
    const result = await runDelete(async () => {
      const { error } = await supabase
        .from('cycle_settings')
        .delete()
        .eq('user_id', user.id);
      if (error) throw error;
    });

    if (result !== null) {
      setSettings(null);
      setTrackingEnabled(false);
      setLastPeriod('');
      setCycleLength('28');
      setPeriodLength('5');
      setPrivacy('hidden');
      showToast('Данные цикла удалены');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-stone-400">Загрузка…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">Данные цикла</h1>
        <p className="text-stone-500 mt-1">Ориентировочный расчёт для планирования встреч</p>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-amber-700">
          Расчёт является ориентировочным и не является медицинской рекомендацией.
        </p>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100 space-y-5">
        {/* Tracking toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-stone-800">Учитывать цикл</p>
            <p className="text-sm text-stone-500 mt-0.5">Для подбора удобных дат</p>
          </div>
          <button
            onClick={() => setTrackingEnabled(!trackingEnabled)}
            className={`relative w-12 h-7 rounded-full transition-colors ${trackingEnabled ? 'bg-rose-400' : 'bg-stone-200'}`}
          >
            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${trackingEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {trackingEnabled && (
          <div className="space-y-5 animate-fade-in">
            <FormField label="Дата последней менструации">
              <Input
                type="date"
                value={lastPeriod}
                onChange={(e) => setLastPeriod(e.target.value)}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Длина цикла (дней)">
                <Input
                  type="number"
                  value={cycleLength}
                  onChange={(e) => setCycleLength(e.target.value)}
                  min={10}
                  max={60}
                />
              </FormField>
              <FormField label="Менструация (дней)">
                <Input
                  type="number"
                  value={periodLength}
                  onChange={(e) => setPeriodLength(e.target.value)}
                  min={1}
                  max={15}
                />
              </FormField>
            </div>

            {/* Privacy */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-700">Приватность цикла</p>
              <div className="space-y-2">
                {([
                  { value: 'full', label: 'Показывать группе конкретные даты', desc: 'Участницы видят ваши даты' },
                  { value: 'comfort', label: 'Показывать только комфортность даты', desc: 'Участницы видят только удобство/неудобство' },
                  { value: 'hidden', label: 'Не показывать данные цикла', desc: 'Никто не видит ваши данные' },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPrivacy(opt.value)}
                    className={`w-full p-3.5 rounded-xl border-2 text-left transition-all ${
                      privacy === opt.value ? 'border-rose-400 bg-rose-50' : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${privacy === opt.value ? 'border-rose-400 bg-rose-400' : 'border-stone-300'}`}>
                        {privacy === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-stone-700">{opt.label}</p>
                        <p className="text-xs text-stone-400 mt-0.5">{opt.desc}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {(validationError || saveError) && (
          <ErrorMessage message={validationError || saveError || ''} />
        )}

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} loading={saving} className="flex-1">Сохранить</Button>
          {settings && (
            <Button variant="danger" onClick={handleDelete} loading={deleting}>
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
