import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { getAssistant, sendAssistantMessage, clearAssistant } from '../services/api';
import apiError from '../utils/apiError';
import Icon from './Icon';
import './AssistantBar.css';

const MAX_LENGTH = 2000;
const SUGGESTION_KEYS = ['assistantSuggestOverdue', 'assistantSuggestWeek', 'assistantSuggestReports', 'assistantSuggestFiles'];

// ИИ-ассистент: строка ввода с кнопкой «Отправить» под шапкой. Как только
// пользователь начинает печатать, строка раскрывается в окно чата и сдвигает
// содержимое страницы вниз (не перекрывает его).
// Сервер хранит последние 20 сообщений переписки на пользователя.
function AssistantBar({ wide = false }) {
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
      .catch(() => { /* ассистент — дополнение: при сбое просто не показываем строку */ });
    return () => { cancelled = true; };
  }, []);

  // Кнопки чата исчезают при сворачивании — фокус переводим в строку ввода
  const close = useCallback(() => {
    setOpen(false);
    inputRef.current?.focus();
  }, []);

  // Escape сворачивает чат обратно в строку ввода
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Открыто окно или диалог поверх — Escape относится к ним
      if (document.querySelector('.modal-overlay')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Поле растёт вместе с текстом (до max-height), дальше — прокрутка внутри
  const fitInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Пустое поле — высота по CSS: перенос подсказки не должен растягивать строку
    if (!el.value) return;
    // Предел берём из CSS (max-height в rem) — растёт вместе с размером интерфейса
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);

  useLayoutEffect(fitInput, [draft, open, enabled, fitInput]);

  // Ширина поля меняется (окно, размер интерфейса) — пересчитываем высоту
  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return; // своё изменение высоты — не реагируем
      lastWidth = el.clientWidth;
      fitInput();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, fitInput]);

  // Чат раскрылся — строка ввода сместилась вниз; держим её в поле зрения
  useEffect(() => {
    if (!open) return;
    const form = rootRef.current?.querySelector('.assistant-form');
    form?.scrollIntoView?.({ block: 'nearest' });
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
    setOpen(true);
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

  const handleChange = (e) => {
    const value = e.target.value;
    setDraft(value);
    // Начали печатать — раскрываем чат
    if (value.trim() && !open) setOpen(true);
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
      // Кнопка «Очистить» пропала вместе с сообщениями; диалог вернул фокус на неё — переводим в поле
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      notify.error(apiError(e, t, 'assistantError'));
    }
  };

  const openChat = () => {
    setOpen(true);
    inputRef.current?.focus();
  };

  if (!enabled) return null;

  const isEmpty = messages.length === 0 && !pending;

  return (
    <div className={`assistant-region ${wide ? 'assistant-region-wide' : ''}`}>
      <section
        className={`assistant ${open ? 'assistant-open' : ''}`}
        ref={rootRef}
        aria-label={t('assistantTitle')}
      >
        {open && (
          <div className="assistant-head">
            <span className="assistant-head-icon" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
            <span className="assistant-head-title">{t('assistantTitle')}</span>
            <span className="assistant-head-hint">{t('assistantStripHint')}</span>
            {messages.length > 0 && (
              <button type="button" className="assistant-clear" onClick={handleClear} disabled={!!pending}>
                <Icon name="trash" size={14} />
                <span className="assistant-clear-text">{t('assistantClear')}</span>
              </button>
            )}
            <button
              type="button"
              className="btn-icon assistant-collapse"
              onClick={close}
              aria-expanded="true"
              aria-controls="assistant-messages"
              aria-label={t('assistantCollapse')}
              title={t('assistantCollapse')}
            >
              <Icon name="chevron-down" size={18} />
            </button>
          </div>
        )}

        {open && (
          <div className="assistant-messages" id="assistant-messages" ref={listRef} aria-live="polite">
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
        )}

        {open && error && <p className="assistant-error" role="alert">{error}</p>}

        {/* Строка ввода всегда на месте в дереве — фокус и набранный текст не теряются при раскрытии */}
        <form className="assistant-form" onSubmit={handleSubmit}>
          {!open && <Icon name="sparkles" size={18} className="assistant-form-icon" />}
          <label htmlFor="assistant-input" className="visually-hidden">{t('assistantInputLabel')}</label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            className="assistant-input"
            rows={1}
            value={draft}
            maxLength={MAX_LENGTH}
            placeholder={open ? t('assistantPlaceholder') : t('assistantBarPlaceholder')}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
          />
          {!open && messages.length > 0 && (
            <button
              type="button"
              className="btn-ghost assistant-history"
              onClick={openChat}
              aria-expanded="false"
              aria-label={t('assistantShowChat')}
              title={t('assistantShowChat')}
            >
              <Icon name="history" size={18} />
              <span className="assistant-history-text">{t('assistantShowChat')}</span>
            </button>
          )}
          <button type="submit" className="btn-primary assistant-send" disabled={!draft.trim() || !!pending} aria-label={t('assistantSend')} title={t('assistantSend')}>
            <Icon name="send" size={18} />
          </button>
        </form>

        {open && (
          <p className="assistant-note">
            {t('assistantNote', { limit })} <span className="assistant-keys-hint">{t('assistantKeysHint')}</span>
          </p>
        )}
      </section>
    </div>
  );
}

export default AssistantBar;
