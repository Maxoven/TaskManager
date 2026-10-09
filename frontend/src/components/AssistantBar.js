import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { getAssistant, sendAssistantMessage, clearAssistant } from '../services/api';
import apiError from '../utils/apiError';
import Icon from './Icon';
import './AssistantBar.css';

const MAX_LENGTH = 2000;
const SUGGESTION_KEYS = ['assistantSuggestOverdue', 'assistantSuggestWeek', 'assistantSuggestReports', 'assistantSuggestFiles'];

// ИИ-ассистент: тонкая полоска под шапкой, по нажатию раскрывается в чат.
// Сервер хранит последние 20 сообщений переписки на пользователя.
function AssistantBar() {
  const { t } = useLanguage();
  const { notify, confirm } = useFeedback();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [limit, setLimit] = useState(20);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(null); // вопрос, на который ждём ответ
  const [error, setError] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getAssistant()
      .then(({ data }) => {
        if (cancelled) return;
        setEnabled(!!data.enabled);
        setMessages(data.messages || []);
        if (data.limit) setLimit(data.limit);
      })
      .catch(() => { /* ассистент — дополнение: при сбое просто не показываем полоску */ });
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Escape и щелчок мимо панели сворачивают чат
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Открыто окно или диалог поверх — Escape относится к ним
      if (document.querySelector('.modal-overlay')) return;
      close();
    };
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target) && !e.target.closest('.modal-overlay')) close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Показываем последний вопрос вверху списка: длинный ответ читается с начала, а не с конца
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const questions = list.querySelectorAll('.assistant-message-user');
    const last = questions[questions.length - 1];
    list.scrollTop = last ? last.offsetTop - list.offsetTop : list.scrollHeight;
  }, [open, messages, pending]);

  const send = async (text) => {
    const question = text.trim();
    if (!question || pending) return;
    setError('');
    setDraft('');
    setPending(question);
    try {
      const { data } = await sendAssistantMessage(question);
      setMessages(prev => [...prev, ...data.messages].slice(-limit));
    } catch (e) {
      setError(apiError(e, t, 'assistantError'));
      setDraft(question); // возвращаем текст, чтобы не набирать заново
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    send(draft);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: t('assistantClearTitle'),
      message: t('assistantClearText'),
      confirmLabel: t('assistantClearConfirm'),
      cancelLabel: t('cancel'),
      danger: true
    });
    if (!ok) return;
    try {
      await clearAssistant();
      setMessages([]);
      setError('');
    } catch (e) {
      notify.error(apiError(e, t, 'assistantError'));
    }
  };

  if (!enabled) return null;

  const isEmpty = messages.length === 0 && !pending;

  return (
    <div className={`assistant ${open ? 'assistant-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="assistant-strip"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="assistant-panel"
      >
        <Icon name="sparkles" size={16} className="assistant-strip-icon" />
        <span className="assistant-strip-title">{t('assistantTitle')}</span>
        <span className="assistant-strip-hint">{t('assistantStripHint')}</span>
        <Icon name="chevron-down" size={16} className="assistant-strip-chevron" />
      </button>

      {open && (
        <section className="assistant-panel" id="assistant-panel" aria-label={t('assistantTitle')}>
          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {isEmpty ? (
              <div className="assistant-empty">
                <p className="assistant-empty-title">{t('assistantEmptyTitle')}</p>
                <p className="assistant-empty-text">{t('assistantEmptyText')}</p>
                <div className="assistant-suggestions">
                  {SUGGESTION_KEYS.map(key => (
                    <button key={key} type="button" className="assistant-suggestion" onClick={() => send(t(key))}>
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="assistant-list">
                {messages.map(m => (
                  <li key={m.id} className={`assistant-message assistant-message-${m.role}`}>
                    <span className="visually-hidden">{m.role === 'user' ? t('assistantYou') : t('assistantTitle')}: </span>
                    {m.content}
                  </li>
                ))}
                {pending && (
                  <>
                    <li className="assistant-message assistant-message-user">{pending}</li>
                    <li className="assistant-message assistant-message-assistant assistant-message-pending" role="status">
                      <span className="assistant-typing" aria-hidden="true"><i /><i /><i /></span>
                      <span>{t('assistantThinking')}</span>
                    </li>
                  </>
                )}
              </ul>
            )}
          </div>

          {error && <p className="assistant-error" role="alert">{error}</p>}

          <form className="assistant-form" onSubmit={handleSubmit}>
            <label htmlFor="assistant-input" className="visually-hidden">{t('assistantInputLabel')}</label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              className="assistant-input"
              rows={1}
              value={draft}
              maxLength={MAX_LENGTH}
              placeholder={t('assistantPlaceholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="submit" className="btn-primary assistant-send" disabled={!draft.trim() || !!pending} aria-label={t('assistantSend')} title={t('assistantSend')}>
              <Icon name="send" size={18} />
            </button>
          </form>

          <div className="assistant-footer">
            <span className="assistant-note">
              {t('assistantNote', { limit })} <span className="assistant-keys-hint">{t('assistantKeysHint')}</span>
            </span>
            {messages.length > 0 && (
              <button type="button" className="assistant-clear" onClick={handleClear} disabled={!!pending}>
                {t('assistantClear')}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default AssistantBar;
