import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button, ErrorMessage, Input } from '@/components/ui';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!session) {
      setError('Ссылка восстановления недействительна или истекла. Запросите новое письмо.');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен содержать не менее 8 символов.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setConfirmPassword('');
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      setDone(true);
    } catch {
      setError('Не удалось обновить пароль. Запросите новую ссылку восстановления и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-stone-500">Проверка ссылки…</div>;

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-6 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-stone-100 bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold text-stone-800">Новый пароль</h1>
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-emerald-700">Пароль обновлён. Теперь можно войти.</p>
            <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>Перейти ко входу</Button>
          </div>
        ) : !session ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-600">Ссылка восстановления недействительна или истекла.</p>
            <Link className="text-sm text-rose-600 underline" to="/login">Вернуться ко входу и запросить новую ссылку</Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void updatePassword(event)}>
            <label className="block space-y-1 text-sm text-stone-700">
              <span>Новый пароль</span>
              <Input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm text-stone-700">
              <span>Повторите пароль</span>
              <Input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            {error && <ErrorMessage message={error} />}
            <Button type="submit" loading={saving} className="w-full">Сохранить пароль</Button>
          </form>
        )}
      </div>
    </div>
  );
}
