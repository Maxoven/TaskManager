import { useCallback, useEffect, useRef, useState } from 'react';

// Выпадающая панель у кнопки (меню аккаунта, переключатель команд):
// Escape закрывает и возвращает фокус на кнопку, щелчок или переход фокуса мимо — просто закрывают.
export default function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    // Перехват на этапе погружения: Escape закрывает только панель, а не чат ассистента под ней.
    // Если поверх открыт диалог (подтверждение), Escape относится к нему.
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-overlay')) return;
      e.stopPropagation();
      close(true);
    };
    const outside = (e) => rootRef.current && !rootRef.current.contains(e.target) && !e.target.closest?.('.modal-overlay');
    const onPointer = (e) => { if (outside(e)) close(); };
    const onFocus = (e) => { if (outside(e)) close(); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open, close]);

  return { open, setOpen, close, rootRef, buttonRef };
}
