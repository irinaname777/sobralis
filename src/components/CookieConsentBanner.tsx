import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  chooseCookieConsent,
  loadCookieConsentPreference,
  readCookieConsentPreference,
  recordCookieConsent,
  syncAnonymousCookieConsentToUser,
  updateCookieConsentSyncState,
  type CookieConsentPreference,
} from '@/lib/legalConsents';
import { cookieConsentStorageKey, isCurrentCookieConsentChoice } from '@/lib/cookieConsentState';
import { LegalDocumentLink } from '@/components/LegalDocumentLink';

export function CookieConsentBanner() {
  const { user } = useAuth();
  const [preference, setPreference] = useState<CookieConsentPreference>(() => readCookieConsentPreference(user?.id ?? null));
  const [analytics, setAnalytics] = useState(preference.allowAnalytics);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const syncInFlight = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const currentUserId = useRef<string | null>(user?.id ?? null);
  currentUserId.current = user?.id ?? null;

  const submitChoice = useCallback(async (userId: string, choice: CookieConsentPreference, generation = requestGeneration.current) => {
    const syncKey = `${userId}:${choice.updatedAt ?? ''}:${choice.allowAnalytics}`;
    if (syncInFlight.current === syncKey) return;
    syncInFlight.current = syncKey;
    setSaving(true);
    try {
      await recordCookieConsent(choice.allowAnalytics, userId);
      const latest = readCookieConsentPreference(userId);
      if (generation !== requestGeneration.current || currentUserId.current !== userId
        || !isCurrentCookieConsentChoice(latest, choice)) return;
      const synced = updateCookieConsentSyncState({
        pendingAnonymousSync: false, pendingSyncUserId: null, syncedUserId: userId,
      }, userId);
      setPreference(synced);
      setSyncError(false);
    } catch {
      if (generation === requestGeneration.current && currentUserId.current === userId) setSyncError(true);
    } finally {
      if (syncInFlight.current === syncKey) syncInFlight.current = null;
      if (generation === requestGeneration.current && currentUserId.current === userId) setSaving(false);
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === cookieConsentStorageKey(user?.id ?? null)) {
        const next = readCookieConsentPreference(user?.id ?? null);
        setPreference(next);
        setAnalytics(next.allowAnalytics);
        setEditing(false);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [user?.id]);

  useLayoutEffect(() => {
    const userId = user?.id ?? null;
    const generation = ++requestGeneration.current;
    syncInFlight.current = null;
    setSyncError(false);
    setSaving(false);
    setEditing(false);
    if (!userId) {
      const anonymous = readCookieConsentPreference(null);
      setPreference(anonymous);
      setAnalytics(anonymous.allowAnalytics);
      return;
    }

    const cached = readCookieConsentPreference(userId);
    setPreference(cached);
    setAnalytics(cached.allowAnalytics);
    void (async () => {
      try {
        const stored = await loadCookieConsentPreference(userId);
        if (generation !== requestGeneration.current || currentUserId.current !== userId) return;
        if (stored) {
          setPreference(stored);
          setAnalytics(stored.allowAnalytics);
          return;
        }
        const anonymousChoice = syncAnonymousCookieConsentToUser(userId);
        if (anonymousChoice) {
          setPreference(anonymousChoice);
          setAnalytics(anonymousChoice.allowAnalytics);
          await submitChoice(userId, anonymousChoice, generation);
          return;
        }
        const current = readCookieConsentPreference(userId);
        setPreference(current);
        setAnalytics(current.allowAnalytics);
        if (current.pendingSyncUserId === userId && current.decision !== 'unset') {
          await submitChoice(userId, current, generation);
        }
      } catch {
        // Keep account-scoped cache usable; never mark an unsaved decision as synced.
        const current = readCookieConsentPreference(userId);
        if (generation === requestGeneration.current && currentUserId.current === userId
          && current.decision !== 'unset' && current.syncedUserId !== userId) setSyncError(true);
      }
    })();
    return () => { requestGeneration.current += 1; };
  }, [submitChoice, user?.id]);

  const saveChoice = async (allowAnalytics: boolean) => {
    const userId = user?.id ?? null;
    const generation = ++requestGeneration.current;
    const next = chooseCookieConsent(allowAnalytics, userId);
    setPreference(next);
    setAnalytics(allowAnalytics);
    setEditing(false);
    setSyncError(false);
    if (!userId) return;
    void submitChoice(userId, next, generation);
  };

  const retrySync = async () => {
    const userId = user?.id ?? null;
    if (!userId || preference.decision === 'unset') return;
    void submitChoice(userId, preference);
  };

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-5 sm:pb-5" aria-label="Настройки cookie и аналитики">
      <div className="mx-auto max-w-4xl rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-xl backdrop-blur sm:p-5">
        {preference.decision === 'unset' || editing ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-stone-900">Настройки cookie и аналитики</h2>
              <p className="mt-1 text-sm leading-5 text-stone-600">
                Необходимые технологии поддерживают вход в аккаунт, сохранение сессии и работу приглашений. Необязательная аналитика выключена по умолчанию. В будущем может использоваться Яндекс.Метрика; она не загружается без вашего явного разрешения. Подробности — в <LegalDocumentLink documentId="cookie-consent" label="inline" className="font-medium text-rose-600 underline" />.
              </p>
            </div>

              {editing && (
              <label className="flex items-start gap-2 text-sm text-stone-700">
                <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} className="mt-1 accent-rose-500" />
                <span>Разрешить необязательную аналитику</span>
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              {!editing ? (
                <>
                  <button type="button" disabled={saving} onClick={() => void saveChoice(true)} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-60">Принять все</button>
                  <button type="button" disabled={saving} onClick={() => void saveChoice(false)} className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60">Только необходимые</button>
                  <button type="button" disabled={saving} onClick={() => { setAnalytics(preference.allowAnalytics); setEditing(true); }} className="rounded-xl px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">Настроить</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={saving} onClick={() => void saveChoice(analytics)} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-60">Сохранить выбор</button>
                  {preference.decision === 'unset' ? (
                    <button type="button" disabled={saving} onClick={() => void saveChoice(false)} className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60">Только необходимые</button>
                  ) : (
                    <button type="button" disabled={saving} onClick={() => { setEditing(false); setAnalytics(preference.allowAnalytics); }} className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60">Отмена</button>
                  )}
                  <button type="button" disabled={saving} onClick={() => void saveChoice(true)} className="rounded-xl px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">Принять все</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={() => { setAnalytics(preference.allowAnalytics); setEditing(true); }} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-medium text-stone-600 shadow-sm hover:bg-stone-50">Настройки cookie</button>
          </div>
        )}
        {syncError && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-800" role="status">
            <span>Выбор сохранён на этом устройстве, но не передан в аккаунт.</span>
            <button type="button" disabled={saving} onClick={() => void retrySync()} className="font-semibold underline disabled:opacity-60">Повторить</button>
          </div>
        )}
      </div>
    </aside>
  );
}
