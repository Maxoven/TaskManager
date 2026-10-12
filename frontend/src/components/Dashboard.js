import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { useTeams, SHARED, canManageRole } from '../context/TeamContext';
import { ROLE_LABEL_KEYS } from './TeamSwitcher';
import AppHeader from './AppHeader';
import Modal from './Modal';
import TeamSettings from './TeamSettings';
import Workload from './Workload';
import ProjectAccessPicker, { newProjectAccess, accessPayload } from './ProjectAccessPicker';
import Icon from './Icon';
import Avatar from './Avatar';
import { DashboardSkeleton } from './Skeleton';
import { formatDate, deadlineState, DEADLINE_CHIP, DEADLINE_ICON } from '../utils/date';
import apiError from '../utils/apiError';
import {
  getProjects, createProject, updateProject, deleteProject,
  getPendingInvitations, respondToInvitation, reorderProjects, getMyTasks,
  respondToTeamInvitation, getTeamDetails
} from '../services/api';
import './Dashboard.css';

const TABS = ['projects', 'mytasks', 'workload', 'team'];

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

// Форма проекта — одна для создания и редактирования.
// При создании ещё и «Кто видит проект»: по умолчанию только отмеченные люди команды.
function ProjectFormModal({ project, onSubmit, onClose, teamName, teamId, userId }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ name: project?.name || '', description: project?.description || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [roster, setRoster] = useState(null);
  const [access, setAccess] = useState(() => newProjectAccess(userId));

  useEffect(() => {
    if (project || !teamId) return;
    getTeamDetails(teamId)
      .then(({ data }) => setRoster(data.members.filter(m => m.status === 'approved')))
      .catch(() => setRoster([]));
  }, [project, teamId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await onSubmit(project ? form : { ...form, ...accessPayload(access) });
    } catch (err) {
      setError(apiError(err, t, project ? 'projectUpdateError' : 'projectCreateError'));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={project ? t('editProjectTitle') : t('createProjectTitle')}
      description={project ? undefined : t('createProjectIntro', { team: teamName || '' })}
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
        {project && <p className="field-hint edit-access-hint"><Icon name="lock" size={13} /> {t('editAccessWhereHint')}</p>}
        {!project && (roster
          ? <ProjectAccessPicker roster={roster} selfId={userId} value={access} onChange={setAccess} />
          : <p className="hint-text">{t('loading')}</p>)}
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

// Карточка проекта; кнопки «Изменить» и «Удалить» — только тем, кто ведёт проекты команды
function ProjectCard({ project, canManage, onEdit, onDelete }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  return (
    <article className={`project-card ${canManage ? '' : 'project-card-member'}`} onClick={() => navigate(`/project/${project.id}`)}>
      <div className="project-card-header">
        <h3><Link to={`/project/${project.id}`} className="project-card-link" onClick={(e) => e.stopPropagation()}>{project.name}</Link></h3>
      </div>
      {project.description && <p className="project-card-desc">{project.description}</p>}
      {project.visibility === 'selected' && project.my_role !== 'guest' && (
        <p className="project-card-access" title={t('accessSelectedChipTitle')}>
          <Icon name="lock" size={13} />{t('accessCountChip', { count: project.access_count, total: project.team_size })}
        </p>
      )}
      <ProjectStats project={project} />
      {canManage && (
        <div className="project-card-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onEdit(project)} className="btn-small" aria-label={t('editProjectAria', { name: project.name })}><Icon name="pencil" size={14} />{t('editShort')}</button>
          <button type="button" onClick={() => onDelete(project)} className="btn-small btn-small-danger" aria-label={t('deleteProjectAria', { name: project.name })}><Icon name="trash" size={14} />{t('delete')}</button>
        </div>
      )}
    </article>
  );
}

function Dashboard({ user, onLogout }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const { invitations: teamInvitations, sharedCount, current, currentTeam, selectTeam, refresh: refreshTeams, loaded: teamsLoaded } = useTeams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
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

  const isShared = current === SHARED;
  const myRole = currentTeam?.role;
  const canManage = canManageRole(myRole);

  // Вкладка хранится в адресе (?tab=team), чтобы на неё можно было сослаться и вернуться кнопкой «Назад».
  // В разделе «Отдельные проекты» команды нет — и вкладки «Команда» тоже.
  const tabs = isShared ? TABS.filter(tab => tab !== 'team' && tab !== 'workload') : TABS;
  const tabParam = searchParams.get('tab');
  const activeTab = tabs.includes(tabParam) ? tabParam : 'projects';
  const setActiveTab = (tab) => setSearchParams(tab === 'projects' ? {} : { tab });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, []);
  // Сменили команду — выходим из режима сортировки, он относится к прежнему списку
  useEffect(() => { setSortMode(false); }, [current]);

  const loadData = async () => {
    try {
      const [projectsRes, invitationsRes, tasksRes] = await Promise.all([
        getProjects(), getPendingInvitations(), getMyTasks()
      ]);
      setProjects(projectsRes.data);
      setInvitations(invitationsRes.data);
      setMyTasks(tasksRes.data);
      setLoadError('');
    } catch (error) {
      // Раньше при ошибке показывалась пустая страница «у вас нет проектов» — теперь говорим как есть
      setLoadError(apiError(error, t, 'dashboardLoadError'));
    } finally {
      setLoading(false);
    }
  };

  // После изменений в командах обновляем и список команд в шапке, и проекты
  const reloadAll = async () => {
    await Promise.all([loadData(), refreshTeams().catch(() => {})]);
  };

  const retryLoad = () => { setLoading(true); loadData(); };

  const handleCreateProject = async (form) => {
    const response = await createProject({ ...form, teamId: current });
    setShowCreateModal(false);
    notify.success(t('projectCreatedToast', { name: response.data.name }));
    refreshTeams().catch(() => {});
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
      reloadAll();
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
      await reloadAll();
    } catch (error) {
      notify.error(apiError(error, t, 'inviteRespondError'));
    } finally {
      setBusyKey('');
    }
  };

  const handleTeamInvitationResponse = async (inv, action) => {
    setBusyKey(`team-inv-${inv.team_id}`);
    try {
      await respondToTeamInvitation(inv.team_id, action);
      await reloadAll();
      if (action === 'approve') {
        // Сразу показываем команду, в которую человек вступил
        selectTeam(inv.team_id);
        notify.success(t('teamJoinedToast', { name: inv.team_name }));
      } else {
        notify.success(t('inviteDeclinedToast'));
      }
    } catch (error) {
      notify.error(apiError(error, t, 'inviteRespondError'));
    } finally {
      setBusyKey('');
    }
  };

  // Проекты и задачи выбранной команды (или отдельные проекты с гостевым доступом)
  const scopeProjects = projects.filter(p => (isShared ? p.my_role === 'guest' : p.team_id === current && p.my_role !== 'guest'));
  const scopeIds = new Set(scopeProjects.map(p => p.id));
  const scopeTasks = myTasks.filter(task => scopeIds.has(task.project_id));

  const handleStartSort = () => {
    setSortedProjects(scopeProjects);
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

  if (loading || !teamsLoaded) {
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

  const activeTasks = scopeTasks.filter(task => !task.is_done);
  const doneTasks = scopeTasks.filter(task => task.is_done);
  const overdueCount = activeTasks.filter(task => deadlineState(task) === 'overdue').length;

  // Гостевые проекты группируем по команде, которой они принадлежат
  const sharedGroups = [];
  if (isShared) {
    scopeProjects.forEach(p => {
      let group = sharedGroups.find(g => g.teamId === p.team_id);
      if (!group) { group = { teamId: p.team_id, name: p.team_name, projects: [] }; sharedGroups.push(group); }
      group.projects.push(p);
    });
  }

  const openCreate = () => setShowCreateModal(true);

  return (
    <div className="dashboard">
      <AppHeader user={user} onLogout={onLogout} />
      <main className="dashboard-main">
      <div className="dashboard-greeting">
        <h1>{t('hi')}, {user?.name}!</h1>
        <p>{t('dashboardSubtitle', { active: activeTasks.length, overdue: overdueCount })}</p>
      </div>

      {/* Где я сейчас и что мне здесь можно — чтобы скрытые кнопки не удивляли */}
      {isShared ? (
        <p className="team-context">
          <span className="team-context-icon" aria-hidden="true"><Icon name="folder" size={16} /></span>
          <span>{t('sharedContext')}</span>
        </p>
      ) : currentTeam && (
        <p className="team-context">
          <Avatar name={currentTeam.name} size="sm" square aria-hidden="true" />
          <span>
            {t('teamContextBefore')} <strong className="team-context-name">{t('quotedName', { name: currentTeam.name })}</strong>:{' '}
            <strong className={`role-chip role-chip-${myRole}`}>{t(ROLE_LABEL_KEYS[myRole])}</strong>
            {' — '}{t(`roleShort_${myRole}`)}
          </span>
        </p>
      )}

      {/* Приглашения в команды */}
      {teamInvitations.length > 0 && (
        <section className="invitations-section" aria-labelledby="team-invitations-title">
          <h2 id="team-invitations-title">{t('teamInvitationsTitle')}</h2>
          <div className="invitations-list">
            {teamInvitations.map(inv => (
              <div key={inv.team_id} className="invitation-card team-invitation-card">
                <Avatar name={inv.team_name} size="lg" square className="invitation-avatar" aria-hidden="true" />
                <div className="invitation-body">
                  <h3>{t('teamInviteHeading', { team: inv.team_name })}</h3>
                  <p>
                    {t('teamInviteFrom', { name: inv.inviter_name || '—' })}{' '}
                    <strong className={`role-chip role-chip-${inv.role}`}>{t(ROLE_LABEL_KEYS[inv.role])}</strong>
                  </p>
                  <p className="invitation-desc">{t(`roleInvite_${inv.role}`)}</p>
                </div>
                <div className="invitation-actions">
                  <button type="button" disabled={busyKey === `team-inv-${inv.team_id}`} onClick={() => handleTeamInvitationResponse(inv, 'approve')} className="btn-primary">{t('inviteAccept')}</button>
                  <button type="button" disabled={busyKey === `team-inv-${inv.team_id}`} onClick={() => handleTeamInvitationResponse(inv, 'reject')} className="btn-secondary">{t('inviteReject')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Приглашения в отдельные проекты */}
      {invitations.length > 0 && (
        <section className="invitations-section" aria-labelledby="project-invitations-title">
          <h2 id="project-invitations-title">{t('projectInvitationsTitle')}</h2>
          <div className="invitations-list">
            {invitations.map(inv => (
              <div key={inv.id} className="invitation-card">
                <span className="invitation-icon" aria-hidden="true"><Icon name="folder" size={20} /></span>
                <div className="invitation-body">
                  <h3>{inv.name}</h3>
                  <p>{t('projectInviteText', { name: inv.owner_name, team: inv.team_name || '' })}</p>
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
        {!isShared && (
          <button type="button" className={`tab-btn segmented-btn ${activeTab === 'workload' ? 'active' : ''}`} aria-current={activeTab === 'workload' ? 'page' : undefined} onClick={() => setActiveTab('workload')}>
            <Icon name="clock" />
            <span className="tab-label-full">{t('tabWorkload')}</span>
            <span className="tab-label-short" aria-hidden="true">{t('tabWorkloadShort')}</span>
          </button>
        )}
        {!isShared && (
          <button type="button" className={`tab-btn segmented-btn ${activeTab === 'team' ? 'active' : ''}`} aria-current={activeTab === 'team' ? 'page' : undefined} onClick={() => setActiveTab('team')}>
            <Icon name="users" />
            {t('tabTeam')}
            {currentTeam?.members_count > 0 && <span className="count-badge" title={t('teamBadgeTitle')}>{currentTeam.members_count}</span>}
          </button>
        )}
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
          ) : isShared ? (
            <>
              <div className="section-header">
                <h2>{t('sharedProjectsTitle')}</h2>
              </div>
              {sharedGroups.map(group => (
                <section key={group.teamId} className="owner-group">
                  <h3 className="owner-group-title"><Avatar name={group.name} size="sm" square aria-hidden="true" />{t('sharedGroupTitle', { team: group.name })}</h3>
                  <div className="projects-grid">
                    {group.projects.map(project => <ProjectCard key={project.id} project={project} canManage={false} />)}
                  </div>
                </section>
              ))}
            </>
          ) : (
            <>
              <div className="section-header">
                <h2>{t('teamProjectsTitle')}</h2>
                {canManage && scopeProjects.length > 0 && (
                  <div className="section-actions">
                    {scopeProjects.length > 1 && (
                      <button type="button" onClick={handleStartSort} className="btn-secondary"><Icon name="reorder" />{t('reorderBtn')}</button>
                    )}
                    <button type="button" onClick={openCreate} className="btn-primary"><Icon name="plus" />{t('createProject')}</button>
                  </div>
                )}
              </div>
              {myRole !== 'owner' && (
                <p className="role-note">
                  <Icon name="info" size={16} />
                  <span>{t(myRole === 'admin' ? 'adminProjectsNote' : 'memberProjectsNote', { name: currentTeam?.owner_name || t('roleOwner') })}</span>
                </p>
              )}

              {scopeProjects.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" aria-hidden="true"><Icon name="folder" size={26} /></div>
                  <p className="empty-state-title">{t('noTeamProjects')}</p>
                  <p>{canManage ? t('noProjectsHint') : t('noTeamProjectsMemberHint')}</p>
                  {canManage && <button type="button" onClick={openCreate} className="btn-primary"><Icon name="plus" />{t('createProject')}</button>}
                  {sharedCount > 0 && (
                    <p className="empty-state-extra">
                      {t('sharedProjectsWaiting', { count: sharedCount })}{' '}
                      <button type="button" className="btn-link" onClick={() => selectTeam(SHARED)}>{t('openSharedProjects')}</button>
                    </p>
                  )}
                </div>
              ) : (
                <div className="projects-grid">
                  {scopeProjects.map(project => (
                    <ProjectCard key={project.id} project={project} canManage={canManage} onEdit={setEditProject} onDelete={handleDeleteProject} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'mytasks' && (() => {
        const shownTasks = myTasksTab === 'active' ? activeTasks : doneTasks;
        return (
          <div className="mytasks-section view-enter">
            <p className="section-intro">{isShared ? t('myTasksIntroShared') : t('myTasksIntroTeam', { team: currentTeam?.name || '' })}</p>
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

      {activeTab === 'workload' && currentTeam && (
        <Workload key={currentTeam.id} team={currentTeam} />
      )}

      {activeTab === 'team' && currentTeam && (
        <TeamSettings key={currentTeam.id} teamId={currentTeam.id} user={user} onChanged={reloadAll} />
      )}

      </main>

      {showCreateModal && (
        <ProjectFormModal onSubmit={handleCreateProject} onClose={() => setShowCreateModal(false)} teamName={currentTeam?.name} teamId={currentTeam?.id} userId={user?.id} />
      )}

      {editProject && (
        <ProjectFormModal project={editProject} onSubmit={handleSaveEdit} onClose={() => setEditProject(null)} />
      )}
    </div>
  );
}

export default Dashboard;
