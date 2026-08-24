import { useState } from 'react';
import { LogOut, Heart, Calendar, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Input, Button, FormField, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { Link } from 'react-router-dom';

const EMOJI_CHOICES = ['🌸', '🌺', '🌻', '🌷', '🌹', '🦋', '💫', '⭐', '🌙', '☀️', '🌈', '🧁', '🍓', '🫐', '🍑', '🥥'];

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.display_name || '');
  const [emoji, setEmoji] = useState(profile?.avatar_emoji || '🌸');
  const [toast, setToast] = useState<string | null>(null);
  const { loading, error, run } = useAsyncAction();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleSave = async () => {
    if (!user) return;
    const result = await run(async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: name.trim(), avatar_emoji: emoji })
        .eq('id', user.id);
      if (error) throw error;
    });
    if (result !== null) {
      await refreshProfile();
      showToast('Профиль обновлён');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">Профиль</h1>
        <p className="text-stone-500 mt-1">Настройки и данные</p>
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center text-3xl">
            {emoji}
          </div>
          <div>
            <p className="font-semibold text-stone-800">{profile?.display_name || 'Без имени'}</p>
            <p className="text-sm text-stone-400">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-4">
          <FormField label="Имя">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" />
          </FormField>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-stone-700">Аватар</label>
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

          {error && <ErrorMessage message={error} />}

          <Button onClick={handleSave} loading={loading} className="w-full">
            Сохранить
          </Button>
        </div>
      </div>

      {/* Cycle settings link */}
      <Link
        to="/cycle"
        className="bg-white rounded-2xl p-5 shadow-sm border border-stone-100 hover:shadow-md transition-shadow flex items-center gap-4"
      >
        <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center">
          <Calendar className="text-rose-400" size={24} />
        </div>
        <div className="flex-1">
          <p className="font-medium text-stone-800">Данные цикла</p>
          <p className="text-sm text-stone-500">Настройки и приватность</p>
        </div>
      </Link>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full bg-white rounded-2xl p-5 shadow-sm border border-stone-100 hover:border-red-200 transition-colors flex items-center gap-4 text-left"
      >
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
          <LogOut className="text-red-400" size={24} />
        </div>
        <div>
          <p className="font-medium text-stone-800">Выйти из аккаунта</p>
          <p className="text-sm text-stone-500">Завершить сессию</p>
        </div>
      </button>

      <div className="text-center text-xs text-stone-400 py-4">
        <Heart size={14} className="inline mr-1 text-rose-300" />
        Sobralis — Собрались
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
