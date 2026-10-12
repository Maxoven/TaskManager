import React, { useId, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import apiError from '../utils/apiError';
import Icon from './Icon';

// Приглашение по email — одна и та же форма для команды и для отдельного проекта.
// children — дополнительные поля (выбор роли в команде): тогда кнопка встаёт под ними.
// onInvite(email) возвращает промис; ошибку показываем рядом с полем, а если
// человек ещё не зарегистрирован — предлагаем ссылку на регистрацию, которую можно ему отправить.
function InviteForm({ onInvite, label, hint, submitLabel, autoFocus = false, children }) {
  const { t } = useLanguage();
  const inputId = useId();
  const hintId = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notRegistered, setNotRegistered] = useState(false);
  const [copied, setCopied] = useState(false);

  const registerUrl = `${window.location.origin}/register`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setNotRegistered(false); setCopied(false); setBusy(true);
    try {
      await onInvite(email.trim());
      setEmail('');
    } catch (err) {
      setNotRegistered(err.response?.status === 404);
      setError(apiError(err, t, 'inviteError'));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(registerUrl);
      setCopied(true);
    } catch {
      // Буфер обмена недоступен — ссылка видна в поле, её можно выделить вручную
      setCopied(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="invite-form">
      <label htmlFor={inputId} className="invite-form-label">{label}</label>
      <div className="invite-form-row">
        <input
          id={inputId}
          type="email"
          className="invite-form-input"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); setNotRegistered(false); }}
          required
          autoFocus={autoFocus}
          autoComplete="off"
          aria-describedby={hintId}
        />
        {!children && (
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t('inviteSending') : submitLabel}
          </button>
        )}
      </div>
      <p id={hintId} className="field-hint">{hint}</p>
      {children && (
        <>
          {children}
          <div className="invite-form-submit">
            <button type="submit" className="btn-primary" disabled={busy}>
              <Icon name="mail" size={16} />
              {busy ? t('inviteSending') : submitLabel}
            </button>
          </div>
        </>
      )}
      {error && (
        <div className="invite-form-error" role="alert">
          <p className="field-error">{error}</p>
          {notRegistered && (
            <div className="invite-register-link">
              <label htmlFor={`${inputId}-link`} className="field-hint">{t('inviteRegisterLinkLabel')}</label>
              <div className="invite-form-row">
                <input id={`${inputId}-link`} type="text" readOnly value={registerUrl} className="invite-form-input" onFocus={(e) => e.target.select()} />
                <button type="button" className="btn-secondary" onClick={handleCopy}>
                  {copied ? t('copied') : t('copyLink')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

export default InviteForm;
