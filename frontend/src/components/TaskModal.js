import React, { useState, useEffect } from 'react';
import './TaskModal.css';

function TaskModal({ task, members, onSave, onDelete, onClose, allTasks }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    assigneeIds: [],
    dependencies: []
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || '',
        description: task.description || '',
        startDate: task.start_date || '',
        endDate: task.end_date || '',
        assigneeIds: task.assignees?.map(a => a.id) || [],
        dependencies: task.dependencies?.map(d => ({
          depends_on_task_id: d.depends_on_task_id,
          dependency_type: d.dependency_type || 'finish_to_start'
        })) || []
      });
    }
  }, [task]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleAssigneeToggle = (userId) => {
    setFormData(prev => ({
      ...prev,
      assigneeIds: prev.assigneeIds.includes(userId)
        ? prev.assigneeIds.filter(id => id !== userId)
        : [...prev.assigneeIds, userId]
    }));
  };

  const handleAddDependency = () => {
    setFormData(prev => ({
      ...prev,
      dependencies: [...prev.dependencies, { depends_on_task_id: '', dependency_type: 'finish_to_start' }]
    }));
  };

  const handleRemoveDependency = (index) => {
    setFormData(prev => ({
      ...prev,
      dependencies: prev.dependencies.filter((_, i) => i !== index)
    }));
  };

  const handleDependencyChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      dependencies: prev.dependencies.map((dep, i) => 
        i === index ? { ...dep, [field]: parseInt(value) || value } : dep
      )
    }));
  };

  // Фильтруем задачи для связей (исключаем текущую задачу)
  const availableTasksForDependency = allTasks?.filter(t => t.id !== task?.id) || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{task ? 'Редактировать задачу' : 'Создать задачу'}</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Название задачи *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
              placeholder="Название"
            />
          </div>

          <div className="form-group">
            <label>Описание</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Описание задачи"
              rows="4"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Дата начала</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Дата окончания</label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                min={formData.startDate}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Исполнители</label>
            <div className="assignees-select">
              {members.map(member => (
                <label key={member.id} className="assignee-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.assigneeIds.includes(member.id)}
                    onChange={() => handleAssigneeToggle(member.id)}
                  />
                  <span>{member.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <div className="dependency-header">
              <label>Связи с задачами</label>
              <button 
                type="button" 
                onClick={handleAddDependency}
                className="btn-add-dependency"
                disabled={availableTasksForDependency.length === 0}
              >
                + Добавить связь
              </button>
            </div>
            
            {formData.dependencies.length === 0 ? (
              <p className="no-dependencies">Нет связей с другими задачами</p>
            ) : (
              <div className="dependencies-list">
                {formData.dependencies.map((dep, index) => (
                  <div key={index} className="dependency-item">
                    <select
                      value={dep.depends_on_task_id}
                      onChange={(e) => handleDependencyChange(index, 'depends_on_task_id', e.target.value)}
                      required
                    >
                      <option value="">Выберите задачу</option>
                      {availableTasksForDependency.map(t => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                    
                    <select
                      value={dep.dependency_type}
                      onChange={(e) => handleDependencyChange(index, 'dependency_type', e.target.value)}
                    >
                      <option value="finish_to_start">Окончание → Начало</option>
                      <option value="start_to_start">Начало → Начало</option>
                      <option value="finish_to_finish">Окончание → Окончание</option>
                      <option value="start_to_finish">Начало → Окончание</option>
                    </select>
                    
                    <button
                      type="button"
                      onClick={() => handleRemoveDependency(index)}
                      className="btn-remove-dependency"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="dependency-hint">
              💡 Связи определяют порядок выполнения задач на диаграмме Ганта
            </p>
          </div>

          <div className="modal-actions">
            {onDelete && (
              <button 
                type="button" 
                onClick={onDelete} 
                className="btn-danger"
              >
                Удалить
              </button>
            )}
            <div className="modal-actions-right">
              <button type="button" onClick={onClose} className="btn-secondary">
                Отмена
              </button>
              <button type="submit" className="btn-primary">
                {task ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskModal;
