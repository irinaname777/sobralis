import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function useHashFocus(ids: string[]) {
  const { hash } = useLocation();
  const idsKey = ids.join('|');
  useEffect(() => {
    if (!hash) return;
    const targetId = decodeURIComponent(hash.slice(1));
    if (!idsKey.split('|').includes(targetId)) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, idsKey]);
}
