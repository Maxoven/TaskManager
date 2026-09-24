import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage, LangToggle } from '../context/LanguageContext';
import './AppHeader.css';

// Логотип: зелёный квадрат с сегодняшним числом — как фавикон
export function Logo({ size = 32, withText = true }) {
  const day = new Date().getDate();
  return (
    <span className="logo">
      <span className="logo-mark" style={{ width: size, height: size, fontSize: size * 0.5 }}>{day}</span>
      {withText && <span className="logo-text">Task Manager</span>}
    </span>
  );
}

// Единая шапка приложения: логотип, (опционально) контент по центру, язык, пользователь, выход
function AppHeader({ user, onLogout, children, wide = false }) {
  const { t } = useLanguage();
  return (
    <header className="app-header">
      <div className={`app-header-inner ${wide ? 'app-header-wide' : ''}`}>
        <Link to="/" className="app-header-logo" title="Task Manager">
          <Logo />
        </Link>
        {children && <div className="app-header-center">{children}</div>}
        <div className="app-header-right">
          <LangToggle />
          {user && (
            <span className="user-chip" title={user.email}>
              <span className="user-chip-avatar">{(user.name || '?').charAt(0).toUpperCase()}</span>
              <span className="user-chip-name">{user.name}</span>
            </span>
          )}
          <button onClick={onLogout} className="btn-ghost">{t('logout')}</button>
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
