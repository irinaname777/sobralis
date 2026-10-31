export type LegalDocument = {
  id: string;
  title: string;
  route: string;
  asset: string;
  version: string | null;
  publicationDate: string;
  sha256: string;
};

export const LEGAL_PUBLICATION_DATE = '01 ноября 2026 года';

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    id: 'user-agreement',
    title: 'Пользовательское соглашение веб-сервиса «Собрались»',
    route: '/legal/user-agreement',
    asset: '/legal-content/user-agreement.html',
    version: '1.0',
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: '65147e8243648429633f4883526b429addcf4b49a0c68072a2e2c9bd6b1466f4',
  },
  {
    id: 'license',
    title: 'Публичная оферта о заключении лицензионного договора на использование веб-сервиса «Собрались»',
    route: '/legal/license',
    asset: '/legal-content/license.html',
    version: '1.0',
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: '4b6eba864e2735ffe331fd2be1dba00e0bd6f55b6294d50ba461c51350fbe1b1',
  },
  {
    id: 'privacy',
    title: 'Политика обработки персональных данных',
    route: '/legal/privacy',
    asset: '/legal-content/privacy.html',
    version: '1.0',
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: 'd57c348a479c7263048278d994e7ca44c083da7142e9c7616eccc446a1b5446c',
  },
  {
    id: 'personal-data-consent',
    title: 'Согласие на обработку персональных данных',
    route: '/legal/personal-data-consent',
    asset: '/legal-content/personal-data-consent.html',
    version: null,
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: 'bd60e9fd13615401a3d96669874f69765cf41ec8105b62dc1d00b969cbd3bb8a',
  },
  {
    id: 'advertising-consent',
    title: 'Согласие на получение рекламных сообщений',
    route: '/legal/advertising-consent',
    asset: '/legal-content/advertising-consent.html',
    version: null,
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: 'c90bccdf86dfee94d24bc8cf41eb96379cbb7a6c1bb83c66a442d576a416d416',
  },
  {
    id: 'health-data-consent',
    title: 'Согласие на обработку сведений о состоянии здоровья',
    route: '/legal/health-data-consent',
    asset: '/legal-content/health-data-consent.html',
    version: null,
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: '902bf211a356eabd5b89915dffe1b74a5b1bdf4bb8122f6fee943d5dab600559',
  },
  {
    id: 'cookie-consent',
    title: 'Согласие на использование необязательных cookie и браузерного хранилища',
    route: '/legal/cookie-consent',
    asset: '/legal-content/cookie-consent.html',
    version: null,
    publicationDate: LEGAL_PUBLICATION_DATE,
    sha256: 'a3a492c454e9c00a05250ce43816b68574ce0f6a2cc1e3fd3416e3e79dc8d025',
  },
];

export const LEGAL_CONSENT_COPY_SHA256 =
  '815c6a1ac75a7140f5887f24ab6ee82b941907b263f7f387c75d360663867d6b';

export function findLegalDocument(id: string | undefined) {
  return LEGAL_DOCUMENTS.find((document) => document.id === id);
}
