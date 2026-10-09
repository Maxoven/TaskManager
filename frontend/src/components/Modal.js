import React, { useEffect, useId, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import useEscape from '../utils/useEscape';
import useExitGhost from '../utils/useExitGhost';
import Icon from './Icon';

// Общее модальное окно: заголовок, кнопка закрытия, Escape, клик по фону,
// возврат фокуса на элемент, с которого окно открыли.
// onClose может вернуть false/ничего — решение о закрытии принимает родитель.
function Modal({ title, onClose, children, className = '', description }) {
  const { t } = useLanguage();
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef(null);
  const overlayRef = useRef(null);

  useEscape(onClose);
  useExitGhost(overlayRef);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    // Если внутри нет поля с autoFocus — фокус на само окно, чтобы Tab шёл по нему
    if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
      dialogRef.current.focus();
    }
    return () => { if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus(); };
  }, []);

  return (
    // Закрываем только если нажатие началось на фоне (а не при выделении текста внутри окна)
    <div ref={overlayRef} className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} className="close-btn" title={t('close')} aria-label={t('close')}><Icon name="x" size={20} /></button>
        </div>
        {description && <p id={descId} className="modal-description">{description}</p>}
        {children}
      </div>
    </div>
  );
}

export default Modal;
