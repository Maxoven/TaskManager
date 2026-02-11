import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjects, createProject, getPendingInvitations, respondToInvitation, deleteProject } from '../services/api';
import './Dashboard.css';

function Dashboard({ user, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [projectsRes, invitationsRes] = await Promise.all([
        getProjects(),
        getPendingInvitations()
      ]);
      setProjects(projectsRes.data);
      setInvitations(invitationsRes.data);
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

  const handleDeleteProject = async (projectId, projectName, e) => {
    e.stopPropagation(); // Предотвращаем открытие проекта при клике на кнопку удаления
    
    if (!window.confirm(`Вы уверены, что хотите удалить проект "${projectName}"? Это действие нельзя отменить.`)) {
      return;
    }

    try {
      await deleteProject(projectId);
      loadData();
    } catch (error) {
      alert(error.response?.data?.error || 'Ошибка удаления проекта');
      console.error('Ошибка удаления проекта:', error);
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

  if (loading) {
    return <div className="loading">Загрузка...</div>;
  }

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
                  <button 
                    onClick={() => handleInvitationResponse(inv.id, 'approve')}
                    className="btn-success"
                  >
                    Принять
                  </button>
                  <button 
                    onClick={() => handleInvitationResponse(inv.id, 'reject')}
                    className="btn-danger"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="projects-section">
        <div className="section-header">
          <h2>Мои проекты</h2>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            + Создать проект
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state">
            <p>У вас пока нет проектов</p>
            <p>Создайте первый проект, чтобы начать работу</p>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map(project => (
              <div 
                key={project.id} 
                className="project-card"
                onClick={() => navigate(`/project/${project.id}`)}
              >
                <div className="project-card-header">
                  <h3>{project.name}</h3>
                  {project.role === 'owner' && (
                    <button
                      onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                      className="btn-delete-project"
                      title="Удалить проект"
                    >
                      🗑️
                    </button>
                  )}
                </div>
                <p>{project.description}</p>
                <div className="project-meta">
                  <span className={`role-badge ${project.role}`}>
                    {project.role === 'owner' ? 'Владелец' : 'Участник'}
                  </span>
                  <span className="project-owner">
                    {project.owner_name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Создать новый проект</h2>
            <form onSubmit={handleCreateProject}>
              <div className="form-group">
                <label>Название проекта</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  required
                  placeholder="Название"
                />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <textarea
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="Краткое описание проекта"
                  rows="3"
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">
                  Отмена
                </button>
                <button type="submit" className="btn-primary">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
