export function LegalFooter({ inset = false }: { inset?: boolean }) {
  return (
    <footer
      aria-hidden="true"
      className={inset ? 'sm:pl-24' : ''}
    />
  );
}
