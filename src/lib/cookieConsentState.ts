export type CookieConsentDecision = 'unset' | 'granted' | 'declined' | 'revoked';

export function cookieConsentStorageKey(userId: string | null): string {
  return userId
    ? `sobralis.cookie-consent.v1:user:${encodeURIComponent(userId)}`
    : 'sobralis.cookie-consent.v1:anonymous';
}

export function decisionFromCookieConsentEvent(decision: string): CookieConsentDecision | null {
  if (decision === 'granted' || decision === 'declined' || decision === 'revoked') return decision;
  return null;
}

export function isCurrentCookieConsentChoice(
  current: { updatedAt: string | null; allowAnalytics: boolean; decision: CookieConsentDecision } | null,
  expected: { updatedAt: string | null; allowAnalytics: boolean; decision: CookieConsentDecision },
): boolean {
  return current?.updatedAt === expected.updatedAt
    && current.allowAnalytics === expected.allowAnalytics
    && current.decision === expected.decision;
}

export function cookieConsentDecisionForChoice(
  allowAnalytics: boolean,
  previous: CookieConsentDecision,
): CookieConsentDecision {
  if (allowAnalytics) return 'granted';
  return previous === 'granted' || previous === 'revoked' ? 'revoked' : 'declined';
}

export function transferAnonymousCookieConsent(
  anonymous: { decision: CookieConsentDecision; allowAnalytics: boolean; pendingAnonymousSync: boolean; capturedBySignup: boolean },
  accountDecision: CookieConsentDecision,
  userId: string,
): { decision: CookieConsentDecision; allowAnalytics: boolean; pendingAnonymousSync: false; pendingSyncUserId: string } | null {
  if (!anonymous.pendingAnonymousSync || anonymous.capturedBySignup || anonymous.decision === 'unset'
    || accountDecision !== 'unset') return null;
  return {
    decision: anonymous.decision,
    allowAnalytics: anonymous.allowAnalytics,
    pendingAnonymousSync: false,
    pendingSyncUserId: userId,
  };
}
