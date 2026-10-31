import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button, ErrorMessage } from '@/components/ui';
import { formatUserError } from '@/lib/errors';
import { buildLegalUpdateConsentArgs, hasRequiredLegalConsentChoices } from '@/lib/legalDocuments';
import { LegalDocumentLink } from '@/components/LegalDocumentLink';

export function LegalUpdatePage() {
  const navigate = useNavigate();
  const { refreshProfile, signOut } = useAuth();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [userAgreementAccepted, setUserAgreementAccepted] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [personalDataConsent, setPersonalDataConsent] = useState(false);
  const [healthDataConsent, setHealthDataConsent] = useState(false);
  const [advertisingConsent, setAdvertisingConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const choices = { ageConfirmed, userAgreementAccepted, licenseAccepted, personalDataConsent, healthDataConsent, advertisingConsent };
    if (!hasRequiredLegalConsentChoices(choices)) {
      setError('Подтвердите возраст, условия документов и согласие на обработку персональных данных.');
      return;
    }

    setSaving(true);
    try {
      const { error: consentError } = await supabase.rpc('accept_existing_legal_consents', {
        ...buildLegalUpdateConsentArgs(choices),
      });
      if (consentError) throw consentError;
      await refreshProfile();
      navigate('/', { replace: true });
    } catch (cause) {
      setError(formatUserError(cause, 'Не удалось сохранить согласия. Проверьте соединение и попробуйте ещё раз.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 sm:px-6">
      <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-2xl space-y-6 rounded-2xl bg-white p-5 shadow-sm sm:p-8">
        <header>
          <p className="text-sm font-medium text-rose-600">Собрались</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">Актуальные документы и согласия</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            Перед продолжением ознакомьтесь с действующими документами и укажите своё решение. Мы не переносим и не предполагаем согласия, которые вы не выражали.
          </p>
        </header>

        <fieldset className="space-y-4">
          <legend className="mb-2 font-semibold text-stone-800">Обязательные подтверждения</legend>

          <label className="flex min-h-11 items-start gap-3 rounded-xl p-3 text-sm text-stone-700 hover:bg-stone-50">
            <input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-rose-500" />
            <span>Мне исполнилось 18 лет</span>
          </label>

          <label className="flex min-h-11 items-start gap-3 rounded-xl p-3 text-sm text-stone-700 hover:bg-stone-50">
            <input type="checkbox" checked={userAgreementAccepted} onChange={(event) => setUserAgreementAccepted(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-rose-500" />
            <span>Я принимаю условия <LegalDocumentLink documentId="user-agreement" targetBlank label="checkbox" className="text-rose-600 underline" /></span>
          </label>

          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={licenseAccepted} onChange={(event) => setLicenseAccepted(event.target.checked)} className="mt-1 accent-rose-500" />
            <span>Я принимаю условия <LegalDocumentLink documentId="license" targetBlank label="checkbox" className="text-rose-600 underline" />.</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={personalDataConsent} onChange={(event) => setPersonalDataConsent(event.target.checked)} className="mt-1 accent-rose-500" />
            <span>Я даю согласие на обработку персональных данных на условиях <LegalDocumentLink documentId="personal-data-consent" targetBlank label="checkbox" className="text-rose-600 underline" />. Политика: <LegalDocumentLink documentId="privacy" targetBlank label="checkbox" className="text-rose-600 underline" />.</span>
          </label>
        </fieldset>

        <fieldset className="space-y-4 border-t border-stone-100 pt-5">
          <legend className="mb-2 font-semibold text-stone-800">Необязательные согласия</legend>

          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={healthDataConsent} onChange={(event) => setHealthDataConsent(event.target.checked)} className="mt-1 accent-rose-500" />
            <span>Я даю отдельное согласие на обработку сведений о состоянии здоровья для работы функции подбора подходящих дат. <LegalDocumentLink documentId="health-data-consent" targetBlank label="checkbox" className="text-rose-600 underline" />. Необязательно.</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={advertisingConsent} onChange={(event) => setAdvertisingConsent(event.target.checked)} className="mt-1 accent-rose-500" />
            <span>Я даю отдельное добровольное согласие на получение рекламных сообщений. <LegalDocumentLink documentId="advertising-consent" targetBlank label="checkbox" className="text-rose-600 underline" />. Необязательно.</span>
          </label>

        </fieldset>

        {error && <ErrorMessage message={error} />}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" loading={saving}>Сохранить решения и продолжить</Button>
          <Button type="button" variant="secondary" onClick={() => void signOut()}>Выйти</Button>
        </div>
      </form>
    </main>
  );
}
