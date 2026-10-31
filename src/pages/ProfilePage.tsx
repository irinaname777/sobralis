import { useState } from 'react';
import { LogOut, Heart, Calendar, Trash2, FileText, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Input, Button, FormField, ErrorMessage, Toast, useAsyncAction } from '@/components/ui';
import { Link } from 'react-router-dom';
import { LEGAL_DOCUMENTS } from '@/lib/legalDocuments';

const EMOJI_CHOICES = ['🌸', '🌺', '🌻', '🌷', '🌹', '🦋', '💫', '⭐', '🌙', '☀️', '🌈', '🧁', '🍓', '🫐', '🍑', '🥥'];

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.display_name || '');
  const [emoji, setEmoji] = useState(profile?.avatar_emoji || '🌸');
  const [toast, setToast] = useState<string | null>(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
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

  const handleDeleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setDeleteError(null);
    if (!user?.email) {
      setDeleteError('Не удалось подтвердить email аккаунта. Обратитесь в поддержку.');
      return;
    }
    if (deleteConfirmation !== 'УДАЛИТЬ') {
      setDeleteError('Введите слово УДАЛИТЬ для подтверждения.');
      return;
    }

    setDeleteLoading(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deletePassword,
      });
      if (reauthError) throw new Error('reauthentication_failed');

      const { error: deletionError } = await supabase.rpc('delete_my_account');
      if (deletionError) throw deletionError;

      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      navigate('/login', { replace: true, state: { accountDeleted: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('account_deletion_blocked_financial_records')) {
        setDeleteError('Удаление остановлено: аккаунт связан с расходами или расчётами. Эти записи и оплаты не изменены. Обратитесь в поддержку для безопасного завершения финансовых записей.');
      } else if (message.includes('account_deletion_requires_recent_login')) {
        setDeleteError('Не удалось подтвердить недавний вход. Войдите в аккаунт заново и повторите попытку.');
      } else if (message.includes('reauthentication_failed')) {
        setDeleteError('Неверный пароль. Аккаунт не удалён.');
      } else {
        setDeleteError('Не удалось удалить аккаунт. Изменения не завершены; попробуйте ещё раз или обратитесь в поддержку.');
      }
    } finally {
      setDeletePassword('');
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <h1 className="page-title">Профиль</h1>
        <p className="text-stone-500 mt-1">Настройки и данные</p>
      </div>

      {/* Profile card */}
      <div className="surface-card p-5">
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
        className="surface-card p-5 hover:shadow-md transition-shadow flex items-center gap-4"
      >
        <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center">
          <Calendar className="text-rose-400" size={24} />
        </div>
        <div className="flex-1">
          <p className="font-medium text-stone-800">Данные цикла</p>
          <p className="text-sm text-stone-500">Настройки и приватность</p>
        </div>
      </Link>

      <section className="surface-card overflow-hidden" aria-labelledby="profile-documents-title">
        <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-4">
          <FileText className="text-dusty" size={20} aria-hidden="true" />
          <h2 id="profile-documents-title" className="font-semibold text-stone-800">Документы</h2>
        </div>
        <nav aria-label="Документы профиля" className="divide-y divide-stone-100">
          {LEGAL_DOCUMENTS.filter((document) => document.profileLabel).map((document) => (
            <Link key={document.id} to={document.route} className="flex min-h-12 items-center justify-between gap-3 px-5 py-3 text-sm text-stone-700 transition-colors hover:bg-stone-50 hover:text-rose-700">
              <span>{document.profileLabel}</span>
              <ChevronRight size={16} className="shrink-0 text-stone-400" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      </section>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full surface-card p-5 hover:border-red-200 transition-colors flex items-center gap-4 text-left"
      >
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
          <LogOut className="text-red-400" size={24} />
        </div>
        <div>
          <p className="font-medium text-stone-800">Выйти из аккаунта</p>
          <p className="text-sm text-stone-500">Завершить сессию</p>
        </div>
      </button>

      <section className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 text-red-500" size={20} />
          <div className="flex-1">
            <h2 className="font-semibold text-stone-800">Удаление аккаунта</h2>
            <p className="mt-1 text-sm text-stone-600">Группы будут переданы активной участнице, а группы без преемника архивированы. Встречи и поездки сохранятся. Если аккаунт связан с расходами или оплатами, удаление остановится без изменения этих записей.</p>
            <p className="mt-2 text-xs text-stone-500">Записи согласий находятся в отдельном неизменяемом журнале и не удаляются этой операцией. Срок и основание их хранения требуют отдельного определения.</p>
            {!showDeleteAccount ? (
              <button type="button" onClick={() => { setShowDeleteAccount(true); setDeleteError(null); }} className="mt-4 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Начать удаление аккаунта</button>
            ) : (
              <form onSubmit={(event) => void handleDeleteAccount(event)} className="mt-4 space-y-3">
                <p className="text-sm font-medium text-red-700">Действие необратимо. Для повторного подтверждения введите пароль и слово УДАЛИТЬ.</p>
                <Input type="password" autoComplete="current-password" required value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} aria-label="Текущий пароль" placeholder="Текущий пароль" />
                <Input required value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} aria-label="Введите УДАЛИТЬ" placeholder="Введите УДАЛИТЬ" />
                {deleteError && <ErrorMessage message={deleteError} />}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="danger" loading={deleteLoading}>Подтвердить удаление</Button>
                  <Button type="button" variant="secondary" disabled={deleteLoading} onClick={() => { setShowDeleteAccount(false); setDeletePassword(''); setDeleteConfirmation(''); setDeleteError(null); }}>Отмена</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      <div className="text-center text-xs text-stone-400 py-4">
        <Heart size={14} className="inline mr-1 text-rose-300" />
        Sobralis — Собрались
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
