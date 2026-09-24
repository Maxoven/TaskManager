import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { getProject, createTask, updateTask, deleteTask, inviteToProject, updateProject, removeProjectMember } from '../services/api';
import TaskModal from './TaskModal';
import GanttChart from './GanttChart';
import { useLanguage } from '../context/LanguageContext';
import AppHeader from './AppHeader';
import { formatDate, parseDate, deadlineState } from '../utils/date';
import useEscape from '../utils/useEscape';
import './KanbanBoard.css';

function KanbanBoard({ user, onLogout }) {
  const { t, lang } = useLanguage();
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
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState('kanban');
  // Фильтры
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [sortBy, setSortBy] = useState('created'); // created | deadline | title

  useEffect(() => { loadProject(); }, [id]);

  useEscape(() => { setShowInviteModal(false); setShowEditModal(false); }, showInviteModal || showEditModal);

  const loadProject = async () => {
    try {
      const response = await getProject(id);
      setProject(response.data);
      setStatuses(response.data.statuses || []);
      setTasks(response.data.tasks || []);
      setMembers(response.data.members || []);
      setLoadError('');
    } catch (error) {
      setLoadError(error.response?.data?.error || t('projectLoadError'));
    } finally {
      setLoading(false);
    }
  };

  // Последняя колонка считается «выполнено» — не зависит от её названия и языка
  const doneStatusId = statuses.length ? statuses[statuses.length - 1].id : null;
  const tasksWithState = tasks.map(task => ({
    ...task,
    is_done: task.status_id === doneStatusId,
    status_name: statuses.find(s => s.id === task.status_id)?.name || ''
  }));

  const closeTaskModal = () => {
    setShowTaskModal(false);
    setSelectedTask(null);
    setSelectedStatus(null);
  };

  const handleDragEnd = async (result) => {
    if (!result.destination || result.destination.droppableId === result.source.droppableId) return;
    const taskId = parseInt(result.draggableId);
    const newStatusId = parseInt(result.destination.droppableId);
    // Оптимистично перемещаем карточку, чтобы она не «прыгала» обратно до ответа сервера
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, status_id: newStatusId } : task));
    try {
      await updateTask(taskId, { statusId: newStatusId });
    } catch (error) {
      alert(error.response?.data?.error || t('taskMoveError'));
    }
    loadProject();
  };

  const handleCreateTask = async (taskData) => {
    try {
      await createTask({ ...taskData, projectId: parseInt(id), statusId: selectedStatus || statuses[0]?.id });
      closeTaskModal();
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || t('taskSaveError'));
    }
  };

  const handleUpdateTask = async (taskData) => {
    try {
      await updateTask(selectedTask.id, taskData);
      closeTaskModal();
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || t('taskSaveError'));
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm(t('deleteTaskConfirm'))) return;
    try {
      await deleteTask(taskId);
      closeTaskModal();
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || t('taskDeleteError'));
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      await inviteToProject(id, inviteEmail);
      setShowInviteModal(false);
      setInviteEmail('');
      alert(t('invitationSentAlert'));
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || t('inviteError'));
    }
  };

  const handleSaveProject = async (e) => {
    e.preventDefault();
    try {
      await updateProject(id, editForm);
      setShowEditModal(false);
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || t('projectUpdateError'));
    }
  };

  // Фильтрация и сортировка задач
  const getFilteredTasks = (statusId) => {
    let filtered = tasksWithState.filter(task => task.status_id === statusId);

    if (filterAssignee !== 'all') {
      filtered = filtered.filter(task =>
        task.assignees && task.assignees.some(a => a.id === parseInt(filterAssignee))
      );
    }

    filtered.sort((a, b) => {
      if (sortBy === 'deadline') {
        if (!a.end_date) return 1;
        if (!b.end_date) return -1;
        return parseDate(a.end_date) - parseDate(b.end_date);
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, lang);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return filtered;
  };

  const isOwnerMember = (m) => Number(m.is_owner) === 1;
  const approvedMembers = members.filter(m => m.status === 'approved' || isOwnerMember(m));
  const pendingMembers = members.filter(m => m.status === 'pending' && !isOwnerMember(m));
  const isOwner = project?.owner_id === user?.id;

  const handleRemoveMember = async (userId, userName) => {
    if (!window.confirm(`${userName} — ${t('removeMemberConfirm')}`)) return;
    try {
      await removeProjectMember(id, userId);
      loadProject();
    } catch (error) {
      alert(error.response?.data?.error || t('error'));
    }
  };

  const openTask = (task) => { setSelectedTask(task); setShowTaskModal(true); };
  const openNewTask = (statusId) => { setSelectedStatus(statusId); setShowTaskModal(true); };

  if (loading) return <div className="loading">{t('loading')}</div>;

  if (loadError) {
    return (
      <div className="kanban-container">
        <AppHeader user={user} onLogout={onLogout} wide />
        <div className="kanban-error">
          <p>{loadError}</p>
          <button onClick={() => navigate('/')} className="btn-primary">{t('back')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="kanban-container">
      <AppHeader user={user} onLogout={onLogout} wide />

      <div className="project-bar">
        <div className="project-bar-left">
          <button onClick={() => navigate('/')} className="btn-back">{t('back')}</button>
          <div className="kanban-title-block">
            <div className="project-title-row">
              <h1>{project?.name}</h1>
              {isOwner && (
                <button
                  className="btn-edit-project"
                  onClick={() => { setEditForm({ name: project.name, description: project.description || '' }); setShowEditModal(true); }}
                  title={t('editProjectBtnTitle')}
                >✏️</button>
              )}
            </div>
            {project?.description && (
              <p className="project-desc">
                {project.description.length > 100 && !showFullDesc
                  ? project.description.slice(0, 100) + '…'
                  : project.description}
                {project.description.length > 100 && (
                  <button className="btn-link" onClick={() => setShowFullDesc(!showFullDesc)}>
                    {showFullDesc ? t('collapse') : t('readMore')}
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="header-actions">
          <div className="view-switcher">
            <button className={`view-btn ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')}>{t('kanban')}</button>
            <button className={`view-btn ${viewMode === 'gantt' ? 'active' : ''}`} onClick={() => setViewMode('gantt')}>{t('gantt')}</button>
          </div>
          {isOwner && (
            <button onClick={() => setShowInviteModal(true)} className="btn-primary">+ {t('invite')}</button>
          )}
        </div>
      </div>

      <div className="kanban-toolbar">
        <div className="team-members">
          <h3>{t('team')}</h3>
          <div className="members-list">
            {approvedMembers.map(member => (
              <div key={member.id} className="member-badge">
                <span>{member.name}</span>
                {isOwnerMember(member) && <span>👑</span>}
                {member.source === 'team' && <span className="source-tag" title={t('sourceTeamTitle')}>👥</span>}
                {member.source === 'project' && <span className="source-tag" title={t('sourceProjectTitle')}>✉️</span>}
                {isOwner && !isOwnerMember(member) && (
                  <button
                    className="member-remove-btn"
                    onClick={() => handleRemoveMember(member.id, member.name)}
                    title={t('removeFromProjectTitle')}
                  >✕</button>
                )}
              </div>
            ))}
            {pendingMembers.map(member => (
              <div key={member.id} className="member-badge member-badge-pending">
                <span>{member.name}</span>
                <span className="pending-tag">{t('pendingTag')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Фильтры и сортировка (только для канбана) */}
        {viewMode === 'kanban' && (
          <div className="kanban-filters">
            <div className="filter-group">
              <label>{t('filterAssignee')}</label>
              <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
                <option value="all">{t('filterAll')}</option>
                {approvedMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>{t('sortBy')}</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="created">{t('sortByCreated')}</option>
                <option value="deadline">{t('sortByDeadline')}</option>
                <option value="title">{t('sortByTitle')}</option>
              </select>
            </div>
            {(filterAssignee !== 'all' || sortBy !== 'created') && (
              <button className="btn-reset-filters" onClick={() => { setFilterAssignee('all'); setSortBy('created'); }}>
                {t('resetFilters')}
              </button>
            )}
          </div>
        )}
      </div>

      {viewMode === 'kanban' ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            {statuses.map(status => {
              const statusTasks = getFilteredTasks(status.id);
              return (
                <div key={status.id} className="kanban-column">
                  <div className="column-header">
                    <h2 title={status.name}>{status.name}</h2>
                    <span className="task-count">{statusTasks.length}</span>
                    <button
                      onClick={() => openNewTask(status.id)}
                      className="btn-add-task"
                      title={t('addTaskTitle')}
                    >+</button>
                  </div>
                  <Droppable droppableId={status.id.toString()}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`task-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                      >
                        {statusTasks.map((task, index) => {
                          const deadlineClass = deadlineState(task);
                          return (
                            <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`task-card ${snapshot.isDragging ? 'dragging' : ''} ${deadlineClass ? 'deadline-' + deadlineClass : ''}`}
                                  onClick={() => openTask(task)}
                                >
                                  <h3>{task.title}</h3>
                                  {task.description && <p className="task-description">{task.description}</p>}
                                  {(task.end_date || task.attachments_count > 0 || task.has_report || task.assignees?.length > 0) && (
                                    <div className="task-footer">
                                      <div className="task-meta">
                                        {task.end_date && (
                                          <span className={`task-date ${deadlineClass ? 'deadline-' + deadlineClass : ''}`}>
                                            📅 {formatDate(task.end_date, lang)}
                                          </span>
                                        )}
                                        {task.attachments_count > 0 && (
                                          <span className="task-attachments-badge" title={`${t('filesCount')} ${task.attachments_count}`}>
                                            📎 {task.attachments_count}
                                          </span>
                                        )}
                                        {task.has_report && (
                                          <span className="task-report-badge" title={t('ganttReportSent')}>✅</span>
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
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                  <button className="btn-add-task-inline" onClick={() => openNewTask(status.id)}>
                    {t('addTaskInColumn')}
                  </button>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <GanttChart
          tasks={tasksWithState}
          members={approvedMembers}
          onTaskClick={openTask}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={selectedTask}
          members={approvedMembers}
          allTasks={tasks}
          onSave={selectedTask ? handleUpdateTask : handleCreateTask}
          onDelete={handleDeleteTask}
          onClose={closeTaskModal}
          onAttachmentsChange={loadProject}
        />
      )}

      {/* Редактирование проекта */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('editProjectModalTitle')}</h2>
            <form onSubmit={handleSaveProject}>
              <div className="form-group">
                <label>{t('nameLabel')}</label>
                <input type="text" autoFocus value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>{t('projectDescLabel')}</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows="3" />
              </div>
              <div className="modal-actions">
                <div className="modal-actions-right">
                  <button type="button" onClick={() => setShowEditModal(false)} className="btn-secondary">{t('cancel')}</button>
                  <button type="submit" className="btn-primary">{t('save')}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Приглашение */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('inviteModalTitle')}</h2>
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label>{t('inviteEmailLabel')}</label>
                <input type="email" autoFocus value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required placeholder={t('inviteEmailPlaceholder')} />
              </div>
              <div className="modal-actions">
                <div className="modal-actions-right">
                  <button type="button" onClick={() => setShowInviteModal(false)} className="btn-secondary">{t('cancel')}</button>
                  <button type="submit" className="btn-primary">{t('inviteBtn')}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default KanbanBoard;
