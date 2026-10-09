import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { INTERFACE_SIZES, getInterfaceSize, setInterfaceSize } from '../utils/interfaceSize';
import Avatar from './Avatar';
import Icon from './Icon';
import './AccountMenu.css';

const LANGUAGES = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' }
];

// Кнопка аккаунта в шапке: по нажатию — панель с настройками языка и размера интерфейса
function AccountMenu({ user }) {
  const { lang, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(getInterfaceSize);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(true); };
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, close]);

  const chooseSize = (id) => {
    setSize(id);
    setInterfaceSize(id);
  };

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`user-chip account-menu-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="account-menu-panel"
        aria-label={t('accountMenuLabel', { name: user.name })}
        title={user.email}
      >
        <Avatar name={user.name} size="sm" className="user-chip-avatar" aria-hidden="true" />
        <span className="user-chip-name">{user.name}</span>
        <Icon name="chevron-down" size={14} className="account-menu-chevron" />
      </button>

      {open && (
        <div className="account-menu-panel" id="account-menu-panel" role="group" aria-label={t('accountSettings')}>
          <div className="account-menu-user">
            <Avatar name={user.name} aria-hidden="true" />
            <div className="account-menu-user-text">
              <span className="account-menu-name">{user.name}</span>
              <span className="account-menu-email">{user.email}</span>
            </div>
          </div>

          <div className="account-menu-section">
            <span className="account-menu-label" id="account-lang-label">{t('settingsLanguage')}</span>
            <div className="segmented account-menu-segmented" role="group" aria-labelledby="account-lang-label">
              {LANGUAGES.map(l => (
                <button
                  key={l.id}
                  type="button"
                  lang={l.id}
                  className={`segmented-btn ${lang === l.id ? 'active' : ''}`}
                  aria-pressed={lang === l.id}
                  onClick={() => setLanguage(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="account-menu-section">
            <span className="account-menu-label" id="account-size-label">
              {t('settingsInterfaceSize')}
              <span className="account-menu-value">{t(`interfaceSize_${size}`)}</span>
            </span>
            <div className="segmented account-menu-segmented account-menu-sizes" role="group" aria-labelledby="account-size-label">
              {INTERFACE_SIZES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`segmented-btn account-size-btn account-size-${i} ${size === s.id ? 'active' : ''}`}
                  aria-pressed={size === s.id}
                  aria-label={t(`interfaceSize_${s.id}`)}
                  title={t(`interfaceSize_${s.id}`)}
                  onClick={() => chooseSize(s.id)}
                >
                  <span aria-hidden="true">A</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountMenu;
