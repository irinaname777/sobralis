import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Input, Button, ErrorMessage } from '@/components/ui';
import { afterOnboardingPath } from '@/lib/invite';
import { formatUserError } from '@/lib/errors';

const EMOJI_CHOICES = ['🌸', '🌺', '🌻', '🌷', '🌹', '🦋', '💫', '⭐', '🌙', '☀️', '🌈', '🧁', '🍓', '🫐', '🍑', '🥥'];

export function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🌸');
  const [trackCycle, setTrackCycle] = useState(false);
  const [lastPeriod, setLastPeriod] = useState('');
  const [cycleLength, setCycleLength] = useState('28');
  const [periodLength, setPeriodLength] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = [
    { title: 'Как тебя зовут?', subtitle: 'Давай познакомимся' },
    { title: 'Хочешь учитывать цикл?', subtitle: 'Это поможет находить удобные даты для встреч' },
    { title: 'Данные цикла', subtitle: 'Можно изменить позже в любой момент' },
    { title: 'Добавь подруг', subtitle: 'Создай группу и пригласи участниц' },
    { title: 'Готово ❤️', subtitle: 'Давайте соберёмся!' },
  ];

  const currentStep = steps[step];

  const saveProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!user) throw new Error('Пользователь не найден');

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          display_name: name.trim(),
          avatar_emoji: emoji,
          onboarding_completed: true,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      if (trackCycle && lastPeriod) {
        const { error: cycleError } = await supabase.from('cycle_settings').upsert({
          user_id: user.id,
          tracking_enabled: true,
          last_period_start: lastPeriod,
          average_cycle_length: parseInt(cycleLength) || 28,
          period_length: parseInt(periodLength) || 5,
          privacy_level: 'hidden',
        }, { onConflict: 'user_id' });

        if (cycleError) throw cycleError;
      }

      await refreshProfile();
      navigate(afterOnboardingPath());
    } catch (err) {
      setError(formatUserError(err, 'Не удалось сохранить данные. Попробуйте ещё раз'));
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    if (step === 0 && !name.trim()) {
      setError('Введите имя');
      return;
    }
    if (step === 2 && trackCycle) {
      if (!lastPeriod) {
        setError('Выберите дату последней менструации');
        return;
      }
      const cl = parseInt(cycleLength);
      if (isNaN(cl) || cl < 10 || cl > 60) {
        setError('Длина цикла должна быть от 10 до 60 дней');
        return;
      }
      const pl = parseInt(periodLength);
      if (isNaN(pl) || pl < 1 || pl > 15) {
        setError('Продолжительность должна быть от 1 до 15 дней');
        return;
      }
    }
    setError(null);
    if (step === 1 && !trackCycle) {
      setStep(step + 2); // skip cycle data step
    } else if (step >= steps.length - 2) {
      saveProfile();
    } else {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    setError(null);
    if (step === 3 && !trackCycle) {
      setStep(1);
    } else if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-stone-50 to-stone-50 flex flex-col px-6 py-8">
      <div className="max-w-sm w-full mx-auto flex-1 flex flex-col">
        {/* Progress */}
        <div className="flex gap-1.5 mb-8 mt-4">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-rose-400' : 'bg-stone-200'
              }`}
            />
          ))}
        </div>

        <div className="flex-1 flex flex-col">
          <h2 className="text-2xl font-bold text-stone-800 mb-1">{currentStep.title}</h2>
          <p className="text-stone-500 mb-8">{currentStep.subtitle}</p>

          {error && <div className="mb-4"><ErrorMessage message={error} /></div>}

          {/* Step 0: Name */}
          {step === 0 && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-stone-700">Твоё имя</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например, Ирина"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">Выбери аватар</label>
                <div className="grid grid-cols-8 gap-2">
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      onClick={() => setEmoji(e)}
                      className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
                        emoji === e ? 'bg-rose-100 ring-2 ring-rose-400 scale-110' : 'bg-stone-100 hover:bg-stone-200'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Cycle tracking choice */}
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <button
                onClick={() => setTrackCycle(true)}
                className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
                  trackCycle ? 'border-rose-400 bg-rose-50' : 'border-stone-200 bg-white hover:border-stone-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${trackCycle ? 'border-rose-400 bg-rose-400' : 'border-stone-300'}`}>
                    {trackCycle && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div>
                    <p className="font-medium text-stone-800">Да, учитывать цикл</p>
                    <p className="text-sm text-stone-500 mt-0.5">Поможет находить комфортные даты</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setTrackCycle(false)}
                className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
                  !trackCycle ? 'border-rose-400 bg-rose-50' : 'border-stone-200 bg-white hover:border-stone-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${!trackCycle ? 'border-rose-400 bg-rose-400' : 'border-stone-300'}`}>
                    {!trackCycle && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div>
                    <p className="font-medium text-stone-800">Нет, не сейчас</p>
                    <p className="text-sm text-stone-500 mt-0.5">Можно включить позже в настройках</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Cycle data */}
          {step === 2 && trackCycle && (
            <div className="space-y-5 animate-fade-in">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-stone-700">Дата последней менструации</label>
                <Input
                  type="date"
                  value={lastPeriod}
                  onChange={(e) => setLastPeriod(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-stone-700">Длина цикла (дней)</label>
                  <Input
                    type="number"
                    value={cycleLength}
                    onChange={(e) => setCycleLength(e.target.value)}
                    min={10}
                    max={60}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-stone-700">Менструация (дней)</label>
                  <Input
                    type="number"
                    value={periodLength}
                    onChange={(e) => setPeriodLength(e.target.value)}
                    min={1}
                    max={15}
                  />
                </div>
              </div>
              <p className="text-xs text-stone-400">
                Расчёт является ориентировочным и не является медицинской рекомендацией.
              </p>
            </div>
          )}

          {/* Step 3: Add friends */}
          {step === 3 && (
            <div className="text-center py-8 animate-fade-in">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-rose-100 mb-4">
                <Users className="text-rose-400" size={36} />
              </div>
              <p className="text-stone-600 max-w-xs mx-auto">
                После завершения онбординга ты сможешь создать группу, добавить подруг и пригласить их по ссылке.
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="text-center py-8 animate-fade-in">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-rose-100 mb-4">
                <Heart className="text-rose-400" size={36} fill="currentColor" />
              </div>
              <p className="text-stone-600 max-w-xs mx-auto">
                Добро пожаловать, {name || 'подруга'}! Давайте начнём планировать встречи.
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-6 pb-4">
          {step > 0 && step < 4 && (
            <Button variant="secondary" onClick={prevStep} className="flex-1">
              Назад
            </Button>
          )}
          <Button
            onClick={nextStep}
            loading={loading}
            className="flex-1"
          >
            {step === steps.length - 1 ? 'Начать' : step === steps.length - 2 ? 'Готово' : 'Далее'}
          </Button>
        </div>
      </div>
    </div>
  );
}
