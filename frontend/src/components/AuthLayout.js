import React, { useId, useState } from 'react';
import { LangToggle, useLanguage } from '../context/LanguageContext';
import { Logo } from './AppHeader';
import Icon from './Icon';
import './Auth.css';

// Общая рамка экранов без авторизации: вход, регистрация, сброс пароля, отчёт по ссылке
function AuthLayout({ children, className = '' }) {
  return (
    <div className="auth-container">
      <main className={`auth-box ${className}`}>
        <div className="auth-lang-toggle">
          <Logo />
          <LangToggle />
        </div>
        {children}
      </main>
    </div>
  );
}

const STATUS_ICONS = { success: 'check', error: 'x', mail: 'mail' };

// Экран-состояние: «письмо отправлено», «ссылка недействительна», «проверяем…»
export function AuthStatus({ kind = 'success', title, children }) {
  return (
    <div className={`auth-status auth-status-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="auth-status-icon" aria-hidden="true">
        {kind === 'loading' ? <span className="spinner" /> : <Icon name={STATUS_ICONS[kind]} size={28} />}
      </div>
      <h1 className="auth-status-title">{title}</h1>
      {children}
    </div>
  );
}

// Поле пароля с кнопкой «Показать / Скрыть»
export function PasswordField({ label, value, onChange, hint, name, autoComplete = 'current-password', minLength, placeholder }) {
  const { t } = useLanguage();
  const id = useId();
  const hintId = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required
          minLength={minLength}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible(v => !v)}
          aria-pressed={visible}
          aria-label={visible ? t('passwordHide') : t('passwordShow')}
          title={visible ? t('passwordHide') : t('passwordShow')}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={18} />
        </button>
      </div>
      {hint && <p id={hintId} className="field-hint">{hint}</p>}
    </div>
  );
}

export default AuthLayout;
