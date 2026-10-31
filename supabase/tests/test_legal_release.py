"""Offline release checks for the public legal and signup flow."""
from pathlib import Path
import json
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class LegalReleaseContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = (ROOT / "src/App.tsx").read_text()
        cls.pages = (ROOT / "src/pages/LegalPages.tsx").read_text()
        cls.documents = (ROOT / "src/lib/legalDocuments.ts").read_text()
        cls.auth = (ROOT / "src/pages/AuthPage.tsx").read_text()
        cls.consent_sql = (ROOT / "supabase/migrations/20261029110000_legal_consent_events.sql").read_text()
        cls.registration_sql = (ROOT / "supabase/migrations/20261029112000_registration_profile_access.sql").read_text()
        cls.legacy_rollback_sql = (ROOT / "supabase/rollback/restore_legacy_access.sql").read_text()
        cls.auth_context = (ROOT / "src/contexts/AuthContext.tsx").read_text()
        cls.calendar = (ROOT / "src/pages/CalendarPage.tsx").read_text()
        cls.cookie_banner = (ROOT / "src/components/CookieConsentBanner.tsx").read_text()
        cls.cookie_consents = (ROOT / "src/lib/legalConsents.ts").read_text()
        cls.cookie_document = (ROOT / "public/legal-content/cookie-consent.html").read_text()
        cls.supabase_config = (ROOT / "supabase/config.toml").read_text()

    def test_all_public_document_routes_and_assets_exist(self):
        self.assertIn('path="/documents"', self.app)
        self.assertIn('path="/about"', self.app)
        self.assertIn('path="/legal/:documentId"', self.app)
        self.assertIn("<LegalFooter", self.app)
        entries = re.findall(r"id: '([^']+)',\s*title: '([^']+)',[\s\S]*?route: '([^']+)',\s*asset: '([^']+)'", self.documents)
        self.assertEqual(len(entries), 7)
        for document_id, _title, route, asset in entries:
            with self.subTest(document_id=document_id):
                self.assertEqual(route, f"/legal/{document_id}")
                self.assertTrue((ROOT / "public" / asset.lstrip("/")).is_file(), asset)
                self.assertIn(document_id, self.documents)

    def test_vercel_spa_fallback_preserves_public_document_assets(self):
        vercel = json.loads((ROOT / "vercel.json").read_text())
        self.assertIn({"source": "/(.*)", "destination": "/index.html"}, vercel["rewrites"])
        for route in (
            "/documents", "/about", "/legal/user-agreement", "/legal/license",
            "/legal/privacy", "/legal/personal-data-consent", "/legal/advertising-consent",
            "/legal/health-data-consent", "/legal/cookie-consent", "/onboarding",
        ):
            with self.subTest(route=route):
                self.assertTrue(route == "/documents" and 'path="/documents"' in self.app or route == "/about" and 'path="/about"' in self.app or route == "/onboarding" and 'path="/onboarding"' in self.app or route.startswith("/legal/") and 'path="/legal/:documentId"' in self.app)

    def test_local_supabase_redirect_allowlist_matches_vite_and_app_paths(self):
        self.assertIn('site_url = "http://localhost:5173"', self.supabase_config)
        urls = set(re.findall(r'"(http://(?:localhost|127\.0\.0\.1):5173/(?:onboarding|reset-password))"', self.supabase_config))
        self.assertEqual(urls, {
            "http://localhost:5173/onboarding", "http://localhost:5173/reset-password",
            "http://127.0.0.1:5173/onboarding", "http://127.0.0.1:5173/reset-password",
        })
        self.assertFalse(any("*" in url for url in urls))
        auth_email = re.search(r"\[auth\.email\](.*?)(?=\n\[|\Z)", self.supabase_config, re.S)
        self.assertIsNotNone(auth_email)
        self.assertIn("enable_confirmations = false", auth_email.group(1))

    def test_signup_requires_only_mandatory_consent_and_preserves_optional_choices(self):
        self.assertIn("hasRequiredLegalConsentChoices(consentChoices)", self.auth)
        for key in ("age_confirmed", "user_agreement", "license", "personal_data", "health_data", "advertising", "cookie_storage"):
            self.assertIn(f"'{key}'", self.documents)
        self.assertIn("buildSignupConsentMetadata", self.auth)
        self.assertNotIn("cookieConsent", self.auth)
        for document_id in ("user-agreement", "license", "personal-data-consent", "privacy", "health-data-consent", "advertising-consent"):
            self.assertIn(f'documentId="{document_id}"', self.auth)
        self.assertIn("setSignupSent(true)", self.auth)
        self.assertIn("Проверьте почту и подтвердите адрес", self.auth)

    def test_email_confirmation_returns_to_onboarding_gate(self):
        self.assertIn("emailRedirectTo: `${window.location.origin}/onboarding`", self.auth)
        self.assertIn('path="/onboarding" element={<OnboardingRoute />}', self.app)
        self.assertIn("if (!session) {", self.app)
        self.assertIn("if (profile && !profile.onboarding_completed)", self.app)
        self.assertIn("if (profile.onboarding_completed) return <Navigate to=\"/\" replace />", self.app)
        self.assertIn("navigate(afterOnboardingPath())", (ROOT / "src/pages/OnboardingPage.tsx").read_text())
        self.assertNotIn("location.search", self.auth)

    def test_repeat_or_expired_confirmation_link_offers_resend(self):
        self.assertIn("callbackParams.has('error_code')", self.app)
        self.assertIn("confirmationLinkError: true", self.app)
        self.assertIn("supabase.auth.resend({", self.auth)
        self.assertIn("type: 'signup'", self.auth)
        self.assertIn("Отправить письмо подтверждения ещё раз", self.auth)
        self.assertNotIn("window.location.assign", self.auth)

    def test_signup_consents_are_server_validated_and_written_append_only(self):
        for required in ("age_confirmed", "user_agreement", "license", "personal_data"):
            self.assertIn(f"v_consents ->> '{required}' IS DISTINCT FROM 'true'", self.consent_sql)
        self.assertIn("AFTER INSERT ON auth.users", self.consent_sql)
        for optional in ("health_data", "advertising"):
            self.assertIn(f"v_consents ->> '{optional}' = 'true'", self.consent_sql)
        self.assertIn("IF v_consents ? 'cookie_storage'", self.consent_sql)
        self.assertIn("jsonb_typeof(v_consents -> 'cookie_storage') = 'boolean'", self.consent_sql)
        self.assertIn("BEFORE UPDATE OR DELETE ON public.legal_consent_events", self.consent_sql)
        self.assertIn("USING (user_id = auth.uid())", self.consent_sql)
        self.assertIn("'health_data',", self.consent_sql)
        self.assertIn("'revoked'", self.consent_sql)

    def test_about_and_documents_define_page_metadata(self):
        self.assertIn("usePageMetadata('Документы — Sobralis'", self.pages)
        self.assertIn("usePageMetadata('О сервисе — Sobralis'", self.pages)
        self.assertIn("og:title", self.pages)
        self.assertIn("og:description", self.pages)

    def test_existing_accounts_get_an_explicit_consent_transition(self):
        transition = (ROOT / "src/pages/LegalUpdatePage.tsx").read_text()
        registry = self.documents
        self.assertIn("legacy_legal_transition boolean NOT NULL DEFAULT false", self.consent_sql)
        self.assertIn("UPDATE public.profiles SET legacy_legal_transition = true", self.consent_sql)
        self.assertIn("CREATE FUNCTION public.requires_legal_update()", self.consent_sql)
        self.assertIn("CREATE FUNCTION public.accept_existing_legal_consents(", self.consent_sql)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.accept_existing_legal_consents", self.consent_sql)
        self.assertIn("'legal_update'", self.consent_sql)
        self.assertIn("setRegistrationStatus('legal_update_required')", self.auth_context)
        self.assertIn('path="/legal-update"', self.app)
        self.assertIn("accept_existing_legal_consents", transition)
        for document_id in ("user-agreement", "license", "personal-data-consent", "privacy", "health-data-consent", "advertising-consent"):
            self.assertIn(f'documentId="{document_id}"', transition)
        self.assertIn("buildLegalUpdateConsentArgs", transition)
        for rpc_arg in ("_health_data", "_advertising", "_cookie_storage"):
            self.assertIn(rpc_arg, registry)
        self.assertNotIn("cookieConsent", transition)
        self.assertIn("source IN ('signup', 'legal_update')", self.registration_sql)
        self.assertIn("source IN ('signup', 'legal_update')", self.registration_sql)
        self.assertNotIn("INSERT INTO public.legal_consent_events\n  SELECT", self.consent_sql)

    def test_calendar_cycle_failure_does_not_abort_ordinary_calendar_load(self):
        self.assertIn("const CYCLE_DATE_FINDER_ENABLED = false", self.calendar)
        self.assertIn("if (!CYCLE_DATE_FINDER_ENABLED ||", self.calendar)
        self.assertIn("// The cycle feature is optional.", self.calendar)
        self.assertIn("} catch {\n          setCycleSettings(null);\n        }", self.calendar)

    def test_legacy_access_rollback_preserves_consent_events(self):
        self.assertIn("legacy_legal_transition", self.legacy_rollback_sql)
        self.assertIn("source IN ('signup', 'legal_update')", self.legacy_rollback_sql)
        self.assertIn("REVOKE ALL ON FUNCTION public.registration_is_complete() FROM PUBLIC, anon", self.legacy_rollback_sql)
        self.assertNotRegex(self.legacy_rollback_sql, r"(?i)\b(INSERT|UPDATE|DELETE|DROP)\s+(INTO\s+)?public\.legal_consent_events")

    def test_cookie_consent_banner_is_explicit_and_does_not_load_analytics(self):
        self.assertIn("<CookieConsentBanner />", self.app)
        self.assertIn("<LegalFooter inset={!isPublicRoute} />\n      <CookieConsentBanner />", self.app)
        for label in ("Принять все", "Только необходимые", "Настроить", "Разрешить необязательную аналитику"):
            self.assertIn(label, self.cookie_banner)
        self.assertIn('documentId="cookie-consent"', self.cookie_banner)
        self.assertIn("Яндекс.Метрика", self.cookie_banner)
        self.assertIn("планируется использование Яндекс.Метрики", self.cookie_document)
        self.assertIn("set_cookie_storage_consent", self.cookie_consents)
        self.assertIn("pendingAnonymousSync", self.cookie_consents)
        self.assertIn("syncedUserId", self.cookie_consents)
        self.assertIn("capturedBySignup", self.cookie_consents)
        self.assertIn("CREATE FUNCTION public.set_cookie_storage_consent(_allow_analytics boolean)", self.consent_sql)
        self.assertIn("auth.uid()", self.consent_sql[self.consent_sql.index("CREATE FUNCTION public.set_cookie_storage_consent"):])
        self.assertIn("FROM auth.users WHERE id=v_uid FOR UPDATE", self.consent_sql)
        self.assertIn("THEN 'revoked' ELSE 'declined' END", self.consent_sql)
        self.assertIn("v_decision := CASE WHEN v_latest_decision='granted' THEN 'revoked' ELSE 'declined' END", self.consent_sql)
        self.assertIn("REVOKE ALL ON FUNCTION public.set_cookie_storage_consent(boolean) FROM PUBLIC, anon", self.consent_sql)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.set_cookie_storage_consent(boolean) TO authenticated", self.consent_sql)
        self.assertIn("IF _cookie_storage IS TRUE THEN", self.consent_sql)
        self.assertNotIn("_cookie_storage IS FALSE", self.consent_sql)
        self.assertNotIn("metrika", self.cookie_banner.lower().replace("яндекс.метрика", ""))
        self.assertFalse("cookieConsent" in self.auth or "cookieConsent" in (ROOT / "src/pages/LegalUpdatePage.tsx").read_text())

    def test_cookie_consent_is_account_scoped_and_restored_from_latest_event(self):
        state = (ROOT / "src/lib/cookieConsentState.ts").read_text()
        self.assertIn("sobralis.cookie-consent.v1:anonymous", state)
        self.assertIn("sobralis.cookie-consent.v1:user:", state)
        self.assertIn(".eq('user_id', userId)", self.cookie_consents)
        self.assertIn(".eq('consent_type', 'cookie_storage')", self.cookie_consents)
        self.assertIn(".order('recorded_at', { ascending: false })", self.cookie_consents)
        self.assertIn(".order('id', { ascending: false })", self.cookie_consents)
        self.assertIn("syncAnonymousCookieConsentToUser", self.cookie_banner)
        self.assertIn("capturedBySignup", self.cookie_consents)

    def test_cookie_consent_rpc_rejects_session_change_and_stale_completion(self):
        state = (ROOT / "src/lib/cookieConsentState.ts").read_text()
        self.assertIn("session?.user.id !== expectedUserId", self.cookie_consents)
        self.assertIn("isCurrentCookieConsentChoice(latest, choice)", self.cookie_banner)
        self.assertIn("currentUserId.current !== userId", self.cookie_banner)
        self.assertIn("catch {\n      if (generation === requestGeneration.current", self.cookie_banner)
        self.assertIn("setSyncError(true)", self.cookie_banner)
        self.assertIn("pendingSyncUserId: null, syncedUserId: userId", self.cookie_banner)
        self.assertIn("isCurrentCookieConsentChoice", state)

    def test_legal_links_and_legacy_consent_args_use_central_registry(self):
        transition = (ROOT / "src/pages/LegalUpdatePage.tsx").read_text()
        legal_link = (ROOT / "src/components/LegalDocumentLink.tsx").read_text()
        self.assertIn("buildLegalUpdateConsentArgs", transition)
        self.assertIn("findLegalDocument(documentId)", legal_link)
        for component in (self.auth, transition, self.cookie_banner):
            self.assertNotRegex(component, r'to="/legal/')
        self.assertGreaterEqual(self.documents.count("consent: {"), 6)
        self.assertIn("document.publicationDate", self.pages)


if __name__ == "__main__":
    unittest.main()
