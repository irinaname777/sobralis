import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Heart, Mail, Lock, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Input, Button, ErrorMessage } from '@/components/ui';
import { postAuthPath } from '@/lib/invite';
import { formatUserError } from '@/lib/errors';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const isLogin = mode === 'login';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Заполните email и пароль');
      return;
    }

    if (password.length < 6) {
      setError('Пароль должен быть не короче 6 символов');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate(postAuthPath(false));
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        navigate(postAuthPath(true));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Invalid login')) {
        setError('Неверный email или пароль');
      } else if (msg.includes('already registered') || msg.includes('already been registered')) {
        setError('Пользователь с таким email уже существует');
      } else {
        setError(formatUserError(err, 'Не удалось войти. Попробуйте ещё раз'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError('Введите email для восстановления пароля');
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email);
      setResetSent(true);
      setError(null);
    } catch {
      setError('Не удалось отправить письмо. Попробуйте ещё раз');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 via-stone-50 to-stone-50 flex flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-100 mb-4">
            <Heart className="text-rose-400" size={32} fill="currentColor" />
          </div>
          <h1 className="text-2xl font-bold text-stone-800">Sobralis</h1>
          <p className="text-stone-500 mt-1">Собрались? Давайте найдём дату ❤️</p>
        </div>

        {resetSent ? (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100 text-center">
            <p className="text-stone-700 mb-4">
              Инструкция по восстановлению пароля отправлена на {email}
            </p>
            <Button variant="secondary" onClick={() => setResetSent(false)} className="w-full">
              <ArrowLeft size={16} className="inline mr-2" />
              Вернуться
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="pl-10"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
              </div>
            </div>

            {error && <ErrorMessage message={error} />}

            <Button type="submit" loading={loading} className="w-full">
              {isLogin ? 'Войти' : 'Зарегистрироваться'}
            </Button>

            {isLogin && (
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={loading}
                className="block w-full text-center text-sm text-stone-400 hover:text-stone-600 transition-colors"
              >
                Забыли пароль?
              </button>
            )}
          </form>
        )}

        <div className="text-center mt-6">
          {isLogin ? (
            <p className="text-sm text-stone-500">
              Нет аккаунта?{' '}
              <Link to="/signup" className="text-rose-500 font-medium hover:text-rose-600">
                Зарегистрироваться
              </Link>
            </p>
          ) : (
            <p className="text-sm text-stone-500">
              Уже есть аккаунт?{' '}
              <Link to="/login" className="text-rose-500 font-medium hover:text-rose-600">
                Войти
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
