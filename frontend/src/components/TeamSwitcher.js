import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTeams, SHARED } from '../context/TeamContext';
import usePopover from '../utils/usePopover';
import Avatar from './Avatar';
import Icon from './Icon';
import CreateTeamModal from './CreateTeamModal';
import './TeamSwitcher.css';

export const ROLE_LABEL_KEYS = { owner: 'roleOwner', admin: 'roleAdmin', member: 'roleMember' };

// Переключатель команд в шапке: текущая команда, список всех команд пользователя,
// отдельные проекты (гостевой доступ), приглашения, настройки и создание команды.
function TeamSwitcher() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { teams, invitesTotal, sharedCount, current, currentTeam, selectTeam, refresh, loaded } = useTeams();
  const { open, setOpen, close, rootRef, buttonRef } = usePopover();
  const [creating, setCreating] = useState(false);

  if (!loaded) return null;

  const isShared = current === SHARED;
  const label = isShared ? t('sharedProjectsTitle') : currentTeam?.name || t('teamsTitle');

  const go = (id) => {
    selectTeam(id);
    close();
    navigate('/');
  };

  const openSettings = () => {
    close();
    navigate('/?tab=team');
  };

  const openInvitations = () => {
    close();
    navigate('/');
  };

  const startCreate = () => {
    close();
    setCreating(true);
  };

  const handleCreated = async (team) => {
    await refresh();
    selectTeam(team.id);
    setCreating(false);
    // Сразу к настройкам — следующий шаг после создания: пригласить людей
    navigate('/?tab=team');
  };

  return (
    <div className="team-switcher" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`team-switcher-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={open ? 'team-switcher-panel' : undefined}
        aria-label={t('teamSwitcherLabel', { name: label })}
        title={label}
      >
        {isShared
          ? <span className="team-switcher-shared-icon" aria-hidden="true"><Icon name="folder" size={14} /></span>
          : <Avatar name={label} size="sm" square aria-hidden="true" />}
        <span className="team-switcher-name">{label}</span>
        {invitesTotal > 0 && (
          <span className="team-switcher-dot" title={t('invitesPendingTitle', { count: invitesTotal })} aria-hidden="true" />
        )}
        <Icon name="chevron-down" size={14} className="team-switcher-chevron" />
      </button>

      {open && (
        <div className="team-switcher-panel" id="team-switcher-panel" role="group" aria-label={t('teamsTitle')}>
          <p className="team-switcher-heading">{t('teamsTitle')}</p>
          <ul className="team-switcher-list">
            {teams.map(team => {
              const active = team.id === current;
              return (
                <li key={team.id}>
                  <button type="button" className={`team-switcher-item ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => go(team.id)}>
                    <Avatar name={team.name} square aria-hidden="true" />
                    <span className="team-switcher-item-text">
                      <span className="team-switcher-item-name">{team.name}</span>
                      <span className="team-switcher-item-meta">
                        {t(ROLE_LABEL_KEYS[team.role])} · {t('teamMeta', { members: team.members_count, projects: team.projects_count })}
                      </span>
                    </span>
                    {active && <Icon name="check" size={16} className="team-switcher-check" />}
                  </button>
                </li>
              );
            })}
            {sharedCount > 0 && (
              <li>
                <button type="button" className={`team-switcher-item ${isShared ? 'is-active' : ''}`} aria-current={isShared ? 'true' : undefined} onClick={() => go(SHARED)}>
                  <span className="team-switcher-shared-icon team-switcher-shared-icon-lg" aria-hidden="true"><Icon name="folder" size={18} /></span>
                  <span className="team-switcher-item-text">
                    <span className="team-switcher-item-name">{t('sharedProjectsTitle')}</span>
                    <span className="team-switcher-item-meta">{t('sharedProjectsMeta', { count: sharedCount })}</span>
                  </span>
                  {isShared && <Icon name="check" size={16} className="team-switcher-check" />}
                </button>
              </li>
            )}
          </ul>

          {invitesTotal > 0 && (
            <button type="button" className="team-switcher-action team-switcher-invites" onClick={openInvitations}>
              <Icon name="mail" size={16} />
              <span>{t('invitesPendingAction')}</span>
              <span className="count-badge">{invitesTotal}</span>
            </button>
          )}

          <div className="team-switcher-actions">
            {currentTeam && (
              <button type="button" className="team-switcher-action" onClick={openSettings}>
                <Icon name="settings" size={16} />
                <span>{t('teamSettingsAction')}</span>
              </button>
            )}
            <button type="button" className="team-switcher-action" onClick={startCreate}>
              <Icon name="plus" size={16} />
              <span>{t('createTeamAction')}</span>
            </button>
          </div>
        </div>
      )}

      {creating && <CreateTeamModal onCreated={handleCreated} onClose={() => setCreating(false)} />}
    </div>
  );
}

export default TeamSwitcher;
