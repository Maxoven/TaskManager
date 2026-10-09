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
const ROLE_ICONS = { owner: 'star', team: 'users', project: 'folder', pending: 'clock' };

// «Участники проекта»: кто имеет доступ и почему, приглашение, отмена приглашения,
// удаление участника (для владельца) и выход из проекта (для участника).
function ProjectMembersModal({ project, members, user, isOwner, onChanged, onLeft, onClose }) {
  const { t } = useLanguage();
  const { notify, confirm } = useFeedback();

  const isOwnerMember = (m) => Number(m.is_owner) === 1;
  // Порядок: владелец → участники → ожидающие ответа
  const rank = (m) => (isOwnerMember(m) ? 0 : m.status === 'pending' ? 2 : 1);
  const sorted = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const me = members.find(m => m.id === user?.id);

  const roleOf = (m) => {
    if (isOwnerMember(m)) return { key: 'owner', label: t('roleOwner'), hint: t('roleOwnerHint') };
    if (m.status === 'pending') return { key: 'pending', label: t('rolePending'), hint: t('rolePendingHint') };
    if (m.source === 'team') return { key: 'team', label: t('roleTeam'), hint: t('roleTeamHint') };
    return { key: 'project', label: t('roleProject'), hint: t('roleProjectHint') };
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
        message: member.source === 'team' ? t('removeTeamMemberFromProjectMessage') : t('removeMemberMessage'),
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
      message: me?.source === 'team' ? t('leaveProjectTeamMessage') : t('leaveProjectMessage'),
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

  return (
    <Modal title={t('membersModalTitle')} description={t('membersModalIntro')} onClose={onClose} className="members-modal">
      <ul className="people-list">
        {sorted.map(member => {
          const role = roleOf(member);
          return (
            <li key={member.id} className={`people-item people-item-${role.key}`}>
              <Avatar name={member.name} muted={role.key === 'pending'} className="people-avatar" aria-hidden="true" />
              <div className="people-info">
                <span className="people-name">
                  {member.name}
                  {member.id === user?.id && <span className="people-you"> {t('youMark')}</span>}
                </span>
                <span className="people-email">{member.email}</span>
                <span className={`people-role people-role-${role.key}`}>
                  <Icon name={ROLE_ICONS[role.key]} size={13} />
                  <span><strong>{role.label}</strong> — {role.hint}</span>
                </span>
              </div>
              {isOwner && !isOwnerMember(member) && (
                <button type="button" className="btn-small btn-small-danger" onClick={() => handleRemove(member)}>
                  {member.status === 'pending' ? t('cancelInviteBtn') : t('removeFromProjectBtn')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {isOwner ? (
        <section className="members-invite">
          <InviteForm
            onInvite={handleInvite}
            label={t('inviteToProjectLabel')}
            hint={t('inviteMustBeRegisteredHint')}
            submitLabel={t('inviteBtn')}
          />
          <p className="field-hint members-team-hint">
            {t('inviteProjectVsTeamHint')}{' '}
            <Link to="/?tab=team">{t('openTeamLink')}</Link>
          </p>
        </section>
      ) : (
        <section className="members-leave">
          <p className="field-hint">{t('onlyOwnerInvitesHint')}</p>
          <button type="button" className="btn-small btn-small-danger" onClick={handleLeave}>{t('leaveProjectBtn')}</button>
        </section>
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
