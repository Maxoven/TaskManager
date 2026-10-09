import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import AppHeader from './AppHeader';
import Modal from './Modal';
import InviteForm from './InviteForm';
import Icon from './Icon';
import Avatar from './Avatar';
import { DashboardSkeleton } from './Skeleton';
import { formatDate, deadlineState, DEADLINE_CHIP, DEADLINE_ICON } from '../utils/date';
import apiError from '../utils/apiError';
import {
  getProjects, createProject, updateProject, deleteProject,
  getPendingInvitations, respondToInvitation, reorderProjects, getMyTasks,
  getTeam, addTeamMember, removeTeamMember, getTeamInvitations, respondToTeamInvitation,
  getTeamMemberships, leaveTeam
} from '../services/api';
import './Dashboard.css';

const TABS = ['projects', 'mytasks', 'team'];

// Прогресс проекта на карточке: выполнено / всего и просрочки
function ProjectStats({ project }) {
  const { t } = useLanguage();
  const total = project.tasks_total || 0;
  const done = project.tasks_done || 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="project-stats">
      <div className="project-progress" aria-hidden="true">
        <div className="project-progress-bar" style={{ width: `${percent}%` }} />
      </div>
      <div className="project-stats-row">
        <span>{total ? t('projectTasksDone', { done, total }) : t('projectNoTasks')}</span>
        {project.tasks_overdue > 0 && (
          <span className="project-overdue chip chip-danger"><Icon name="alert" size={13} />{t('projectOverdue', { count: project.tasks_overdue })}</span>
        )}
      </div>
    </div>
  );
}

// Форма проекта — одна для создания и редактирования
function ProjectFormModal({ project, onSubmit, onClose }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ name: project?.name || '', description: project?.description || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(apiError(err, t, project ? 'projectUpdateError' : 'projectCreateError'));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={project ? t('editProjectTitle') : t('createProjectTitle')}
      description={project ? undefined : t('createProjectIntro')}
      onClose={onClose}
      className="project-form-modal"
    >
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="project-name">{t('projectNameLabel')} <span className="required-mark" aria-hidden="true">*</span></label>
          <input id="project-name" type="text" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={255} placeholder={t('projectNamePlaceholder')} />
        </div>
        <div className="form-group">
          <label htmlFor="project-description">{t('projectDescLabel')}</label>
          <textarea id="project-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('projectDescPlaceholder')} rows="3" />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" onClick={onClose} className="btn-secondary">{t('cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('saving') : (project ? t('save') : t('createProjectSubmit'))}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Dashboard({ user, onLogout }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [team, setTeam] = useState([]);
  const [teamInvitations, setTeamInvitations] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sortMode, setSortMode] = useState(false);
  const [sortedProjects, setSortedProjects] = useState([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [myTasksTab, setMyTasksTab] = useState('active');
  const navigate = useNavigate();

  // Вкладка хранится в адресе (?tab=team), чтобы на неё можно было сослаться и вернуться кнопкой «Назад»
  const tabParam = searchParams.get('tab');
  const activeTab = TABS.includes(tabParam) ? tabParam : 'projects';
  const setActiveTab = (tab) => setSearchParams(tab === 'projects' ? {} : { tab });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [projectsRes, invitationsRes, tasksRes, teamRes, teamInvRes, membershipsRes] = await Promise.all([
        getProjects(), getPendingInvitations(), getMyTasks(), getTeam(), getTeamInvitations(), getTeamMemberships()
      ]);
      setProjects(projectsRes.data);
      setInvitations(invitationsRes.data);
      setMyTasks(tasksRes.data);
      setTeam(teamRes.data);
      setTeamInvitations(teamInvRes.data);
      setMemberships(membershipsRes.data);
      setLoadError('');
    } catch (error) {
      // Раньше при ошибке показывалась пустая страница «у вас нет проектов» — теперь говорим как есть
      setLoadError(apiError(error, t, 'dashboardLoadError'));
    } finally {
      setLoading(false);
    }
  };

  const retryLoad = () => { setLoading(true); loadData(); };

  const handleCreateProject = async (form) => {
    const response = await createProject(form);
    setShowCreateModal(false);
    notify.success(t('projectCreatedToast', { name: response.data.name }));
    // Сразу открываем новый проект — следующим шагом пользователь добавляет задачи
    navigate(`/project/${response.data.id}`);
  };

  const handleSaveEdit = async (form) => {
    await updateProject(editProject.id, form);
    setEditProject(null);
    notify.success(t('projectSavedToast'));
    loadData();
  };

  const handleDeleteProject = async (project) => {
    const ok = await confirm({
      title: t('deleteProjectTitle', { name: project.name }),
      message: project.tasks_total > 0
        ? t('deleteProjectMessageTasks', { count: project.tasks_total })
        : t('deleteProjectMessage'),
      confirmLabel: t('deleteProjectConfirmBtn'),
      danger: true
    });
    if (!ok) return;
    try {
      await deleteProject(project.id);
      notify.success(t('projectDeletedToast', { name: project.name }));
      loadData();
    } catch (error) {
      notify.error(apiError(error, t, 'projectDeleteError'));
    }
  };

  const handleInvitationResponse = async (inv, action) => {
    setBusyKey(`project-inv-${inv.id}`);
    try {
      await respondToInvitation(inv.id, action);
      notify.success(action === 'approve'
        ? t('inviteAcceptedToast', { name: inv.name })
        : t('inviteDeclinedToast'));
      await loadData();
    } catch (error) {
      notify.error(apiError(error, t, 'inviteRespondError'));
    } finally {
      setBusyKey('');
    }
  };

  const handleTeamInvitationResponse = async (inv, action) => {
    setBusyKey(`team-inv-${inv.owner_id}`);
    try {
      await respondToTeamInvitation(inv.owner_id, action);
      notify.success(action === 'approve'
        ? t('teamInviteAcceptedToast', { name: inv.owner_name })
        : t('inviteDeclinedToast'));
      await loadData();
    } catch (error) {
      notify.error(apiError(error, t, 'inviteRespondError'));
    } finally {
      setBusyKey('');
    }
  };

  const handleStartSort = () => {
    setSortedProjects(projects.filter(p => p.owner_id === user?.id));
    setSortMode(true);
  };

  const handleSortDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(sortedProjects);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setSortedProjects(items);
  };

  const handleSaveSort = async () => {
    setSavingOrder(true);
    try {
      await reorderProjects(sortedProjects.map(p => p.id));
      setSortMode(false);
      notify.success(t('orderSavedToast'));
      loadData();
    } catch (error) {
      notify.error(apiError(error, t, 'orderSaveError'));
    } finally {
      setSavingOrder(false);
    }
  };

  const handleAddTeamMember = async (email) => {
    const res = await addTeamMember(email);
    notify.success(t('teamInviteSent', { name: res.data.member.name }));
    loadData();
  };

  const handleRemoveTeamMember = async (member) => {
    const pending = member.status === 'pending';
    const ok = await confirm(pending
      ? {
        title: t('cancelTeamInviteTitle', { name: member.name }),
        message: t('cancelTeamInviteMessage'),
        confirmLabel: t('cancelInviteBtn'),
        cancelLabel: t('keepBtn')
      }
      : {
        title: t('removeFromTeamTitleQ', { name: member.name }),
        message: t('removeFromTeamMessage'),
        confirmLabel: t('removeFromTeamBtn'),
        danger: true
      });
    if (!ok) return;
    try {
      await removeTeamMember(member.id);
      notify.success(pending ? t('inviteCancelledToast') : t('removedFromTeamToast', { name: member.name }));
      loadData();
    } catch (error) {
      notify.error(apiError(error, t, 'teamRemoveError'));
    }
  };

  const handleLeaveTeam = async (membership) => {
    const ok = await confirm({
      title: t('leaveTeamTitle', { name: membership.owner_name }),
      message: t('leaveTeamMessage', { name: membership.owner_name }),
      confirmLabel: t('leaveTeamBtn'),
      danger: true
    });
    if (!ok) return;
    try {
      await leaveTeam(membership.owner_id);
      notify.success(t('leftTeamToast', { name: membership.owner_name }));
      loadData();
    } catch (error) {
      notify.error(apiError(error, t, 'leaveError'));
    }
  };

  if (loading) {
    return (
      <div className="dashboard">
        <AppHeader user={user} onLogout={onLogout} />
        <DashboardSkeleton label={t('loading')} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="dashboard">
        <AppHeader user={user} onLogout={onLogout} />
        <main className="page-error" role="alert">
          <span className="page-error-icon" aria-hidden="true"><Icon name="alert" size={26} /></span>
          <p className="page-error-title">{t('dashboardLoadErrorTitle')}</p>
          <p className="page-error-text">{loadError}</p>
          <div className="page-error-actions">
            <button type="button" onClick={retryLoad} className="btn-primary">{t('retry')}</button>
          </div>
        </main>
      </div>
    );
  }

  const myProjects = projects.filter(p => p.owner_id === user?.id);
  const memberProjects = projects.filter(p => p.owner_id !== user?.id);
  const activeTasks = myTasks.filter(task => !task.is_done);
  const doneTasks = myTasks.filter(task => task.is_done);
  const overdueCount = activeTasks.filter(task => deadlineState(task) === 'overdue').length;
  const approvedTeam = team.filter(m => m.status === 'approved');

  // Чужие проекты — группируем по владельцу, сохраняя порядок владельца
  const teamOwnerIds = new Set(memberships.map(m => m.owner_id));
  const byOwner = [];
  memberProjects.forEach(p => {
    let group = byOwner.find(g => g.ownerId === p.owner_id);
    if (!group) { group = { ownerId: p.owner_id, name: p.owner_name, projects: [] }; byOwner.push(group); }
    group.projects.push(p);
  });

  return (
    <div className="dashboard">
      <AppHeader user={user} onLogout={onLogout} />
      <main className="dashboard-main">
      <div className="dashboard-greeting">
        <h1>{t('hi')}, {user?.name}!</h1>
        <p>{t('dashboardSubtitle', { active: activeTasks.length, overdue: overdueCount })}</p>
      </div>

      {/* Приглашения в проекты */}
      {invitations.length > 0 && (
        <section className="invitations-section" aria-labelledby="project-invitations-title">
          <h2 id="project-invitations-title">{t('projectInvitationsTitle')}</h2>
          <div className="invitations-list">
            {invitations.map(inv => (
              <div key={inv.id} className="invitation-card">
                <span className="invitation-icon" aria-hidden="true"><Icon name="folder" size={20} /></span>
                <div className="invitation-body">
                  <h3>{inv.name}</h3>
                  <p>{t('projectInviteText', { name: inv.owner_name })}</p>
                  {inv.description && <p className="invitation-desc">{inv.description}</p>}
                </div>
                <div className="invitation-actions">
                  <button type="button" disabled={busyKey === `project-inv-${inv.id}`} onClick={() => handleInvitationResponse(inv, 'approve')} className="btn-primary">{t('inviteAccept')}</button>
                  <button type="button" disabled={busyKey === `project-inv-${inv.id}`} onClick={() => handleInvitationResponse(inv, 'reject')} className="btn-secondary">{t('inviteReject')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Приглашения в команду */}
      {teamInvitations.length > 0 && (
        <section className="invitations-section" aria-labelledby="team-invitations-title">
          <h2 id="team-invitations-title">{t('teamInvitationsTitle')}</h2>
          <div className="invitations-list">
            {teamInvitations.map(inv => (
              <div key={inv.owner_id} className="invitation-card team-invitation-card">
                <span className="invitation-icon" aria-hidden="true"><Icon name="users" size={20} /></span>
                <div className="invitation-body">
                  <h3>{t('teamInviteHeading', { name: inv.owner_name })}</h3>
                  <p>{t('teamInviteExplain', { name: inv.owner_name })}</p>
                </div>
                <div className="invitation-actions">
                  <button type="button" disabled={busyKey === `team-inv-${inv.owner_id}`} onClick={() => handleTeamInvitationResponse(inv, 'approve')} className="btn-primary">{t('inviteAccept')}</button>
                  <button type="button" disabled={busyKey === `team-inv-${inv.owner_id}`} onClick={() => handleTeamInvitationResponse(inv, 'reject')} className="btn-secondary">{t('inviteReject')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <nav className="dashboard-tabs segmented" aria-label={t('dashboardTabsLabel')}>
        <button type="button" className={`tab-btn segmented-btn ${activeTab === 'projects' ? 'active' : ''}`} aria-current={activeTab === 'projects' ? 'page' : undefined} onClick={() => setActiveTab('projects')}>
          <Icon name="folder" />
          {t('tabProjects')}
        </button>
        <button type="button" className={`tab-btn segmented-btn ${activeTab === 'mytasks' ? 'active' : ''}`} aria-current={activeTab === 'mytasks' ? 'page' : undefined} onClick={() => setActiveTab('mytasks')}>
          <Icon name="check-circle" />
          {t('tabMyTasks')}
          {overdueCount > 0 && <span className="count-badge count-badge-danger" title={t('overdueBadgeTitle')}>{overdueCount}</span>}
        </button>
        <button type="button" className={`tab-btn segmented-btn ${activeTab === 'team' ? 'active' : ''}`} aria-current={activeTab === 'team' ? 'page' : undefined} onClick={() => setActiveTab('team')}>
          <Icon name="users" />
          {t('tabTeam')}
          {approvedTeam.length > 0 && <span className="count-badge" title={t('teamBadgeTitle')}>{approvedTeam.length}</span>}
        </button>
      </nav>

      {activeTab === 'projects' && (
        <div className="projects-section view-enter">
          {sortMode ? (
            <>
              <div className="section-header">
                <h2>{t('reorderTitle')}</h2>
                <div className="section-actions">
                  <button type="button" onClick={() => setSortMode(false)} className="btn-secondary">{t('cancelOrder')}</button>
                  <button type="button" onClick={handleSaveSort} className="btn-primary" disabled={savingOrder}>{savingOrder ? t('saving') : t('saveOrderBtn')}</button>
                </div>
              </div>
              <p className="hint-text">{t('reorderHint')}</p>
              <DragDropContext onDragEnd={handleSortDragEnd}>
                <Droppable droppableId="sort-list">
                  {(provided) => (
                    <div className="sort-list" ref={provided.innerRef} {...provided.droppableProps}>
                      {sortedProjects.map((project, index) => (
                        <Draggable key={project.id} draggableId={`sort-${project.id}`} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`sort-item ${snapshot.isDragging ? 'dragging' : ''}`}
                            >
                              <span className="sort-item-handle" aria-hidden="true"><Icon name="grip" size={18} /></span>
                              <span className="sort-item-num">{index + 1}.</span>
                              <span className="sort-item-name">{project.name}</span>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </>
          ) : (
            <>
              <div className="section-header">
                <h2>{t('myProjects')}</h2>
                <div className="section-actions">
                  {myProjects.length > 1 && (
                    <button type="button" onClick={handleStartSort} className="btn-secondary"><Icon name="reorder" />{t('reorderBtn')}</button>
                  )}
                  <button type="button" onClick={() => setShowCreateModal(true)} className="btn-primary"><Icon name="plus" />{t('createProject')}</button>
                </div>
              </div>

              {/* Мои проекты */}
              {myProjects.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" aria-hidden="true"><Icon name="folder" size={26} /></div>
                  <p className="empty-state-title">{t('noProjects')}</p>
                  <p>{t('noProjectsHint')}</p>
                  <button type="button" onClick={() => setShowCreateModal(true)} className="btn-primary"><Icon name="plus" />{t('createProject')}</button>
                </div>
              ) : (
                <div className="projects-grid">
                  {myProjects.map((project) => (
                    <article key={project.id} className="project-card" onClick={() => navigate(`/project/${project.id}`)}>
                      <div className="project-card-header">
                        <h3><Link to={`/project/${project.id}`} className="project-card-link" onClick={(e) => e.stopPropagation()}>{project.name}</Link></h3>
                      </div>
                      {project.description && <p className="project-card-desc">{project.description}</p>}
                      <ProjectStats project={project} />
                      <div className="project-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => setEditProject(project)} className="btn-small" aria-label={t('editProjectAria', { name: project.name })}><Icon name="pencil" size={14} />{t('editShort')}</button>
                        <button type="button" onClick={() => handleDeleteProject(project)} className="btn-small btn-small-danger" aria-label={t('deleteProjectAria', { name: project.name })}><Icon name="trash" size={14} />{t('delete')}</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {/* Чужие проекты, к которым у меня есть доступ */}
              {byOwner.map(group => (
                <section key={group.ownerId} className="owner-group">
                  <h3 className="owner-group-title"><Avatar name={group.name} size="sm" aria-hidden="true" />{t('projectsOfOwner', { name: group.name })}</h3>
                  <p className="owner-group-hint">
                    {teamOwnerIds.has(group.ownerId) ? t('ownerGroupTeamHint') : t('ownerGroupInvitedHint')}
                  </p>
                  <div className="projects-grid">
                    {group.projects.map(project => (
                      <article key={project.id} className="project-card project-card-member" onClick={() => navigate(`/project/${project.id}`)}>
                        <div className="project-card-header">
                          <h3><Link to={`/project/${project.id}`} className="project-card-link" onClick={(e) => e.stopPropagation()}>{project.name}</Link></h3>
                        </div>
                        {project.description && <p className="project-card-desc">{project.description}</p>}
                        <ProjectStats project={project} />
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === 'mytasks' && (() => {
        const shownTasks = myTasksTab === 'active' ? activeTasks : doneTasks;
        return (
          <div className="mytasks-section view-enter">
            <p className="section-intro">{t('myTasksIntro')}</p>
            <div className="mytasks-subtabs">
              <button type="button" className={`subtab-btn ${myTasksTab === 'active' ? 'active' : ''}`} aria-pressed={myTasksTab === 'active'} onClick={() => setMyTasksTab('active')}>
                {t('myTasksActive')} <span className="count-badge">{activeTasks.length}</span>
              </button>
              <button type="button" className={`subtab-btn ${myTasksTab === 'done' ? 'active' : ''}`} aria-pressed={myTasksTab === 'done'} onClick={() => setMyTasksTab('done')}>
                {t('myTasksDone')} <span className="count-badge">{doneTasks.length}</span>
              </button>
            </div>
            {shownTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon" aria-hidden="true"><Icon name={myTasksTab === 'active' ? 'check-circle' : 'clock'} size={26} /></div>
                <p className="empty-state-title">{myTasksTab === 'active' ? t('noActiveTasks') : t('noDoneTasks')}</p>
                <p>{myTasksTab === 'active' ? t('noActiveTasksHint') : t('noDoneTasksHint')}</p>
              </div>
            ) : (
              <ul className="mytasks-list">
                {shownTasks.map(task => {
                  const deadlineClass = deadlineState(task);
                  return (
                    <li key={task.id}>
                      {/* Ссылка открывает проект сразу с этой задачей */}
                      <Link to={`/project/${task.project_id}?task=${task.id}`} className={`mytask-card ${deadlineClass} ${task.is_done ? 'done' : ''}`}>
                        <div className="mytask-header">
                          <span className="mytask-project"><Icon name="folder" size={13} /><span>{task.project_name}</span></span>
                          <span className={`mytask-status chip ${task.is_done ? 'chip-success' : ''}`}>{task.is_done && <Icon name="check" size={12} />}{task.status_name}</span>
                        </div>
                        <h3 className="mytask-title">{task.title}</h3>
                        {task.description && <p className="mytask-desc">{task.description}</p>}
                        <div className="mytask-footer">
                          {task.end_date ? (
                            <span className={`mytask-deadline chip ${DEADLINE_CHIP[deadlineClass] || ''}`}>
                              <Icon name={DEADLINE_ICON[deadlineClass] || 'calendar'} size={13} />
                              {t('taskDeadline')} {formatDate(task.end_date, lang)}
                              {deadlineClass === 'overdue' && ` · ${t('taskOverdue')}`}
                              {deadlineClass === 'due-soon' && ` · ${t('taskDueSoon')}`}
                            </span>
                          ) : (
                            <span className="mytask-no-deadline">{t('taskNoDeadline')}</span>
                          )}
                          {task.has_report && <span className="mytask-report-badge chip chip-report"><Icon name="file-check" size={13} />{t('reportSubmittedBadge')}</span>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}

      {activeTab === 'team' && (
        <div className="team-section view-enter">
          <h2>{t('myTeamTitle')}</h2>
          <p className="team-hint">{t('myTeamHint')}</p>
          <p className="team-hint">{t('myTeamVsProjectHint')}</p>
          <div className="team-add-form">
            <InviteForm
              onInvite={handleAddTeamMember}
              label={t('addMember')}
              hint={t('inviteMustBeRegisteredHint')}
              submitLabel={t('addMemberBtn')}
            />
          </div>
          {team.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true"><Icon name="users" size={26} /></div>
              <p className="empty-state-title">{t('teamEmpty')}</p>
              <p>{t('teamEmptyHint')}</p>
            </div>
          ) : (
            <ul className="team-list">
              {team.map(member => (
                <li key={member.id} className={`team-member-card ${member.status === 'pending' ? 'team-member-pending' : ''}`}>
                  <Avatar name={member.name} size="lg" muted={member.status === 'pending'} className="team-member-avatar" aria-hidden="true" />
                  <div className="team-member-info">
                    <span className="team-member-name">
                      {member.name}
                      {member.status === 'pending' && <span className="pending-badge chip chip-pending"><Icon name="clock" size={12} />{t('teamPending')}</span>}
                    </span>
                    <span className="team-member-email">{member.email}</span>
                  </div>
                  <button type="button" onClick={() => handleRemoveTeamMember(member)} className="btn-small btn-small-danger">
                    {member.status === 'pending' ? t('cancelInviteBtn') : t('removeFromTeamBtn')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {memberships.length > 0 && (
            <section className="team-memberships" aria-labelledby="team-memberships-title">
              <h2 id="team-memberships-title">{t('teamMembershipsTitle')}</h2>
              <p className="team-hint">{t('teamMembershipsHint')}</p>
              <ul className="team-list">
                {memberships.map(m => (
                  <li key={m.owner_id} className="team-member-card">
                    <Avatar name={m.owner_name} size="lg" className="team-member-avatar" aria-hidden="true" />
                    <div className="team-member-info">
                      <span className="team-member-name">{m.owner_name}</span>
                      <span className="team-member-email">{m.owner_email} · {t('teamProjectsCount', { count: m.projects_count })}</span>
                    </div>
                    <button type="button" onClick={() => handleLeaveTeam(m)} className="btn-small btn-small-danger">{t('leaveTeamBtn')}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      </main>

      {showCreateModal && (
        <ProjectFormModal onSubmit={handleCreateProject} onClose={() => setShowCreateModal(false)} />
      )}

      {editProject && (
        <ProjectFormModal project={editProject} onSubmit={handleSaveEdit} onClose={() => setEditProject(null)} />
      )}
    </div>
  );
}

export default Dashboard;
