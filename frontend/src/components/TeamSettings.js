import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { canManageRole } from '../context/TeamContext';
import {
  getTeamDetails, renameTeam, deleteTeam, inviteToTeam, changeTeamRole, removeTeamMember
} from '../services/api';
import apiError from '../utils/apiError';
import InviteForm from './InviteForm';
import Avatar from './Avatar';
import Icon from './Icon';
import { ROLE_LABEL_KEYS } from './TeamSwitcher';

const ROLE_ICONS = { owner: 'star', admin: 'shield', member: 'users' };
const INVITE_ROLES = ['member', 'admin'];

// Вкладка «Команда»: название, что умеют роли, приглашение с выбором роли,
// состав с изменением ролей, выход из команды или её удаление.
// Менять что-либо могут владелец и админы; участник видит состав и может выйти.
function TeamSettings({ teamId, user, onChanged }) {
  const { t } = useLanguage();
  const { notify, confirm } = useFeedback();
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getTeamDetails(teamId);
      setTeam(data);
      setError('');
    } catch (err) {
      setError(apiError(err, t, 'teamFetchError'));
    }
  }, [teamId, t]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!team) return <p className="hint-text">{t('loading')}</p>;

  const canManage = canManageRole(team.role);
  const isOwner = team.role === 'owner';
  const approved = team.members.filter(m => m.status === 'approved');
  const pending = team.members.filter(m => m.status === 'pending');

  const afterChange = async () => {
    await load();
    onChanged?.();
  };

  const handleInvite = async (email) => {
    const res = await inviteToTeam(teamId, email, inviteRole);
    notify.success(t('teamInviteSentToast', { name: res.data.member.name, role: t(ROLE_LABEL_KEYS[inviteRole]).toLowerCase() }));
    await afterChange();
  };

  const handleRename = async (e) => {
    e.preventDefault();
    try {
      await renameTeam(teamId, newName.trim());
      setRenaming(false);
      notify.success(t('teamRenamedToast'));
      await afterChange();
    } catch (err) {
      notify.error(apiError(err, t, 'teamUpdateError'));
    }
  };

  const handleRoleChange = async (member, role) => {
    setBusyId(member.id);
    try {
      await changeTeamRole(teamId, member.id, role);
      notify.success(t('roleChangedToast', { name: member.name, role: t(ROLE_LABEL_KEYS[role]).toLowerCase() }));
      await afterChange();
    } catch (err) {
      notify.error(apiError(err, t, 'roleUpdateError'));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (member) => {
    const isPending = member.status === 'pending';
    const ok = await confirm(isPending
      ? {
        title: t('cancelTeamInviteTitle', { name: member.name }),
        message: t('cancelTeamInviteMessage'),
        confirmLabel: t('cancelInviteBtn'),
        cancelLabel: t('keepBtn')
      }
      : {
        title: t('removeFromTeamTitleQ', { name: member.name }),
        message: t('removeFromTeamMessage', { team: team.name }),
        confirmLabel: t('removeFromTeamBtn'),
        danger: true
      });
    if (!ok) return;
    try {
      await removeTeamMember(teamId, member.id);
      notify.success(isPending ? t('inviteCancelledToast') : t('removedFromTeamToast', { name: member.name }));
      await afterChange();
    } catch (err) {
      notify.error(apiError(err, t, 'teamRemoveError'));
    }
  };

  const handleLeave = async () => {
    const ok = await confirm({
      title: t('leaveTeamTitle', { name: team.name }),
      message: t('leaveTeamMessage'),
      confirmLabel: t('leaveTeamBtn'),
      danger: true
    });
    if (!ok) return;
    try {
      await removeTeamMember(teamId, user.id);
      notify.success(t('leftTeamToast', { name: team.name }));
      onChanged?.();
    } catch (err) {
      notify.error(apiError(err, t, 'leaveError'));
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t('deleteTeamTitle', { name: team.name }),
      message: t('deleteTeamMessage'),
      confirmLabel: t('deleteTeamBtn'),
      danger: true
    });
    if (!ok) return;
    try {
      await deleteTeam(teamId);
      notify.success(t('teamDeletedToast', { name: team.name }));
      onChanged?.();
    } catch (err) {
      notify.error(apiError(err, t, 'teamDeleteError'));
    }
  };

  const renderMember = (member) => {
    const self = member.id === user?.id;
    const isPending = member.status === 'pending';
    // Роль владельца не меняется; свою роль тоже не меняем — чтобы случайно не лишить себя прав
    const editableRole = canManage && member.role !== 'owner' && !self && !isPending;
    const removable = canManage && member.role !== 'owner' && !self;
    const selectId = `role-${member.id}`;
    return (
      <li key={member.id} className={`team-member-card ${isPending ? 'team-member-pending' : ''}`}>
        <Avatar name={member.name} src={member.avatar} size="lg" muted={isPending} className="team-member-avatar" aria-hidden="true" />
        <div className="team-member-info">
          <span className="team-member-name">
            {member.name}
            {self && <span className="people-you"> {t('youMark')}</span>}
            {isPending && <span className="pending-badge chip chip-pending"><Icon name="clock" size={12} />{t('teamPending')}</span>}
          </span>
          <span className="team-member-email">{member.email}</span>
          {isPending && member.invited_by_name && (
            <span className="team-member-meta">{t('invitedByAs', { name: member.invited_by_name, role: t(ROLE_LABEL_KEYS[member.role]).toLowerCase() })}</span>
          )}
        </div>
        <div className="team-member-controls">
          {editableRole ? (
            <>
              <label htmlFor={selectId} className="visually-hidden">{t('roleSelectLabel', { name: member.name })}</label>
              <select id={selectId} className="team-role-select" value={member.role} disabled={busyId === member.id} onChange={(e) => handleRoleChange(member, e.target.value)}>
                {INVITE_ROLES.map(r => <option key={r} value={r}>{t(ROLE_LABEL_KEYS[r])}</option>)}
              </select>
            </>
          ) : (
            <span className={`role-chip role-chip-${member.role}`}>
              <Icon name={ROLE_ICONS[member.role]} size={13} />{t(ROLE_LABEL_KEYS[member.role])}
            </span>
          )}
          {removable && (
            <button type="button" onClick={() => handleRemove(member)} className="btn-small btn-small-danger">
              {isPending ? t('cancelInviteBtn') : t('removeFromTeamBtn')}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="team-section view-enter">
      <div className="team-header">
        <Avatar name={team.name} size="lg" square aria-hidden="true" />
        {renaming ? (
          <form className="team-rename-form" onSubmit={handleRename}>
            <label htmlFor="team-rename" className="visually-hidden">{t('teamNameLabel')}</label>
            <input id="team-rename" type="text" autoFocus required maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={!newName.trim()}>{t('save')}</button>
            <button type="button" className="btn-secondary" onClick={() => setRenaming(false)}>{t('cancel')}</button>
          </form>
        ) : (
          <div className="team-header-text">
            <h2>{team.name}</h2>
            <p className="team-hint">
              {t('yourRoleIs')} <strong className={`role-chip role-chip-${team.role}`}>{t(ROLE_LABEL_KEYS[team.role])}</strong>
            </p>
          </div>
        )}
        {canManage && !renaming && (
          <button type="button" className="btn-small" onClick={() => { setNewName(team.name); setRenaming(true); }}>
            <Icon name="pencil" size={14} />{t('renameTeamBtn')}
          </button>
        )}
      </div>

      {/* Что умеет каждая роль — прямо рядом с выбором роли и списком */}
      <section className="roles-explainer" aria-labelledby="roles-title">
        <h3 id="roles-title">{t('rolesTitle')}</h3>
        <ul>
          {['owner', 'admin', 'member'].map(r => (
            <li key={r} className={`roles-explainer-item ${team.role === r ? 'is-mine' : ''}`}>
              <span className={`roles-explainer-icon role-chip-${r}`} aria-hidden="true"><Icon name={ROLE_ICONS[r]} size={16} /></span>
              <span>
                <strong>{t(ROLE_LABEL_KEYS[r])}</strong>
                {team.role === r && <span className="roles-explainer-you"> · {t('thisIsYou')}</span>}
                <span className="roles-explainer-text">{t(`roleLong_${r}`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section className="team-add-form" aria-labelledby="team-invite-title">
          <h3 id="team-invite-title">{t('inviteToTeamTitle')}</h3>
          <InviteForm
            onInvite={handleInvite}
            label={t('inviteEmailLabel')}
            hint={t('inviteMustBeRegisteredHint')}
            submitLabel={t('sendInviteBtn')}
          >
            <fieldset className="invite-role">
              <legend className="invite-form-label">{t('inviteRoleLabel')}</legend>
              <div className="segmented invite-role-segmented">
                {INVITE_ROLES.map(r => (
                  <button key={r} type="button" className={`segmented-btn ${inviteRole === r ? 'active' : ''}`} aria-pressed={inviteRole === r} onClick={() => setInviteRole(r)}>
                    <Icon name={ROLE_ICONS[r]} size={15} />{t(ROLE_LABEL_KEYS[r])}
                  </button>
                ))}
              </div>
              <p className="field-hint invite-role-hint" aria-live="polite">{t(`roleLong_${inviteRole}`)} {t('roleChangeLaterHint')}</p>
            </fieldset>
          </InviteForm>
        </section>
      )}

      <section aria-labelledby="team-members-title">
        <h3 id="team-members-title" className="team-list-title">{t('teamMembersTitle', { count: approved.length })}</h3>
        {!canManage && <p className="team-hint">{t('memberTeamListHint')}</p>}
        <ul className="team-list">{approved.map(renderMember)}</ul>
        {pending.length > 0 && (
          <>
            <h3 className="team-list-title">{t('teamPendingTitle', { count: pending.length })}</h3>
            <ul className="team-list">{pending.map(renderMember)}</ul>
          </>
        )}
        {approved.length === 1 && pending.length === 0 && canManage && (
          <p className="team-hint team-alone-hint">{t('teamAloneHint')}</p>
        )}
      </section>

      <section className="team-danger" aria-labelledby="team-danger-title">
        <h3 id="team-danger-title">{isOwner ? t('deleteTeamSection') : t('leaveTeamSection')}</h3>
        <p className="team-hint">{isOwner ? t('deleteTeamHint') : t('leaveTeamHint')}</p>
        {isOwner ? (
          <button type="button" className="btn-small btn-small-danger" onClick={handleDelete}><Icon name="trash" size={14} />{t('deleteTeamBtn')}</button>
        ) : (
          <button type="button" className="btn-small btn-small-danger" onClick={handleLeave}><Icon name="logout" size={14} />{t('leaveTeamBtn')}</button>
        )}
      </section>
    </div>
  );
}

export default TeamSettings;
