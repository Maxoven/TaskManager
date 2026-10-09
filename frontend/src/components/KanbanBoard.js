import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { getProject, createTask, updateTask, deleteTask, updateProject, uploadFile } from '../services/api';
import TaskModal from './TaskModal';
import ProjectMembersModal from './ProjectMembersModal';
import Modal from './Modal';
import { useFeedback } from '../context/FeedbackContext';
import apiError from '../utils/apiError';
import GanttChart from './GanttChart';
import { useLanguage } from '../context/LanguageContext';
import AppHeader from './AppHeader';
import { formatDate, parseDate, deadlineState, DEADLINE_CHIP, DEADLINE_ICON } from '../utils/date';
import Icon from './Icon';
import Avatar from './Avatar';
import { BoardSkeleton } from './Skeleton';
import './KanbanBoard.css';

function KanbanBoard({ user, onLogout }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [editError, setEditError] = useState('');
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewMode, setViewMode] = useState('kanban');
  // Фильтры
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [sortBy, setSortBy] = useState('created'); // created | deadline | title

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadProject(); }, [id]);

  const loadProject = async () => {
    try {
      const response = await getProject(id);
      setProject(response.data);
      setStatuses(response.data.statuses || []);
      setTasks(response.data.tasks || []);
      setMembers(response.data.members || []);
      setLoadError('');
      return response.data;
    } catch (error) {
      // Если проект уже на экране, не заменяем доску страницей ошибки — достаточно уведомления
      if (project) notify.error(apiError(error, t, 'projectLoadError'));
      else setLoadError(error.response?.status === 403 ? t('projectNoAccess') : apiError(error, t, 'projectLoadError'));
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Ссылка вида /project/5?task=42 (из «Моих задач») сразу открывает нужную задачу
  const taskParam = searchParams.get('task');
  useEffect(() => {
    if (!taskParam || loading || !project) return;
    const linked = tasks.find(task => String(task.id) === taskParam);
    if (linked) {
      setSelectedTask(linked);
      setShowTaskModal(true);
    } else {
      notify.error(t('taskLinkNotFound'));
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam, loading, project?.id]);

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
    const movedTask = tasks.find(task => task.id === taskId);
    try {
      await updateTask(taskId, { statusId: newStatusId });
      // Последняя колонка = «выполнено»: говорим об этом в момент, когда это происходит
      if (newStatusId === doneStatusId && movedTask) {
        notify.success(t('taskDoneToast', { title: movedTask.title }));
      }
    } catch (error) {
      notify.error(apiError(error, t, 'taskMoveError'));
    }
    loadProject();
  };

  // Возвращают true, если задача сохранена (тогда окно закрывается)
  const handleCreateTask = async (taskData, files = []) => {
    let created;
    try {
      const response = await createTask({ ...taskData, projectId: parseInt(id), statusId: taskData.statusId || selectedStatus || statuses[0]?.id });
      created = response.data;
    } catch (error) {
      notify.error(apiError(error, t, 'taskSaveError'));
      return false;
    }
    // Файлы, выбранные при создании, загружаем сразу после него
    const failed = [];
    for (const file of files) {
      try { await uploadFile(created.id, file); }
      catch (error) { failed.push(file.name); }
    }
    closeTaskModal();
    if (failed.length) notify.error(t('taskCreatedFilesFailed', { files: failed.join(', ') }));
    else notify.success(t('taskCreatedToast'));
    loadProject();
    return true;
  };

  const handleUpdateTask = async (taskData) => {
    try {
      await updateTask(selectedTask.id, taskData);
      const becameDone = taskData.statusId === doneStatusId && selectedTask.status_id !== doneStatusId;
      closeTaskModal();
      notify.success(becameDone ? t('taskDoneToast', { title: taskData.title }) : t('taskSavedToast'));
      loadProject();
      return true;
    } catch (error) {
      notify.error(apiError(error, t, 'taskSaveError'));
      return false;
    }
  };

  const handleDeleteTask = async (task) => {
    const ok = await confirm({
      title: t('deleteTaskTitle', { title: task.title }),
      message: t('deleteTaskMessage'),
      confirmLabel: t('deleteTaskBtn'),
      danger: true
    });
    if (!ok) return;
    try {
      await deleteTask(task.id);
      closeTaskModal();
      notify.success(t('taskDeletedToast'));
      loadProject();
    } catch (error) {
      notify.error(apiError(error, t, 'taskDeleteError'));
    }
  };

  const handleSaveProject = async (e) => {
    e.preventDefault();
    setEditError(''); setSavingProject(true);
    try {
      await updateProject(id, editForm);
      setShowEditModal(false);
      notify.success(t('projectSavedToast'));
      loadProject();
    } catch (error) {
      setEditError(apiError(error, t, 'projectUpdateError'));
    } finally {
      setSavingProject(false);
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

  const filterActive = filterAssignee !== 'all';

  const openTask = (task) => { setSelectedTask(task); setShowTaskModal(true); };
  const openNewTask = (statusId) => { setSelectedStatus(statusId); setShowTaskModal(true); };

  if (loading) {
    return (
      <div className="kanban-container">
        <AppHeader user={user} onLogout={onLogout} wide />
        <BoardSkeleton label={t('loading')} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="kanban-container">
        <AppHeader user={user} onLogout={onLogout} wide />
        <main className="page-error" role="alert">
          <span className="page-error-icon" aria-hidden="true"><Icon name="alert" size={26} /></span>
          <p className="page-error-title">{t('projectLoadErrorTitle')}</p>
          <p className="page-error-text">{loadError}</p>
          <div className="page-error-actions">
            <button type="button" onClick={() => { setLoading(true); loadProject(); }} className="btn-secondary">{t('retry')}</button>
            <button type="button" onClick={() => navigate('/')} className="btn-primary">{t('backToProjects')}</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="kanban-container">
      <AppHeader user={user} onLogout={onLogout} wide />

      <div className="project-bar">
        <div className="project-bar-left">
          <button type="button" onClick={() => navigate('/')} className="btn-back"><Icon name="arrow-left" />{t('backToProjects')}</button>
          <div className="kanban-title-block">
            <div className="project-title-row">
              <h1>{project?.name}</h1>
              {isOwner && (
                <button
                  type="button"
                  className="btn-small btn-edit-project"
                  onClick={() => { setEditForm({ name: project.name, description: project.description || '' }); setEditError(''); setShowEditModal(true); }}
                  aria-label={t('editProjectBtnTitle')}
                ><Icon name="pencil" size={14} />{t('editShort')}</button>
              )}
            </div>
            {project?.description && (
              <p className="project-desc">
                {project.description.length > 100 && !showFullDesc
                  ? project.description.slice(0, 100) + '…'
                  : project.description}
                {project.description.length > 100 && (
                  <button type="button" className="btn-link" onClick={() => setShowFullDesc(!showFullDesc)}>
                    {showFullDesc ? t('collapse') : t('readMore')}
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="header-actions">
          <div className="view-switcher segmented" role="group" aria-label={t('viewSwitcherLabel')}>
            <button type="button" className={`view-btn segmented-btn ${viewMode === 'kanban' ? 'active' : ''}`} aria-pressed={viewMode === 'kanban'} title={t('kanbanTitle')} onClick={() => setViewMode('kanban')}><Icon name="board" />{t('kanban')}</button>
            <button type="button" className={`view-btn segmented-btn ${viewMode === 'gantt' ? 'active' : ''}`} aria-pressed={viewMode === 'gantt'} title={t('ganttTitle')} onClick={() => setViewMode('gantt')}><Icon name="timeline" />{t('gantt')}</button>
          </div>
          <button type="button" onClick={() => openNewTask(statuses[0]?.id)} className="btn-primary btn-new-task"><Icon name="plus" />{t('newTaskBtn')}</button>
        </div>
      </div>

      <div className="kanban-toolbar">
        <div className="team-members">
          <h3>{t('team')}</h3>
          <ul className="members-list">
            {approvedMembers.map(member => (
              <li key={member.id} className="member-badge">
                <Avatar name={member.name} size="sm" aria-hidden="true" />
                <span>{member.name}</span>
                {isOwnerMember(member) && <span className="member-owner-tag">{t('ownerTag')}</span>}
              </li>
            ))}
            {pendingMembers.map(member => (
              <li key={member.id} className="member-badge member-badge-pending">
                <Avatar name={member.name} size="sm" muted aria-hidden="true" />
                <span>{member.name}</span>
                <span className="pending-tag"><Icon name="clock" size={12} />{t('pendingTag')}</span>
              </li>
            ))}
          </ul>
          {/* Одна точка входа для всего, что связано с доступом к проекту */}
          <button type="button" className="btn-small btn-members" onClick={() => setShowMembersModal(true)}>
            <Icon name="users" size={15} />
            {isOwner ? t('membersManageBtn') : t('membersViewBtn')}
          </button>
        </div>

        {/* Фильтры и сортировка (только для канбана) */}
        {viewMode === 'kanban' && (
          <div className="kanban-filters">
            <div className="filter-group">
              <label htmlFor="filter-assignee">{t('filterAssignee')}</label>
              <select id="filter-assignee" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
                <option value="all">{t('filterAll')}</option>
                {approvedMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="sort-by">{t('sortBy')}</label>
              <select id="sort-by" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="created">{t('sortByCreated')}</option>
                <option value="deadline">{t('sortByDeadline')}</option>
                <option value="title">{t('sortByTitle')}</option>
              </select>
            </div>
            {(filterAssignee !== 'all' || sortBy !== 'created') && (
              <button type="button" className="btn-small btn-reset-filters" onClick={() => { setFilterAssignee('all'); setSortBy('created'); }}>
                {t('resetFilters')}
              </button>
            )}
          </div>
        )}
      </div>

      {viewMode === 'kanban' ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board board-enter">
            {statuses.map(status => {
              const statusTasks = getFilteredTasks(status.id);
              const isDoneColumn = status.id === doneStatusId;
              return (
                <section key={status.id} className={`kanban-column ${isDoneColumn ? 'kanban-column-done' : ''}`} aria-label={status.name}>
                  <div className="column-header">
                    {isDoneColumn && <Icon name="check-circle" size={18} className="column-done-icon" />}
                    <h2 title={status.name}>{status.name}</h2>
                    <span className="task-count" title={t('taskCountTitle')}>{statusTasks.length}</span>
                    <button
                      type="button"
                      onClick={() => openNewTask(status.id)}
                      className="btn-icon btn-add-task"
                      title={t('addTaskToColumnTitle', { column: status.name })}
                      aria-label={t('addTaskToColumnTitle', { column: status.name })}
                    ><Icon name="plus" size={18} /></button>
                  </div>
                  {/* Последняя колонка — «выполнено»: от неё зависят прогресс, просрочки и напоминания */}
                  {isDoneColumn && <p className="column-hint column-done-hint">{t('columnDoneHint')}</p>}
                  <Droppable droppableId={status.id.toString()}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`task-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                      >
                        {statusTasks.map((task, index) => {
                          const deadlineClass = deadlineState(task);
                          const deadlineLabel = deadlineClass === 'overdue' ? t('taskOverdue') : deadlineClass === 'due-soon' ? t('taskDueSoon') : '';
                          return (
                            <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`task-card ${snapshot.isDragging ? 'dragging' : ''} ${deadlineClass ? 'deadline-' + deadlineClass : ''}`}
                                  onClick={() => openTask(task)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTask(task); }}
                                >
                                  <h3>{task.title}</h3>
                                  {task.description && <p className="task-description">{task.description}</p>}
                                  {(task.end_date || task.attachments_count > 0 || task.has_report || task.assignees?.length > 0) && (
                                    <div className="task-footer">
                                      <div className="task-meta">
                                        {task.end_date && (
                                          <span className={`task-date chip ${DEADLINE_CHIP[deadlineClass] || ''}`} title={deadlineLabel || undefined}>
                                            <Icon name={DEADLINE_ICON[deadlineClass] || 'calendar'} size={13} />
                                            {formatDate(task.end_date, lang)}
                                            {deadlineLabel && <span className="visually-hidden"> — {deadlineLabel}</span>}
                                          </span>
                                        )}
                                        {task.attachments_count > 0 && (
                                          <span className="task-attachments-badge" title={`${t('filesCount')} ${task.attachments_count}`}>
                                            <Icon name="paperclip" size={13} />{task.attachments_count}
                                          </span>
                                        )}
                                        {task.has_report && (
                                          <span className="task-report-badge" title={t('ganttReportSent')}><Icon name="file-check" size={15} /><span className="visually-hidden">{t('ganttReportSent')}</span></span>
                                        )}
                                      </div>
                                      {task.assignees && task.assignees.length > 0 && (
                                        <div className="task-assignees">
                                          {task.assignees.map(a => (
                                            <Avatar key={a.id} name={a.name} size="sm" className="assignee-badge" title={a.name} />
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
                        {statusTasks.length === 0 && !snapshot.isDraggingOver && (
                          <p className="column-empty">{filterActive ? t('columnEmptyFiltered') : t('columnEmpty')}</p>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                  <button type="button" className="btn-add-task-inline" onClick={() => openNewTask(status.id)}>
                    <Icon name="plus" size={15} />
                    {t('addTaskInColumn')}
                  </button>
                </section>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        <GanttChart
          tasks={tasksWithState}
          members={approvedMembers}
          onTaskClick={openTask}
          onAddTask={() => openNewTask(statuses[0]?.id)}
        />
      )}

      {showTaskModal && (
        <TaskModal
          task={selectedTask}
          members={approvedMembers}
          statuses={statuses}
          defaultStatusId={selectedStatus || statuses[0]?.id}
          allTasks={tasks}
          onSave={selectedTask ? handleUpdateTask : handleCreateTask}
          onDelete={handleDeleteTask}
          onClose={closeTaskModal}
          onAttachmentsChange={loadProject}
        />
      )}

      {/* Редактирование проекта */}
      {showEditModal && (
        <Modal title={t('editProjectModalTitle')} onClose={() => setShowEditModal(false)} className="project-form-modal">
          <form onSubmit={handleSaveProject}>
            <div className="form-group">
              <label htmlFor="edit-project-name">{t('projectNameLabel')}</label>
              <input id="edit-project-name" type="text" autoFocus value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required maxLength={255} />
            </div>
            <div className="form-group">
              <label htmlFor="edit-project-description">{t('projectDescLabel')}</label>
              <textarea id="edit-project-description" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows="3" />
            </div>
            {editError && <div className="error" role="alert">{editError}</div>}
            <div className="modal-actions">
              <div className="modal-actions-right">
                <button type="button" onClick={() => setShowEditModal(false)} className="btn-secondary">{t('cancel')}</button>
                <button type="submit" className="btn-primary" disabled={savingProject}>{savingProject ? t('saving') : t('save')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Участники и приглашения */}
      {showMembersModal && (
        <ProjectMembersModal
          project={project}
          members={members}
          user={user}
          isOwner={isOwner}
          onChanged={loadProject}
          onLeft={() => navigate('/')}
          onClose={() => setShowMembersModal(false)}
        />
      )}
    </div>
  );
}

export default KanbanBoard;
