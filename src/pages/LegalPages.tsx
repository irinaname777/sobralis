import { Link, useParams } from 'react-router-dom';
import { LEGAL_DOCUMENTS, LEGAL_PUBLICATION_DATE, findLegalDocument } from '@/lib/legalDocuments';

export function DocumentsPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-rose-600">Собрались</p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">Документы</h1>
        <p className="mt-3 text-stone-600">Публичные документы сервиса.</p>
        <ul className="mt-8 divide-y divide-stone-200 border-y border-stone-200 bg-white">
          {LEGAL_DOCUMENTS.map((document) => (
            <li key={document.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <Link to={document.route} className="font-medium text-stone-800 hover:text-rose-600">
                  {document.title}
                </Link>
                <p className="mt-1 text-sm text-stone-500">
                  {document.version ? `Версия ${document.version}` : 'Версия в исходном документе не указана'}
                  {' · '}{document.publicationDate}
                </p>
              </div>
              <Link to={document.route} className="shrink-0 text-sm font-medium text-rose-600 hover:text-rose-700">
                Открыть
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

export function AboutPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-rose-600">Собрались</p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">О сервисе</h1>
        <p className="mt-5 max-w-2xl leading-7 text-stone-700">
          Sobralis помогает совместно планировать встречи и поездки, согласовывать даты и вести информационный учёт общих расходов.
        </p>
        <p className="mt-4 text-stone-600">
          Контактный адрес: <a className="text-rose-600 hover:text-rose-700" href="mailto:info@sobralis.online">info@sobralis.online</a>
        </p>
        <Link to="/documents" className="mt-6 inline-block font-medium text-rose-600 hover:text-rose-700">
          Юридические документы
        </Link>
      </div>
    </main>
  );
}

export function LegalDocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const document = findLegalDocument(documentId);

  if (!document) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold text-stone-900">Документ не найден</h1>
          <Link to="/documents" className="mt-4 inline-block text-rose-600 hover:text-rose-700">
            К списку документов
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Link to="/documents" className="text-sm font-medium text-rose-600 hover:text-rose-700">
          Все документы
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-stone-900 sm:text-3xl">{document.title}</h1>
        <p className="mt-2 text-sm text-stone-500">
          {document.version ? `Версия ${document.version}` : 'Версия в исходном документе не указана'}
          {' · '}{LEGAL_PUBLICATION_DATE}
        </p>
        <a
          href={document.asset}
          className="mt-3 inline-block text-sm text-rose-600 underline hover:text-rose-700"
        >
          Открыть исходное представление документа
        </a>
        <iframe
          title={document.title}
          src={document.asset}
          sandbox="allow-popups"
          className="mt-6 h-[75vh] min-h-[620px] w-full border border-stone-200 bg-white"
        />
      </div>
    </main>
  );
}
