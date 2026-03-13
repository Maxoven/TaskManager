import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import {
  getProjects, createProject, updateProject, deleteProject,
  getPendingInvitations, respondToInvitation, reorderProjects, getMyTasks,
  getTeam, addTeamMember, removeTeamMember
} from '../services/api';
import './Dashboard.css';

function Dashboard({ user, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [team, setTeam] = useState([]);
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
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [projectsRes, invitationsRes, tasksRes, teamRes] = await Promise.all([
        getProjects(), getPendingInvitations(), getMyTasks(), getTeam()
      ]);
      setProjects(projectsRes.data);
      setInvitations(invitationsRes.data);
      setMyTasks(tasksRes.data);
      setTeam(teamRes.data);
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
      console.error('Ошибка создания проекта:', error);
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
      alert(error.response?.data?.error || 'Ошибка обновления проекта');
    }
  };

  const handleDeleteProject = async (projectId, projectName, e) => {
    e.stopPropagation();
    if (!window.confirm(`Удалить проект "${projectName}"? Это действие нельзя отменить.`)) return;
    try {
      await deleteProject(projectId);
      loadData();
    } catch (error) {
      alert(error.response?.data?.error || 'Ошибка удаления проекта');
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

  const handleStartSort = () => {
    setSortedProjects([...projects]);
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
      setProjects(sortedProjects);
      setSortMode(false);
    } catch (error) {
      console.error('Ошибка сохранения порядка:', error);
    }
  };

  const handleAddTeamMember = async (e) => {
    e.preventDefault();
    setTeamError(''); setTeamSuccess(''); setTeamLoading(true);
    try {
      const res = await addTeamMember(teamEmail);
      setTeamSuccess(`${res.data.member.name} добавлен в команду`);
      setTeamEmail('');
      loadData();
    } catch (error) {
      setTeamError(error.response?.data?.error || 'Ошибка добавления');
    } finally {
      setTeamLoading(false);
    }
  };

  const handleRemoveTeamMember = async (memberId, memberName) => {
    if (!window.confirm(`Удалить ${memberName} из команды? Он потеряет доступ ко всем вашим проектам.`)) return;
    try {
      await removeTeamMember(memberId);
      loadData();
    } catch (error) {
      alert('Ошибка удаления участника');
    }
  };

  const getTaskDeadlineClass = (task) => {
    if (!task.end_date) return '';
    const diff = (new Date(task.end_date) - new Date()) / (1000 * 60 * 60 * 24);
    if (diff < 0) return 'overdue';
    if (diff <= 3) return 'due-soon';
    return '';
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Task Manager</h1>
        <div className="user-info">
          <span>Привет, {user?.name}!</span>
          <button onClick={onLogout} className="btn-secondary">Выйти</button>
        </div>
      </header>

      {invitations.length > 0 && (
        <div className="invitations-section">
          <h2>Приглашения</h2>
          <div className="invitations-list">
            {invitations.map(inv => (
              <div key={inv.id} className="invitation-card">
                <div>
                  <h3>{inv.name}</h3>
                  <p>От: {inv.owner_name}</p>
                  <p className="invitation-desc">{inv.description}</p>
                </div>
                <div className="invitation-actions">
                  <button onClick={() => handleInvitationResponse(inv.id, 'approve')} className="btn-success">Принять</button>
                  <button onClick={() => handleInvitationResponse(inv.id, 'reject')} className="btn-danger">Отклонить</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-tabs">
        <button className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>
          📁 Проекты
        </button>
        <button className={`tab-btn ${activeTab === 'mytasks' ? 'active' : ''}`} onClick={() => setActiveTab('mytasks')}>
          ✅ Мои задачи
          {myTasks.filter(t => getTaskDeadlineClass(t) === 'overdue').length > 0 && (
            <span className="badge-count">{myTasks.filter(t => getTaskDeadlineClass(t) === 'overdue').length}</span>
          )}
        </button>
        <button className={`tab-btn ${activeTab === 'team' ? 'active' : ''}`} onClick={() => setActiveTab('team')}>
          👥 Команда
          {team.length > 0 && <span className="badge-team">{team.length}</span>}
        </button>
      </div>

      {activeTab === 'projects' && (
        <div className="projects-section">
          {sortMode ? (
            <>
              <div className="section-header">
                <h2>Изменение порядка проектов</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setSortMode(false)} className="btn-secondary">Отмена</button>
                  <button onClick={handleSaveSort} className="btn-primary">💾 Сохранить порядок</button>
                </div>
              </div>
              <p className="hint-text">Перетащите проекты в нужном порядке</p>
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
                <h2>Мои проекты</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  {projects.length > 1 && (
                    <button onClick={handleStartSort} className="btn-secondary">⇅ Упорядочить</button>
                  )}
                  <button onClick={() => setShowCreateModal(true)} className="btn-primary">+ Создать проект</button>
                </div>
              </div>
              {projects.length === 0 ? (
                <div className="empty-state">
                  <p>У вас пока нет проектов</p>
                  <p>Создайте первый проект, чтобы начать работу</p>
                </div>
              ) : (
                <div className="projects-grid">
                  {projects.map((project) => (
                    <div key={project.id} className="project-card" onClick={() => navigate(`/project/${project.id}`)}>
                      <div className="project-card-header">
                        <h3>{project.name}</h3>
                        {project.role === 'owner' && (
                          <div className="project-card-actions">
                            <button onClick={(e) => handleEditProject(project, e)} className="btn-icon-sm" title="Редактировать">✏️</button>
                            <button onClick={(e) => handleDeleteProject(project.id, project.name, e)} className="btn-icon-sm btn-danger-sm" title="Удалить">🗑️</button>
                          </div>
                        )}
                      </div>
                      <p>{project.description}</p>
                      <div className="project-meta">
                        <span className={`role-badge ${project.role}`}>
                          {project.role === 'owner' ? 'Владелец' : 'Участник'}
                        </span>
                        <span className="project-owner">{project.owner_name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'mytasks' && (
        <div className="mytasks-section">
          <h2>Мои задачи</h2>
          {myTasks.length === 0 ? (
            <div className="empty-state"><p>Нет задач назначенных вам</p></div>
          ) : (
            <div className="mytasks-list">
              {myTasks.map(task => {
                const deadlineClass = getTaskDeadlineClass(task);
                return (
                  <div key={task.id} className={`mytask-card ${deadlineClass}`} onClick={() => navigate(`/project/${task.project_id}`)}>
                    <div className="mytask-header">
                      <span className="mytask-project">{task.project_name}</span>
                      <span className="mytask-status">{task.status_name}</span>
                    </div>
                    <h3 className="mytask-title">{task.title}</h3>
                    {task.description && <p className="mytask-desc">{task.description}</p>}
                    <div className="mytask-footer">
                      {task.end_date && (
                        <span className={`mytask-deadline ${deadlineClass}`}>
                          📅 Дедлайн: {new Date(task.end_date).toLocaleDateString('ru-RU')}
                          {deadlineClass === 'overdue' && ' ⚠️ Просрочено'}
                          {deadlineClass === 'due-soon' && ' ⏰ Скоро'}
                        </span>
                      )}
                      {task.has_report && <span className="mytask-report-badge">✅ Отчёт сдан</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="team-section">
          <h2>Моя команда</h2>
          <p className="team-hint">Участники команды автоматически получают доступ ко всем вашим проектам.</p>
          <div className="team-add-form">
            <h3>Добавить участника</h3>
            <form onSubmit={handleAddTeamMember} className="team-invite-row">
              <input
                type="email"
                placeholder="Email пользователя"
                value={teamEmail}
                onChange={(e) => { setTeamEmail(e.target.value); setTeamError(''); setTeamSuccess(''); }}
                required
                className="team-email-input"
              />
              <button type="submit" className="btn-primary" disabled={teamLoading}>
                {teamLoading ? 'Добавление...' : '+ Добавить'}
              </button>
            </form>
            {teamError && <p className="team-error">{teamError}</p>}
            {teamSuccess && <p className="team-success">✅ {teamSuccess}</p>}
          </div>
          <div className="team-list">
            {team.length === 0 ? (
              <div className="empty-state"><p>В команде пока никого нет</p></div>
            ) : (
              team.map(member => (
                <div key={member.id} className="team-member-card">
                  <div className="team-member-avatar">{member.name.charAt(0).toUpperCase()}</div>
                  <div className="team-member-info">
                    <span className="team-member-name">{member.name}</span>
                    <span className="team-member-email">{member.email}</span>
                  </div>
                  <button onClick={() => handleRemoveTeamMember(member.id, member.name)} className="btn-icon-sm btn-danger-sm" title="Удалить из команды">🗑️</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Создать новый проект</h2>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label>Название проекта</label>
                <input type="text" value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} required placeholder="Название" />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <textarea value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} placeholder="Краткое описание" rows="3" />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">Отмена</button>
                <button type="submit" className="btn-primary">Создать</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editProject && (
        <div className="modal-overlay" onClick={() => setEditProject(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Редактировать проект</h2>
            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label>Название проекта</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows="3" />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setEditProject(null)} className="btn-secondary">Отмена</button>
                <button type="submit" className="btn-primary">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
