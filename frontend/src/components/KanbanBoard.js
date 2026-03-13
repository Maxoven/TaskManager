import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { getProject, createTask, updateTask, deleteTask, inviteToProject, updateProject, getTaskReports } from '../services/api';
import TaskModal from './TaskModal';
import GanttChart from './GanttChart';
import './KanbanBoard.css';

function KanbanBoard({ user, onLogout }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban');
  // Фильтры
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [sortBy, setSortBy] = useState('created'); // created | deadline | title

  useEffect(() => { loadProject(); }, [id]);

  const loadProject = async () => {
    try {
      const response = await getProject(id);
      setProject(response.data);
      setStatuses(response.data.statuses || []);
      setTasks(response.data.tasks || []);
      setMembers(response.data.members || []);
    } catch (error) {
      console.error('Ошибка загрузки проекта:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const taskId = parseInt(result.draggableId);
    const newStatusId = parseInt(result.destination.droppableId);
    try {
      await updateTask(taskId, { statusId: newStatusId });
      loadProject();
    } catch (error) {
      console.error('Ошибка обновления задачи:', error);
    }
  };

  const handleCreateTask = async (taskData) => {
    try {
      await createTask({ ...taskData, projectId: parseInt(id), statusId: selectedStatus });
      setShowTaskModal(false);
      setSelectedTask(null);
      setSelectedStatus(null);
      loadProject();
    } catch (error) {
      console.error('Ошибка создания задачи:', error);
    }
  };

  const handleUpdateTask = async (taskData) => {
    try {
      await updateTask(selectedTask.id, taskData);
      setShowTaskModal(false);
      setSelectedTask(null);
      loadProject();
    } catch (error) {
      console.error('Ошибка обновления задачи:', error);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Удалить эту задачу?')) return;
    try {
      await deleteTask(taskId);
      setShowTaskModal(false);
      setSelectedTask(null);
      loadProject();
    } catch (error) {
      console.error('Ошибка удаления задачи:', error);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      await inviteToProject(id, inviteEmail);
      setShowInviteModal(false);
      setInviteEmail('');
      alert('Приглашение отправлено!');
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || 'Ошибка отправки приглашения');
    }
  };

  const handleSaveProject = async (e) => {
    e.preventDefault();
    try {
      await updateProject(id, editForm);
      setShowEditModal(false);
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || 'Ошибка обновления проекта');
    }
  };

  // Фильтрация и сортировка задач
  const getFilteredTasks = (statusId) => {
    let filtered = tasks.filter(t => t.status_id === statusId);

    if (filterAssignee !== 'all') {
      filtered = filtered.filter(t =>
        t.assignees && t.assignees.some(a => a.id === parseInt(filterAssignee))
      );
    }

    filtered.sort((a, b) => {
      if (sortBy === 'deadline') {
        if (!a.end_date) return 1;
        if (!b.end_date) return -1;
        return new Date(a.end_date) - new Date(b.end_date);
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, 'ru');
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return filtered;
  };

  const approvedMembers = members.filter(m => m.status === 'approved' || m.is_owner);
  const isOwner = project?.owner_id === user?.id;

  const getDeadlineClass = (task) => {
    if (!task.end_date) return '';
    const diff = (new Date(task.end_date) - new Date()) / (1000 * 60 * 60 * 24);
    if (diff < 0) return 'deadline-overdue';
    if (diff <= 3) return 'deadline-soon';
    return '';
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="kanban-container">
      <header className="kanban-header">
        <div className="kanban-header-left">
          <button onClick={() => navigate('/')} className="btn-back">← Назад</button>
          <div>
            <div className="project-title-row">
              <h1>{project?.name}</h1>
              {isOwner && (
                <button
                  className="btn-edit-project"
                  onClick={() => { setEditForm({ name: project.name, description: project.description || '' }); setShowEditModal(true); }}
                  title="Редактировать проект"
                >✏️</button>
              )}
            </div>
            <p className="project-desc">
              {project?.description && project.description.length > 100 ? (
                <>
                  {showFullDesc ? project.description : project.description.slice(0, 100) + '...'}
                  <button
                    onClick={() => setShowFullDesc(!showFullDesc)}
                    style={{ background: 'none', border: 'none', color: '#25b84c', cursor: 'pointer', padding: '0 4px', fontSize: 13 }}
                  >
                    {showFullDesc ? 'Свернуть' : 'Читать далее'}
                  </button>
                </>
              ) : project?.description}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <div className="view-switcher">
            <button className={`view-btn ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')}>📋 Канбан</button>
            <button className={`view-btn ${viewMode === 'gantt' ? 'active' : ''}`} onClick={() => setViewMode('gantt')}>📊 Гант</button>
          </div>
          {isOwner && (
            <button onClick={() => setShowInviteModal(true)} className="btn-primary">Пригласить</button>
          )}
          <button onClick={onLogout} className="btn-secondary">Выйти</button>
        </div>
      </header>

      <div className="team-members">
        <h3>Команда:</h3>
        <div className="members-list">
          {members.map(member => (
            <div key={member.id} className="member-badge">
              {member.name} {member.is_owner && '👑'}
              {member.status === 'pending' && ' (ожидает)'}
            </div>
          ))}
        </div>
      </div>

      {/* Фильтры и сортировка (только для канбана) */}
      {viewMode === 'kanban' && (
        <div className="kanban-filters">
          <div className="filter-group">
            <label>Исполнитель:</label>
            <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
              <option value="all">Все</option>
              {approvedMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Сортировка:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="created">По дате создания</option>
              <option value="deadline">По дедлайну</option>
              <option value="title">По названию</option>
            </select>
          </div>
          {(filterAssignee !== 'all' || sortBy !== 'created') && (
            <button className="btn-reset-filters" onClick={() => { setFilterAssignee('all'); setSortBy('created'); }}>
              ✕ Сбросить
            </button>
          )}
        </div>
      )}

      {viewMode === 'kanban' ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            {statuses.map(status => {
              const statusTasks = getFilteredTasks(status.id);
              return (
                <div key={status.id} className="kanban-column">
                  <div className="column-header">
                    <h2>{status.name}</h2>
                    <span className="task-count">{statusTasks.length}</span>
                    <button
                      onClick={() => { setSelectedStatus(status.id); setShowTaskModal(true); }}
                      className="btn-add-task"
                      title="Создать задачу"
                    >+</button>
                  </div>
                  <Droppable droppableId={status.id.toString()}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`task-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                      >
                        {statusTasks.map((task, index) => (
                          <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`task-card ${snapshot.isDragging ? 'dragging' : ''} ${getDeadlineClass(task)}`}
                                onClick={() => { setSelectedTask(task); setShowTaskModal(true); }}
                              >
                                <h3>{task.title}</h3>
                                {task.description && <p className="task-description">{task.description}</p>}
                                <div className="task-meta">
                                  {task.end_date && (
                                    <span className={`task-date ${getDeadlineClass(task)}`}>
                                      📅 {new Date(task.end_date).toLocaleDateString('ru-RU')}
                                    </span>
                                  )}
                                  {task.attachments_count > 0 && (
                                    <span className="task-attachments-badge" title={`Файлов: ${task.attachments_count}`}>
                                      📎 {task.attachments_count}
                                    </span>
                                  )}
                                  {task.has_report && (
                                    <span className="task-report-badge" title="Отчёт сдан">✅</span>
                                  )}
                                </div>
                                {task.assignees && task.assignees.length > 0 && (
                                  <div className="task-assignees">
                                    {task.assignees.map(a => (
                                      <div key={a.id} className="assignee-badge" title={a.name}>
                                        {a.name.charAt(0).toUpperCase()}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <GanttChart
          tasks={tasks.map(t => ({
            ...t,
            status_name: statuses.find(s => s.id === t.status_id)?.name || ''
          }))}
          members={approvedMembers}
          onTaskClick={(task) => { setSelectedTask(task); setShowTaskModal(true); }}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={selectedTask}
          members={approvedMembers}
          allTasks={tasks}
          onSave={selectedTask ? handleUpdateTask : handleCreateTask}
          onDelete={handleDeleteTask}
          onClose={() => { setShowTaskModal(false); setSelectedTask(null); setSelectedStatus(null); }}
          onAttachmentsChange={loadProject}
        />
      )}

      {/* Редактирование проекта */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Редактировать проект</h2>
            <form onSubmit={handleSaveProject}>
              <div className="form-group">
                <label>Название</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows="3" />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowEditModal(false)} className="btn-secondary">Отмена</button>
                <button type="submit" className="btn-primary">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Приглашение */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Пригласить в проект</h2>
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label>Email пользователя</label>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required placeholder="user@example.com" />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowInviteModal(false)} className="btn-secondary">Отмена</button>
                <button type="submit" className="btn-primary">Отправить приглашение</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default KanbanBoard;
