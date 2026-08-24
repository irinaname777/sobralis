import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Heart, Check, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button, ErrorMessage } from '@/components/ui';
import { rememberInviteCode, clearInviteCode } from '@/lib/invite';
import { formatUserError } from '@/lib/errors';

type InvitePreview = {
  id: string;
  group_id: string;
  group_name: string;
  group_description: string | null;
  expires_at: string | null;
  used_by: string | null;
  created_at: string;
};

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  useEffect(() => {
    rememberInviteCode(code);
  }, [code]);

  useEffect(() => {
    (async () => {
      if (!code) return;
      setLoading(true);
      setError(null);
      setBlockedReason(null);
      try {
        const { data, error: rpcError } = await supabase.rpc('get_invitation_by_code', {
          _code: code,
        });

        if (rpcError) throw rpcError;

        const row = (Array.isArray(data) ? data[0] : data) as InvitePreview | undefined;
        if (!row) {
          setPreview(null);
          setBlockedReason('Приглашение не найдено или ссылка неверная');
          return;
        }

        setPreview(row);

        if (row.expires_at && new Date(row.expires_at) < new Date()) {
          setBlockedReason('Срок действия приглашения истёк');
          return;
        }

        if (user && row.used_by && row.used_by !== user.id) {
          setBlockedReason('Это приглашение уже использовано');
        }

        if (user) {
          const { data: existing } = await supabase
            .from('group_members')
            .select('id')
            .eq('group_id', row.group_id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (existing) {
            setAlreadyMember(true);
          }
        }
      } catch (err) {
        setBlockedReason(formatUserError(err, 'Не удалось открыть приглашение'));
      } finally {
        setLoading(false);
      }
    })();
  }, [code, user]);

  const handleJoin = async () => {
    if (!user || !code) return;
    setJoining(true);
    setError(null);
    try {
      const { data, error: joinError } = await supabase.rpc('join_group_by_invite', {
        _code: code,
      });
      if (joinError) throw joinError;

      const result = data as { already_member?: boolean } | null;
      clearInviteCode();
      if (result?.already_member) {
        setAlreadyMember(true);
        return;
      }
      navigate('/groups');
    } catch (err) {
      setError(formatUserError(err, 'Не удалось присоединиться к группе. Попробуйте ещё раз'));
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <p className="text-stone-400">Загрузка приглашения…</p>
      </div>
    );
  }

  const groupTitle = preview?.group_name ? `«${preview.group_name}»` : 'Sobralis';

  if (blockedReason && !alreadyMember) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-rose-50 to-stone-50 flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 mb-4">
            <AlertCircle className="text-amber-500" size={32} />
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">Нельзя присоединиться</h1>
          <p className="text-stone-500 mb-6">{blockedReason}</p>
          <Button onClick={() => navigate(user ? '/groups' : '/login')} className="w-full">
            {user ? 'К группам' : 'Войти'}
          </Button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-rose-50 to-stone-50 flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-100 mb-4">
            <Heart className="text-rose-400" size={32} fill="currentColor" />
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">
            Приглашение в {groupTitle}
          </h1>
          {preview?.group_description && (
            <p className="text-sm text-stone-400 mb-4">{preview.group_description}</p>
          )}
          <p className="text-stone-500 mb-6">
            Войдите или зарегистрируйтесь, чтобы присоединиться к группе
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => navigate('/login')} className="flex-1">Войти</Button>
            <Button onClick={() => navigate('/signup')} className="flex-1">Регистрация</Button>
          </div>
        </div>
      </div>
    );
  }

  if (alreadyMember) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-rose-50 to-stone-50 flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 mb-4">
            <Check className="text-emerald-500" size={32} />
          </div>
          <h1 className="text-xl font-bold text-stone-800 mb-2">Вы уже в группе</h1>
          <p className="text-stone-500 mb-6">{preview?.group_name}</p>
          <Button onClick={() => { clearInviteCode(); navigate('/groups'); }} className="w-full">К группам</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50 to-stone-50 flex flex-col items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-100 mb-4">
          <Heart className="text-rose-400" size={32} fill="currentColor" />
        </div>
        <h1 className="text-xl font-bold text-stone-800 mb-2">Приглашение в группу</h1>
        <p className="text-stone-500 mb-1">{groupTitle}</p>
        {preview?.group_description && <p className="text-sm text-stone-400 mb-6">{preview.group_description}</p>}
        <p className="text-stone-600 mb-6">
          Вы вошли как {profile?.display_name || user.email}. Присоединиться к группе?
        </p>
        {error && <div className="mb-4"><ErrorMessage message={error} /></div>}
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => navigate('/')} className="flex-1">Отмена</Button>
          <Button onClick={handleJoin} loading={joining} className="flex-1">Присоединиться</Button>
        </div>
      </div>
    </div>
  );
}
