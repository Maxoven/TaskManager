import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useInbox } from '../context/InboxContext';
import { useLanguage } from '../context/LanguageContext';
import AccountMenu from './AccountMenu';
import TeamSwitcher from './TeamSwitcher';
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

// Единая шапка приложения: логотип, переключатель команд, (опционально) контент по центру, меню аккаунта, выход.
// Под шапкой, в потоке страницы, — строка ИИ-ассистента.
function AppHeader({ user, onLogout, children, wide = false }) {
  const { t } = useLanguage();
  const inbox = useInbox();
  return (
    <>
      <header className="app-header">
        <div className={`app-header-inner ${wide ? 'app-header-wide' : ''}`}>
          <Link to="/" className="app-header-logo" title="Task Manager">
            <Logo />
          </Link>
          {user && <TeamSwitcher />}
          {user && inbox && (
            <nav className="app-header-nav" aria-label={t('mainNav')}>
              <NavLink to="/inbox" className="header-inbox" title={t('inboxNavTitle')}>
                <Icon name="inbox" size={18} />
                <span className="header-inbox-text">{t('inboxTitle')}</span>
                {inbox.count > 0 && <span className="count-badge">{inbox.count}</span>}
              </NavLink>
            </nav>
          )}
          {children && <div className="app-header-center">{children}</div>}
          <div className="app-header-right">
            {user && inbox?.voiceEnabled && (
              <button type="button" className="btn-icon header-capture" onClick={inbox.openVoice} title={t('voiceOpenTitle')} aria-label={t('voiceOpenTitle')}>
                <Icon name="mic" size={18} />
              </button>
            )}
            {user && inbox && (
              <button type="button" className="header-quick-add" onClick={() => inbox.openQuickAdd()} title={t('quickAddOpenTitle')}>
                <Icon name="plus" size={16} />
                <span className="header-quick-add-text">{t('quickAddButton')}</span>
              </button>
            )}
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
