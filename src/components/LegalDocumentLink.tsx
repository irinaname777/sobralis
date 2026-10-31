import { Link } from 'react-router-dom';
import { findLegalDocument } from '@/lib/legalDocuments';

export function LegalDocumentLink({
  documentId,
  className,
  targetBlank = false,
  label = 'title',
}: {
  documentId: string;
  className?: string;
  targetBlank?: boolean;
  label?: 'title' | 'checkbox' | 'inline';
}) {
  const document = findLegalDocument(documentId);
  if (!document) return null;
  return (
    <Link
      to={document.route}
      className={className}
      target={targetBlank ? '_blank' : undefined}
      rel={targetBlank ? 'noreferrer' : undefined}
      onClick={targetBlank ? (event) => event.stopPropagation() : undefined}
    >
      {label === 'checkbox' ? document.checkboxLinkLabel ?? document.title
        : label === 'inline' ? document.inlineLinkLabel ?? document.title
          : document.title}
    </Link>
  );
}
