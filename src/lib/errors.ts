type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

export function logSupabaseError(err: unknown) {
  const e = err as SupabaseLikeError;
  console.error('Supabase error:', {
    message: e?.message,
    code: e?.code,
    details: e?.details,
    hint: e?.hint,
    raw: err,
  });
}

export function formatUserError(err: unknown, fallback: string): string {
  logSupabaseError(err);

  const e = err as SupabaseLikeError;
  const message = (e?.message || (err instanceof Error ? err.message : '')).toLowerCase();
  const code = e?.code || '';

  if (code === '42P17' || message.includes('infinite recursion')) {
    return 'Ошибка доступа к данным группы. Сообщите, если это повторится.';
  }
  if (code === '42501' || message.includes('row-level security')) {
    return 'Недостаточно прав для этого действия.';
  }
  if (message.includes('invite_not_found') || message.includes('p0002')) {
    return 'Приглашение не найдено.';
  }
  if (message.includes('invite_expired')) {
    return 'Срок действия приглашения истёк.';
  }
  if (message.includes('invite_already_used')) {
    return 'Это приглашение уже использовано.';
  }
  if (message.includes('not_authenticated') || message.includes('jwt')) {
    return 'Нужно войти в аккаунт.';
  }
  if (message.includes('пользователь не найден')) {
    return 'Сессия не найдена. Войдите ещё раз.';
  }
  if (message.includes('duplicate') || code === '23505') {
    return 'Такая запись уже существует.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Нет связи с сервером. Проверьте интернет.';
  }

  return fallback;
}
