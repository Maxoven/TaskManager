import React, { useState, useEffect } from 'react';
import { uploadFile, getTaskAttachments, downloadFile, deleteFile, getTaskReports } from '../services/api';
import './TaskModal.css';

function TaskModal({ task, members, onSave, onDelete, onClose, allTasks, onAttachmentsChange }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    assigneeIds: [],
    dependencies: []
  });
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);

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
      
      // Загружаем файлы только для существующей задачи
      loadAttachments();
      loadReports();
    }
  }, [task]);

  const loadReports = async () => {
    if (!task || !task.id) return;
    setLoadingReports(true);
    try {
      const response = await getTaskReports(task.id);
      setReports(response.data || []);
    } catch (error) {
      console.error('Ошибка загрузки отчётов:', error);
    } finally {
      setLoadingReports(false);
    }
  };

  const loadAttachments = async () => {
    if (!task || !task.id) return;
    
    setLoadingAttachments(true);
    try {
      const response = await getTaskAttachments(task.id);
      setAttachments(response.data || []);
    } catch (error) {
      console.error('Ошибка загрузки файлов:', error);
    } finally {
      setLoadingAttachments(false);
    }
  };

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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !task || !task.id) return;

    // Проверка размера файла (10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Файл слишком большой. Максимальный размер: 10MB');
      return;
    }

    setUploadingFile(true);
    try {
      await uploadFile(task.id, file);
      await loadAttachments();
      if (onAttachmentsChange) {
        onAttachmentsChange(); // Обновляем счетчик файлов в карточке
      }
      e.target.value = ''; // Сбрасываем input
    } catch (error) {
      alert(error.response?.data?.error || 'Ошибка загрузки файла');
      console.error('Ошибка загрузки файла:', error);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleFileDownload = async (fileId, fileName) => {
    try {
      const response = await downloadFile(task.id, fileId);
      
      // Создаем ссылку для скачивания
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Ошибка скачивания файла');
      console.error('Ошибка скачивания файла:', error);
    }
  };

  const handleFileDelete = async (fileId, fileName) => {
    if (!window.confirm(`Удалить файл "${fileName}"?`)) return;

    try {
      await deleteFile(task.id, fileId);
      await loadAttachments();
      if (onAttachmentsChange) {
        onAttachmentsChange(); // Обновляем счетчик файлов в карточке
      }
    } catch (error) {
      alert('Ошибка удаления файла');
      console.error('Ошибка удаления файла:', error);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

          {/* Секция файлов - только для существующих задач */}
          {task && task.id && (
            <div className="form-group">
              <div className="attachments-header">
                <label>Файлы</label>
                <label className="btn-upload-file" htmlFor="file-upload">
                  {uploadingFile ? '⏳ Загрузка...' : '📎 Добавить файл'}
                </label>
                <input
                  id="file-upload"
                  type="file"
                  onChange={handleFileUpload}
                  disabled={uploadingFile}
                  style={{ display: 'none' }}
                  accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                />
              </div>

              {loadingAttachments ? (
                <p className="attachments-loading">Загрузка файлов...</p>
              ) : attachments.length === 0 ? (
                <p className="no-attachments">Нет прикрепленных файлов</p>
              ) : (
                <div className="attachments-list">
                  {attachments.map(file => (
                    <div key={file.id} className="attachment-item">
                      <div className="attachment-info">
                        <span className="attachment-icon">📄</span>
                        <div className="attachment-details">
                          <div className="attachment-name">{file.original_name}</div>
                          <div className="attachment-meta">
                            {formatFileSize(file.file_size)} · {new Date(file.uploaded_at).toLocaleDateString('ru-RU')}
                          </div>
                        </div>
                      </div>
                      <div className="attachment-actions">
                        <button
                          type="button"
                          onClick={() => handleFileDownload(file.id, file.original_name)}
                          className="btn-download-file"
                          title="Скачать"
                        >
                          ⬇️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFileDelete(file.id, file.original_name)}
                          className="btn-delete-file"
                          title="Удалить"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <p className="attachments-hint">
                💡 Максимальный размер файла: 10MB. Поддерживаемые форматы: jpg, png, pdf, doc, docx, xls, xlsx, txt, zip, rar
              </p>
            </div>
          )}

          {!task && (
            <p className="create-task-hint">
              💡 Файлы можно будет добавить после создания задачи
            </p>
          )}

          {/* Секция отчётов — только для существующих задач */}
          {task && task.id && (
            <div className="form-group reports-section">
              <label>Отчёты по задаче</label>
              {loadingReports ? (
                <p style={{ color: '#888', fontSize: '13px' }}>Загрузка отчётов...</p>
              ) : reports.length === 0 ? (
                <p style={{ color: '#888', fontSize: '13px' }}>Отчётов пока нет</p>
              ) : (
                <div className="reports-list">
                  {reports.map(report => (
                    <div key={report.id} className="report-item">
                      <div className="report-header">
                        <span className="report-author">👤 {report.user_name}</span>
                        <span className="report-date">{new Date(report.submitted_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="report-text">{report.report_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            {onDelete && task && (
              <button 
                type="button" 
                onClick={() => onDelete(task.id)} 
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
