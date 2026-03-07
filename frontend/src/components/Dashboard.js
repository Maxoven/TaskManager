import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import {
  getProjects, createProject, updateProject, deleteProject,
  getPendingInvitations, respondToInvitation, reorderProjects, getMyTasks
} from '../services/api';
import './Dashboard.css';

function Dashboard({ user, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [activeTab, setActiveTab] = useState('projects'); // 'projects' | 'mytasks'
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editProject, setEditProject] = useState(null); // проект для редактирования
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [projectsRes, invitationsRes, tasksRes] = await Promise.all([
        getProjects(),
        getPendingInvitations(),
        getMyTasks()
      ]);
      setProjects(projectsRes.data);
      setInvitations(invitationsRes.data);
      setMyTasks(tasksRes.data);
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

  // Drag-and-drop сортировка проектов
  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const items = Array.from(projects);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setProjects(items); // оптимистичное обновление
    try {
      await reorderProjects(items.map(p => p.id));
    } catch (error) {
      console.error('Ошибка изменения порядка:', error);
      loadData(); // откат
    }
  };

  const getTaskDeadlineClass = (task) => {
    if (!task.end_date) return '';
    const now = new Date();
    const deadline = new Date(task.end_date);
    const diff = (deadline - now) / (1000 * 60 * 60 * 24);
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

      {/* Вкладки */}
      <div className="dashboard-tabs">
        <button
          className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          📁 Проекты
        </button>
        <button
          className={`tab-btn ${activeTab === 'mytasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('mytasks')}
        >
          ✅ Мои задачи
          {myTasks.filter(t => getTaskDeadlineClass(t) === 'overdue').length > 0 && (
            <span className="badge-count">
              {myTasks.filter(t => getTaskDeadlineClass(t) === 'overdue').length}
            </span>
          )}
        </button>
      </div>

      {/* ВКЛАДКА: ПРОЕКТЫ */}
      {activeTab === 'projects' && (
        <div className="projects-section">
          <div className="section-header">
            <h2>Мои проекты</h2>
            <button onClick={() => setShowCreateModal(true)} className="btn-primary">+ Создать проект</button>
          </div>
          <p className="hint-text">Перетащите карточки, чтобы изменить порядок проектов</p>

          {projects.length === 0 ? (
            <div className="empty-state">
              <p>У вас пока нет проектов</p>
              <p>Создайте первый проект, чтобы начать работу</p>
            </div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="projects-list" direction="horizontal">
                {(provided) => (
                  <div
                    className="projects-grid"
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >
                    {projects.map((project, index) => (
                      <Draggable key={project.id} draggableId={`proj-${project.id}`} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`project-card ${snapshot.isDragging ? 'dragging' : ''}`}
                            onClick={() => navigate(`/project/${project.id}`)}
                          >
                            <div className="project-card-header">
                              {/* Иконка перетаскивания */}
                              <div className="drag-handle" {...provided.dragHandleProps} onClick={e => e.stopPropagation()}>
                                ⠿
                              </div>
                              <h3>{project.name}</h3>
                              <div className="project-card-actions">
                                {project.role === 'owner' && (
                                  <>
                                    <button
                                      onClick={(e) => handleEditProject(project, e)}
                                      className="btn-icon-sm"
                                      title="Редактировать"
                                    >✏️</button>
                                    <button
                                      onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                                      className="btn-icon-sm btn-danger-sm"
                                      title="Удалить"
                                    >🗑️</button>
                                  </>
                                )}
                              </div>
                            </div>
                            <p>{project.description}</p>
                            <div className="project-meta">
                              <span className={`role-badge ${project.role}`}>
                                {project.role === 'owner' ? 'Владелец' : 'Участник'}
                              </span>
                              <span className="project-owner">{project.owner_name}</span>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>
      )}

      {/* ВКЛАДКА: МОИ ЗАДАЧИ */}
      {activeTab === 'mytasks' && (
        <div className="mytasks-section">
          <h2>Мои задачи</h2>
          {myTasks.length === 0 ? (
            <div className="empty-state">
              <p>Нет задач назначенных вам</p>
            </div>
          ) : (
            <div className="mytasks-list">
              {myTasks.map(task => {
                const deadlineClass = getTaskDeadlineClass(task);
                return (
                  <div
                    key={task.id}
                    className={`mytask-card ${deadlineClass}`}
                    onClick={() => navigate(`/project/${task.project_id}`)}
                  >
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

      {/* Модалка создания проекта */}
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

      {/* Модалка редактирования проекта */}
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
