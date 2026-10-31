import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cookieConsentStorageKey,
  cookieConsentDecisionForChoice,
  decisionFromCookieConsentEvent,
  isCurrentCookieConsentChoice,
  transferAnonymousCookieConsent,
} from '../src/lib/cookieConsentState.ts';
import {
  buildLegalUpdateConsentArgs,
  buildSignupConsentMetadata,
  hasRequiredLegalConsentChoices,
} from '../src/lib/legalDocuments.ts';

describe('cookie consent ownership and stale RPC guards', () => {
  it('isolates anonymous state and each account', () => {
    assert.notEqual(cookieConsentStorageKey(null), cookieConsentStorageKey('account-a'));
    assert.notEqual(cookieConsentStorageKey('account-a'), cookieConsentStorageKey('account-b'));
    assert.equal(cookieConsentStorageKey('a/b'), 'sobralis.cookie-consent.v1:user:a%2Fb');
  });

  it('restores all persisted decisions, including explicit revocation', () => {
    assert.equal(decisionFromCookieConsentEvent('granted'), 'granted');
    assert.equal(decisionFromCookieConsentEvent('declined'), 'declined');
    assert.equal(decisionFromCookieConsentEvent('revoked'), 'revoked');
    assert.equal(decisionFromCookieConsentEvent('unknown'), null);
  });

  it('accepts a completion only for the exact current choice', () => {
    const submitted = { updatedAt: 't1', allowAnalytics: true, decision: 'granted' };
    assert.equal(isCurrentCookieConsentChoice(submitted, submitted), true);
    assert.equal(isCurrentCookieConsentChoice({ ...submitted, updatedAt: 't2' }, submitted), false);
    assert.equal(isCurrentCookieConsentChoice({ ...submitted, allowAnalytics: false, decision: 'revoked' }, submitted), false);
    assert.equal(isCurrentCookieConsentChoice(null, submitted), false);
  });

  it('transfers only an uncaptured anonymous choice into an empty account scope', () => {
    const anonymous = { decision: 'granted', allowAnalytics: true, pendingAnonymousSync: true, capturedBySignup: false };
    assert.deepEqual(transferAnonymousCookieConsent(anonymous, 'unset', 'account-a'), {
      decision: 'granted', allowAnalytics: true, pendingAnonymousSync: false, pendingSyncUserId: 'account-a',
    });
    assert.equal(transferAnonymousCookieConsent({ ...anonymous, capturedBySignup: true }, 'unset', 'account-a'), null);
    assert.equal(transferAnonymousCookieConsent(anonymous, 'declined', 'account-b'), null);
    assert.notEqual(cookieConsentStorageKey('account-a'), cookieConsentStorageKey('account-b'));
  });

  it('preserves explicit grant, decline, and revocation transitions', () => {
    assert.equal(cookieConsentDecisionForChoice(false, 'unset'), 'declined');
    assert.equal(cookieConsentDecisionForChoice(true, 'declined'), 'granted');
    assert.equal(cookieConsentDecisionForChoice(false, 'granted'), 'revoked');
    assert.equal(cookieConsentDecisionForChoice(true, 'revoked'), 'granted');
  });

  it('maps required and voluntary choices once, omitting an untouched cookie choice', () => {
    const choices = {
      ageConfirmed: true,
      userAgreementAccepted: true,
      licenseAccepted: true,
      personalDataConsent: true,
      healthDataConsent: false,
      advertisingConsent: true,
    };
    assert.equal(hasRequiredLegalConsentChoices(choices), true);
    assert.equal(hasRequiredLegalConsentChoices({ ...choices, licenseAccepted: false }), false);
    assert.equal(hasRequiredLegalConsentChoices({ ...choices, healthDataConsent: false, advertisingConsent: false }), true);
    assert.equal(hasRequiredLegalConsentChoices({ ...choices, userAgreementAccepted: false }), false);
    assert.equal(hasRequiredLegalConsentChoices({ ...choices, ageConfirmed: false }), false);
    assert.deepEqual(buildSignupConsentMetadata(choices), {
      age_confirmed: true,
      user_agreement: true,
      license: true,
      personal_data: true,
      health_data: false,
      advertising: true,
    });
    assert.equal('cookie_storage' in buildSignupConsentMetadata(choices), false);
    assert.equal(buildSignupConsentMetadata({ ...choices, cookieStorage: false }).cookie_storage, false);
    const splitAgreement = buildSignupConsentMetadata({ ...choices, userAgreementAccepted: false });
    assert.equal(splitAgreement.age_confirmed, true);
    assert.equal(splitAgreement.user_agreement, false);
    assert.deepEqual(buildLegalUpdateConsentArgs(choices), {
      _age_confirmed: true,
      _user_agreement: true,
      _license: true,
      _personal_data: true,
      _health_data: false,
      _advertising: true,
      _cookie_storage: null,
    });
  });
});
