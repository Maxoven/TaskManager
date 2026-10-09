import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import AccountMenu from './AccountMenu';
import Icon from './Icon';
import AssistantBar from './AssistantBar';
import './AppHeader.css';

// Логотип: зелёный квадрат с сегодняшним числом — как фавикон
export function Logo({ withText = true }) {
  const day = new Date().getDate();
  return (
    <span className="logo">
      <span className="logo-mark">{day}</span>
      {withText && <span className="logo-text">Task Manager</span>}
    </span>
  );
}

// Единая шапка приложения: логотип, (опционально) контент по центру, меню аккаунта, выход.
// Под шапкой, в потоке страницы, — строка ИИ-ассистента.
function AppHeader({ user, onLogout, children, wide = false }) {
  const { t } = useLanguage();
  return (
    <>
      <header className="app-header">
        <div className={`app-header-inner ${wide ? 'app-header-wide' : ''}`}>
          <Link to="/" className="app-header-logo" title="Task Manager">
            <Logo />
          </Link>
          {children && <div className="app-header-center">{children}</div>}
          <div className="app-header-right">
            {user && <AccountMenu user={user} />}
            <button type="button" onClick={onLogout} className="btn-ghost btn-logout" title={t('logout')}>
              <Icon name="logout" size={18} />
              <span className="btn-logout-text">{t('logout')}</span>
            </button>
          </div>
        </div>
      </header>
      {user && <AssistantBar wide={wide} />}
    </>
  );
}

export default AppHeader;
