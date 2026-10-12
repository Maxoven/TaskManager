import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { inviteToProject, removeProjectMember, leaveProject } from '../services/api';
import apiError from '../utils/apiError';
import Modal from './Modal';
import InviteForm from './InviteForm';
import Icon from './Icon';
import Avatar from './Avatar';

// Роль обозначена значком и словом, а не только цветом
const ROLE_ICONS = { owner: 'star', admin: 'shield', member: 'users', guest: 'folder', pending: 'clock' };

// «Участники проекта»: команда проекта (все её участники видят проект) и гости —
// люди, приглашённые только в этот проект. Владелец и админы команды приглашают
// и убирают гостей; состав команды меняется в настройках команды. Гость может выйти сам.
function ProjectMembersModal({ project, members, user, canManage, onChanged, onLeft, onClose }) {
  const { t } = useLanguage();
  const { notify, confirm } = useFeedback();

  const keyOf = (m) => (m.status === 'pending' ? 'pending' : m.role);
  const RANK = { owner: 0, admin: 1, member: 2, guest: 3, pending: 4 };
  const sorted = [...members].sort((a, b) => RANK[keyOf(a)] - RANK[keyOf(b)] || a.name.localeCompare(b.name));
  const me = members.find(m => m.id === user?.id);

  const roleOf = (m) => {
    const key = keyOf(m);
    // Те же описания ролей, что в настройках команды
    const labels = {
      owner: ['roleOwner', 'roleLong_owner'],
      admin: ['roleAdmin', 'roleLong_admin'],
      member: ['roleMember', 'roleLong_member'],
      guest: ['roleGuest', 'roleGuestHint'],
      pending: ['rolePending', 'rolePendingHint']
    }[key];
    return { key, label: t(labels[0]), hint: t(labels[1]) };
  };

  const handleInvite = async (email) => {
    await inviteToProject(project.id, email);
    notify.success(t('invitationSentToast', { email }));
    onChanged();
  };

  const handleRemove = async (member) => {
    const pending = member.status === 'pending';
    const ok = await confirm(pending
      ? {
        title: t('cancelProjectInviteTitle', { name: member.name }),
        message: t('cancelProjectInviteMessage'),
        confirmLabel: t('cancelInviteBtn'),
        cancelLabel: t('keepBtn')
      }
      : {
        title: t('removeMemberTitle', { name: member.name }),
        message: t('removeMemberMessage'),
        confirmLabel: t('removeFromProjectBtn'),
        danger: true
      });
    if (!ok) return;
    try {
      await removeProjectMember(project.id, member.id);
      notify.success(pending ? t('inviteCancelledToast') : t('memberRemovedToast', { name: member.name }));
      onChanged();
    } catch (error) {
      notify.error(apiError(error, t, 'memberRemoveError'));
    }
  };

  const handleLeave = async () => {
    const ok = await confirm({
      title: t('leaveProjectTitle', { name: project.name }),
      message: t('leaveProjectMessage'),
      confirmLabel: t('leaveProjectBtn'),
      danger: true
    });
    if (!ok) return;
    try {
      await leaveProject(project.id);
      notify.success(t('leftProjectToast', { name: project.name }));
      onLeft();
    } catch (error) {
      notify.error(apiError(error, t, 'leaveError'));
    }
  };

  const teamPeople = sorted.filter(m => m.source === 'team');
  const guests = sorted.filter(m => m.source !== 'team');

  const renderPerson = (member) => {
    const role = roleOf(member);
    const removable = canManage && member.source !== 'team';
    return (
      <li key={member.id} className={`people-item people-item-${role.key}`}>
        <Avatar name={member.name} src={member.avatar} muted={role.key === 'pending'} className="people-avatar" aria-hidden="true" />
        <div className="people-info">
          <span className="people-name">
            {member.name}
            {member.id === user?.id && <span className="people-you"> {t('youMark')}</span>}
          </span>
          <span className="people-email">{member.email}</span>
          <span className={`people-role people-role-${role.key}`}>
            <Icon name={ROLE_ICONS[role.key]} size={13} />
            <span><strong>{role.label}.</strong> {role.hint.charAt(0).toUpperCase() + role.hint.slice(1)}</span>
          </span>
        </div>
        {removable && (
          <button type="button" className="btn-small btn-small-danger" onClick={() => handleRemove(member)}>
            {member.status === 'pending' ? t('cancelInviteBtn') : t('removeFromProjectBtn')}
          </button>
        )}
      </li>
    );
  };

  return (
    <Modal title={t('membersModalTitle')} description={t('membersModalIntro', { team: project.team_name || '' })} onClose={onClose} className="members-modal">
      <h3 className="people-group-title">{t('membersTeamGroup', { team: project.team_name || '' })}</h3>
      <ul className="people-list">{teamPeople.map(renderPerson)}</ul>
      {canManage && (
        <p className="field-hint people-group-hint">
          {t('membersTeamManagedHint')}{' '}
          <Link to="/?tab=team" onClick={onClose}>{t('openTeamSettingsLink')}</Link>
        </p>
      )}

      <h3 className="people-group-title">{t('membersGuestsGroup')}</h3>
      {guests.length > 0
        ? <ul className="people-list">{guests.map(renderPerson)}</ul>
        : <p className="field-hint people-group-hint">{t('membersNoGuests')}</p>}

      {canManage ? (
        <section className="members-invite">
          <InviteForm
            onInvite={handleInvite}
            label={t('inviteGuestLabel')}
            hint={t('inviteGuestHint')}
            submitLabel={t('inviteBtn')}
          />
        </section>
      ) : me?.role === 'guest' ? (
        <section className="members-leave">
          <p className="field-hint">{t('guestCanLeaveHint')}</p>
          <button type="button" className="btn-small btn-small-danger" onClick={handleLeave}>{t('leaveProjectBtn')}</button>
        </section>
      ) : (
        <p className="field-hint members-leave">{t('onlyAdminsInviteHint')}</p>
      )}

      <div className="modal-actions">
        <div className="modal-actions-right">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </Modal>
  );
}

export default ProjectMembersModal;
