import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useLanguage } from '../context/LanguageContext';
import AppHeader from './AppHeader';
import { formatDate, deadlineState } from '../utils/date';
import useEscape from '../utils/useEscape';
import {
  getProjects, createProject, updateProject, deleteProject,
  getPendingInvitations, respondToInvitation, reorderProjects, getMyTasks,
  getTeam, addTeamMember, removeTeamMember, getTeamInvitations, respondToTeamInvitation
} from '../services/api';
import './Dashboard.css';

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
          <span className="project-overdue">⚠️ {t('projectOverdue', { count: project.tasks_overdue })}</span>
        )}
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }) {
  const { t, lang } = useLanguage();
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [team, setTeam] = useState([]);
  const [teamInvitations, setTeamInvitations] = useState([]);
  const [activeTab, setActiveTab] = useState('projects');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState(false);
  const [sortedProjects, setSortedProjects] = useState([]);
  const [teamEmail, setTeamEmail] = useState('');
  const [teamError, setTeamError] = useState('');
  const [teamSuccess, setTeamSuccess] = useState('');
  const [teamLoading, setTeamLoading] = useState(false);
  const [myTasksTab, setMyTasksTab] = useState('active');
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  useEscape(() => { setShowCreateModal(false); setEditProject(null); }, showCreateModal || !!editProject);

  const loadData = async () => {
    try {
      const [projectsRes, invitationsRes, tasksRes, teamRes, teamInvRes] = await Promise.all([
        getProjects(), getPendingInvitations(), getMyTasks(), getTeam(), getTeamInvitations()
      ]);
      setProjects(projectsRes.data);
      setInvitations(invitationsRes.data);
      setMyTasks(tasksRes.data);
      setTeam(teamRes.data);
      setTeamInvitations(teamInvRes.data);
    } catch (error) {
      console.error('Ошибка загрузки данных:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    try {
      await createProject(newProject);
      setShowCreateModal(false);
      setNewProject({ name: '', description: '' });
      loadData();
    } catch (error) {
      alert(error.response?.data?.error || t('projectCreateError'));
    }
  };

  const handleEditProject = (project, e) => {
    e.stopPropagation();
    setEditProject(project);
    setEditForm({ name: project.name, description: project.description || '' });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await updateProject(editProject.id, editForm);
      setEditProject(null);
      loadData();
    } catch (error) {
      alert(error.response?.data?.error || t('projectUpdateError'));
    }
  };

  const handleDeleteProject = async (projectId, projectName, e) => {
    e.stopPropagation();
    if (!window.confirm(t('deleteProjectPrompt', { name: projectName }))) return;
    try {
      await deleteProject(projectId);
      loadData();
    } catch (error) {
      alert(error.response?.data?.error || t('projectDeleteError'));
    }
  };

  const handleInvitationResponse = async (projectId, action) => {
    try {
      await respondToInvitation(projectId, action);
      loadData();
    } catch (error) {
      console.error('Ошибка ответа на приглашение:', error);
    }
  };

  const handleTeamInvitationResponse = async (ownerId, action) => {
    try {
      await respondToTeamInvitation(ownerId, action);
      loadData();
    } catch (error) {
      console.error('Ошибка ответа на приглашение в команду:', error);
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
    try {
      await reorderProjects(sortedProjects.map(p => p.id));
      setSortMode(false);
      loadData();
    } catch (error) {
      console.error('Ошибка сохранения порядка:', error);
    }
  };

  const handleAddTeamMember = async (e) => {
    e.preventDefault();
    setTeamError(''); setTeamSuccess(''); setTeamLoading(true);
    try {
      const res = await addTeamMember(teamEmail);
      setTeamSuccess(t('teamInviteSent', { name: res.data.member.name }));
      setTeamEmail('');
      loadData();
    } catch (error) {
      setTeamError(error.response?.data?.error || t('teamAddError'));
    } finally {
      setTeamLoading(false);
    }
  };

  const handleRemoveTeamMember = async (memberId, memberName) => {
    if (!window.confirm(`${memberName} — ${t('removeFromTeamConfirm')}`)) return;
    try {
      await removeTeamMember(memberId);
      loadData();
    } catch (error) {
      alert(error.response?.data?.error || t('teamRemoveError'));
    }
  };

  if (loading) return <div className="loading">{t('loading')}</div>;

  const myProjects = projects.filter(p => p.owner_id === user?.id);
  const memberProjects = projects.filter(p => p.owner_id !== user?.id);
  const activeTasks = myTasks.filter(task => !task.is_done);
  const doneTasks = myTasks.filter(task => task.is_done);
  const overdueCount = activeTasks.filter(task => deadlineState(task) === 'overdue').length;

  // Проекты команды — группируем по владельцу, сохраняя порядок владельца
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
        <div className="invitations-section">
          <h2>{t('projectInvitationsTitle')}</h2>
          <div className="invitations-list">
            {invitations.map(inv => (
              <div key={inv.id} className="invitation-card">
                <div className="invitation-body">
                  <h3>{inv.name}</h3>
                  <p>{t('inviteFrom')} {inv.owner_name}</p>
                  {inv.description && <p className="invitation-desc">{inv.description}</p>}
                </div>
                <div className="invitation-actions">
                  <button onClick={() => handleInvitationResponse(inv.id, 'approve')} className="btn-success">{t('inviteAccept')}</button>
                  <button onClick={() => handleInvitationResponse(inv.id, 'reject')} className="btn-danger">{t('inviteReject')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Приглашения в команду */}
      {teamInvitations.length > 0 && (
        <div className="invitations-section">
          <h2>{t('teamInvitationsTitle')}</h2>
          <div className="invitations-list">
            {teamInvitations.map(inv => (
              <div key={inv.owner_id} className="invitation-card team-invitation-card">
                <div className="invitation-body">
                  <h3>👥 {inv.owner_name} {t('teamInviteText')}</h3>
                  <p>{t('teamInviteHint')} {inv.owner_name}</p>
                </div>
                <div className="invitation-actions">
                  <button onClick={() => handleTeamInvitationResponse(inv.owner_id, 'approve')} className="btn-success">{t('inviteAccept')}</button>
                  <button onClick={() => handleTeamInvitationResponse(inv.owner_id, 'reject')} className="btn-danger">{t('inviteReject')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-tabs">
        <button className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>
          {t('tabProjects')}
        </button>
        <button className={`tab-btn ${activeTab === 'mytasks' ? 'active' : ''}`} onClick={() => setActiveTab('mytasks')}>
          {t('tabMyTasks')}
          {overdueCount > 0 && <span className="badge-count">{overdueCount}</span>}
        </button>
        <button className={`tab-btn ${activeTab === 'team' ? 'active' : ''}`} onClick={() => setActiveTab('team')}>
          {t('tabTeam')}
          {team.length > 0 && <span className="badge-team">{team.length}</span>}
        </button>
      </div>

      {activeTab === 'projects' && (
        <div className="projects-section">
          {sortMode ? (
            <>
              <div className="section-header">
                <h2>{t('reorderTitle')}</h2>
                <div className="section-actions">
                  <button onClick={() => setSortMode(false)} className="btn-secondary">{t('cancelOrder')}</button>
                  <button onClick={handleSaveSort} className="btn-primary">{t('saveOrderBtn')}</button>
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
                              <span className="sort-item-handle">⠿</span>
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
                    <button onClick={handleStartSort} className="btn-secondary">{t('reorderBtn')}</button>
                  )}
                  <button onClick={() => setShowCreateModal(true)} className="btn-primary">{t('createProject')}</button>
                </div>
              </div>

              {/* Мои проекты */}
              {myProjects.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📁</div>
                  <p className="empty-state-title">{t('noProjects')}</p>
                  <p>{t('noProjectsHint')}</p>
                  <button onClick={() => setShowCreateModal(true)} className="btn-primary">{t('createProject')}</button>
                </div>
              ) : (
                <div className="projects-grid">
                  {myProjects.map((project) => (
                    <div key={project.id} className="project-card" onClick={() => navigate(`/project/${project.id}`)}>
                      <div className="project-card-header">
                        <h3>{project.name}</h3>
                        <div className="project-card-actions">
                          <button onClick={(e) => handleEditProject(project, e)} className="btn-icon-sm" title={t('edit')}>✏️</button>
                          <button onClick={(e) => handleDeleteProject(project.id, project.name, e)} className="btn-icon-sm btn-danger-sm" title={t('delete')}>🗑️</button>
                        </div>
                      </div>
                      {project.description && <p className="project-card-desc">{project.description}</p>}
                      <ProjectStats project={project} />
                    </div>
                  ))}
                </div>
              )}

              {/* Проекты команды */}
              {byOwner.map(group => (
                <div key={group.ownerId} className="owner-group">
                  <h3 className="owner-group-title">👥 {t('projectsOf')} {group.name}</h3>
                  <div className="projects-grid">
                    {group.projects.map(project => (
                      <div key={project.id} className="project-card project-card-member" onClick={() => navigate(`/project/${project.id}`)}>
                        <div className="project-card-header">
                          <h3>{project.name}</h3>
                        </div>
                        {project.description && <p className="project-card-desc">{project.description}</p>}
                        <ProjectStats project={project} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === 'mytasks' && (() => {
        const shownTasks = myTasksTab === 'active' ? activeTasks : doneTasks;
        return (
          <div className="mytasks-section">
            <div className="mytasks-subtabs">
              <button className={`subtab-btn ${myTasksTab === 'active' ? 'active' : ''}`} onClick={() => setMyTasksTab('active')}>
                {t('myTasksActive')} {overdueCount > 0 && <span className="badge-count">{overdueCount}</span>}
              </button>
              <button className={`subtab-btn ${myTasksTab === 'done' ? 'active' : ''}`} onClick={() => setMyTasksTab('done')}>
                {t('myTasksDone')} {doneTasks.length > 0 && <span className="badge-done">{doneTasks.length}</span>}
              </button>
            </div>
            {shownTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">{myTasksTab === 'active' ? '🎉' : '📋'}</div>
                <p className="empty-state-title">{myTasksTab === 'active' ? t('noActiveTasks') : t('noDoneTasks')}</p>
              </div>
            ) : (
              <div className="mytasks-list">
                {shownTasks.map(task => {
                  const deadlineClass = deadlineState(task);
                  return (
                    <div key={task.id} className={`mytask-card ${deadlineClass} ${task.is_done ? 'done' : ''}`} onClick={() => navigate(`/project/${task.project_id}`)}>
                      <div className="mytask-header">
                        <span className="mytask-project">{task.project_name}</span>
                        <span className={`mytask-status ${task.is_done ? 'done-status' : ''}`}>{task.status_name}</span>
                      </div>
                      <h3 className="mytask-title">{task.title}</h3>
                      {task.description && <p className="mytask-desc">{task.description}</p>}
                      <div className="mytask-footer">
                        {task.end_date && (
                          <span className={`mytask-deadline ${deadlineClass}`}>
                            📅 {t('taskDeadline')} {formatDate(task.end_date, lang)}
                            {deadlineClass === 'overdue' && ` ⚠️ ${t('taskOverdue')}`}
                            {deadlineClass === 'due-soon' && ` ⏰ ${t('taskDueSoon')}`}
                          </span>
                        )}
                        {task.has_report && <span className="mytask-report-badge">{t('reportSubmittedBadge')}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {activeTab === 'team' && (
        <div className="team-section">
          <h2>{t('myTeamTitle')}</h2>
          <p className="team-hint">{t('myTeamHint')}</p>
          <div className="team-add-form">
            <h3>{t('addMember')}</h3>
            <form onSubmit={handleAddTeamMember} className="team-invite-row">
              <input
                type="email"
                placeholder={t('addMemberEmail')}
                value={teamEmail}
                onChange={(e) => { setTeamEmail(e.target.value); setTeamError(''); setTeamSuccess(''); }}
                required
                className="team-email-input"
              />
              <button type="submit" className="btn-primary" disabled={teamLoading}>
                {teamLoading ? t('addMemberLoading') : t('addMemberBtn')}
              </button>
            </form>
            {teamError && <p className="team-error">{teamError}</p>}
            {teamSuccess && <p className="team-success">✅ {teamSuccess}</p>}
          </div>
          <div className="team-list">
            {team.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">👥</div>
                <p className="empty-state-title">{t('teamEmpty')}</p>
              </div>
            ) : (
              team.map(member => (
                <div key={member.id} className={`team-member-card ${member.status === 'pending' ? 'team-member-pending' : ''}`}>
                  <div className="team-member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                  <div className="team-member-info">
                    <span className="team-member-name">
                      {member.name}
                      {member.status === 'pending' && <span className="pending-badge">{t('teamPending')}</span>}
                    </span>
                    <span className="team-member-email">{member.email}</span>
                  </div>
                  {member.status === 'approved' && (
                    <button onClick={() => handleRemoveTeamMember(member.id, member.name)} className="btn-icon-sm btn-danger-sm" title={t('removeFromTeamTitle')}>🗑️</button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      </main>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('createProjectTitle')}</h2>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label>{t('projectNameLabel')}</label>
                <input type="text" autoFocus value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} required placeholder={t('projectNamePlaceholder')} />
              </div>
              <div className="form-group">
                <label>{t('projectDescLabel')}</label>
                <textarea value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} placeholder={t('projectDescPlaceholder')} rows="3" />
              </div>
              <div className="modal-actions">
                <div className="modal-actions-right">
                  <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">{t('cancel')}</button>
                  <button type="submit" className="btn-primary">{t('create')}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {editProject && (
        <div className="modal-overlay" onClick={() => setEditProject(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('editProjectTitle')}</h2>
            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label>{t('projectNameLabel')}</label>
                <input type="text" autoFocus value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>{t('projectDescLabel')}</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows="3" />
              </div>
              <div className="modal-actions">
                <div className="modal-actions-right">
                  <button type="button" onClick={() => setEditProject(null)} className="btn-secondary">{t('cancel')}</button>
                  <button type="submit" className="btn-primary">{t('save')}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
