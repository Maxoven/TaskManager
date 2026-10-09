import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from './LanguageContext';
import Icon from '../components/Icon';
import useExitGhost from '../utils/useExitGhost';
import './Feedback.css';

// Единая обратная связь вместо window.alert / window.confirm:
//   const { notify, confirm } = useFeedback();
//   notify.success('Проект создан');  notify.error('Не удалось…');
//   if (await confirm({ title, message, confirmLabel, cancelLabel, danger: true, focusCancel: true })) { … }
const FeedbackContext = createContext(null);

const SUCCESS_MS = 4000;
const ERROR_MS = 8000;
const TOAST_EXIT_MS = 180; // длительность анимации исчезновения (--dur)
const TOAST_ICONS = { success: 'check-circle', error: 'alert-circle', info: 'info' };

function ConfirmDialog({ options, onResult }) {
  const { t } = useLanguage();
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const overlayRef = useRef(null);
  useExitGhost(overlayRef);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    // Для опасных действий фокус на «Отмена», чтобы случайный Enter ничего не удалил
    ((options.danger || options.focusCancel) ? cancelRef.current : confirmRef.current)?.focus();
    // Перехватываем Escape раньше окна под диалогом, чтобы закрылся только диалог
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onResult(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    };
  }, [options, onResult]);

  return (
    <div ref={overlayRef} className="modal-overlay confirm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onResult(false); }}>
      <div
        className={`modal confirm-dialog ${options.danger ? 'confirm-dialog-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={options.message ? 'confirm-dialog-message' : undefined}
      >
        <div className="confirm-dialog-body">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <Icon name={options.danger ? 'alert' : 'help'} size={22} />
          </span>
          <div className="confirm-dialog-text">
            <h2 id="confirm-dialog-title" className="confirm-dialog-title">{options.title}</h2>
            {options.message && <p id="confirm-dialog-message" className="confirm-dialog-message">{options.message}</p>}
          </div>
        </div>
        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" ref={cancelRef} className="btn-secondary" onClick={() => onResult(false)}>
              {options.cancelLabel || t('cancel')}
            </button>
            <button type="button" ref={confirmRef} className={options.danger ? 'btn-danger' : 'btn-primary'} onClick={() => onResult(true)}>
              {options.confirmLabel || t('confirmOk')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeedbackProvider({ children }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const nextId = useRef(1);
  const timers = useRef({});

  // Уведомление сначала помечается уходящим (анимация), затем убирается из списка
  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    setToasts(list => list.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)));
    timers.current[id] = setTimeout(() => {
      delete timers.current[id];
      setToasts(list => list.filter(toast => toast.id !== id));
    }, TOAST_EXIT_MS);
  }, []);

  const push = useCallback((type, text) => {
    if (!text) return;
    const id = nextId.current++;
    // Одинаковое сообщение не дублируем — показываем заново
    setToasts(list => [...list.filter(toast => toast.text !== text), { id, type, text }].slice(-4));
    timers.current[id] = setTimeout(() => dismiss(id), type === 'error' ? ERROR_MS : SUCCESS_MS);
  }, [dismiss]);

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const notify = useMemo(() => ({
    success: (text) => push('success', text),
    error: (text) => push('error', text),
    info: (text) => push('info', text)
  }), [push]);

  const confirm = useCallback((options) => new Promise((resolve) => {
    setConfirmState({ options, resolve });
  }), []);

  const handleConfirmResult = useCallback((result) => {
    setConfirmState(current => {
      if (current) current.resolve(result);
      return null;
    });
  }, []);

  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-region" role="region" aria-label={t('notificationsRegion')}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type} ${toast.leaving ? 'toast-leaving' : ''}`}
            role={toast.type === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-icon" aria-hidden="true"><Icon name={TOAST_ICONS[toast.type] || 'info'} size={18} /></span>
            <span className="toast-text">{toast.text}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t('close')} title={t('close')}><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
      {confirmState && <ConfirmDialog options={confirmState.options} onResult={handleConfirmResult} />}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  return useContext(FeedbackContext);
}
