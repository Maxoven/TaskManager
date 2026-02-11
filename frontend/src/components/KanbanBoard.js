import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { getProject, createTask, updateTask, deleteTask, inviteToProject } from '../services/api';
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban'); // kanban или gantt

  useEffect(() => {
    loadProject();
  }, [id]);

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

    const { draggableId, destination } = result;
    const taskId = parseInt(draggableId);
    const newStatusId = parseInt(destination.droppableId);

    try {
      await updateTask(taskId, { statusId: newStatusId });
      loadProject();
    } catch (error) {
      console.error('Ошибка обновления задачи:', error);
    }
  };

  const handleCreateTask = async (taskData) => {
    try {
      await createTask({
        ...taskData,
        projectId: parseInt(id),
        statusId: selectedStatus
      });
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

  const isOwner = project?.owner_id === user?.id;

  if (loading) {
    return <div className="loading">Загрузка...</div>;
  }

  return (
    <div className="kanban-container">
      <header className="kanban-header">
        <div>
          <button onClick={() => navigate('/')} className="btn-back">← Назад</button>
          <h1>{project?.name}</h1>
          <p>{project?.description}</p>
        </div>
        <div className="header-actions">
          <div className="view-switcher">
            <button 
              className={`view-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => setViewMode('kanban')}
            >
              📋 Канбан
            </button>
            <button 
              className={`view-btn ${viewMode === 'gantt' ? 'active' : ''}`}
              onClick={() => setViewMode('gantt')}
            >
              📊 Гант
            </button>
          </div>
          {isOwner && (
            <button onClick={() => setShowInviteModal(true)} className="btn-primary">
              Пригласить
            </button>
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

      {viewMode === 'kanban' ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board">
          {statuses.map(status => {
            const statusTasks = tasks.filter(task => task.status_id === status.id);
            
            return (
              <div key={status.id} className="kanban-column">
                <div className="column-header">
                  <h2>{status.name}</h2>
                  <span className="task-count">{statusTasks.length}</span>
                  <button 
                    onClick={() => {
                      setSelectedStatus(status.id);
                      setShowTaskModal(true);
                    }}
                    className="btn-add-task"
                  >
                    +
                  </button>
                </div>

                <Droppable droppableId={status.id.toString()}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`task-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                    >
                      {statusTasks.map((task, index) => (
                        <Draggable 
                          key={task.id} 
                          draggableId={task.id.toString()} 
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`task-card ${snapshot.isDragging ? 'dragging' : ''}`}
                              onClick={() => {
                                setSelectedTask(task);
                                setShowTaskModal(true);
                              }}
                            >
                              <h3>{task.title}</h3>
                              {task.description && (
                                <p className="task-description">{task.description}</p>
                              )}
                              
                              <div className="task-meta">
                                {task.start_date && (
                                  <span className="task-date">
                                    📅 {new Date(task.start_date).toLocaleDateString('ru-RU')}
                                    {task.end_date && ` - ${new Date(task.end_date).toLocaleDateString('ru-RU')}`}
                                  </span>
                                )}
                              </div>

                              {task.assignees && task.assignees.length > 0 && (
                                <div className="task-assignees">
                                  {task.assignees.map(assignee => (
                                    <div key={assignee.id} className="assignee-badge" title={assignee.name}>
                                      {assignee.name.charAt(0).toUpperCase()}
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
          tasks={tasks} 
          members={members.filter(m => m.status === 'approved' || m.is_owner)}
          onTaskClick={(task) => {
            setSelectedTask(task);
            setShowTaskModal(true);
          }}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={selectedTask}
          members={members.filter(m => m.status === 'approved' || m.is_owner)}
          allTasks={tasks}
          onSave={selectedTask ? handleUpdateTask : handleCreateTask}
          onDelete={selectedTask && isOwner ? () => handleDeleteTask(selectedTask.id) : null}
          onClose={() => {
            setShowTaskModal(false);
            setSelectedTask(null);
            setSelectedStatus(null);
          }}
        />
      )}

      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Пригласить в проект</h2>
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label>Email пользователя</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  placeholder="user@example.com"
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowInviteModal(false)} className="btn-secondary">
                  Отмена
                </button>
                <button type="submit" className="btn-primary">
                  Отправить приглашение
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default KanbanBoard;
