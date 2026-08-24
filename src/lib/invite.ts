const STORAGE_KEY = 'sobralis_pending_invite_code';

export function rememberInviteCode(code: string | undefined) {
  if (!code) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
}

export function peekInviteCode(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearInviteCode() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function invitePath(code: string) {
  return `/invite/${code}`;
}

export function postAuthPath(afterSignup: boolean): string {
  const code = peekInviteCode();
  if (afterSignup) return '/onboarding';
  if (code) return invitePath(code);
  return '/';
}

export function afterOnboardingPath(): string {
  const code = peekInviteCode();
  return code ? invitePath(code) : '/';
}
