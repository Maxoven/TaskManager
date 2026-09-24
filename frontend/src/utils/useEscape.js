import { useEffect } from 'react';

// Закрытие модального окна по Escape
export default function useEscape(onEscape, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape, active]);
}
