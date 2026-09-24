import React, { useState, useEffect } from 'react';
import { uploadFile, getTaskAttachments, downloadFile, deleteFile, getTaskReports } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { toInputDate, formatDate } from '../utils/date';
import useEscape from '../utils/useEscape';
import './TaskModal.css';

function TaskModal({ task, members, onSave, onDelete, onClose, allTasks, onAttachmentsChange }) {
  const { t, lang } = useLanguage();
  useEscape(onClose);
  const [formData, setFormData] = useState({
    title: '', description: '', startDate: '', endDate: '', assigneeIds: [], dependencies: []
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
        startDate: toInputDate(task.start_date),
        endDate: toInputDate(task.end_date),
        assigneeIds: task.assignees?.map(a => a.id) || [],
        dependencies: task.dependencies?.map(d => ({
          depends_on_task_id: d.depends_on_task_id,
          dependency_type: d.dependency_type || 'finish_to_start'
        })) || []
      });
      loadAttachments();
      loadReports();
    }
  }, [task]);

  const loadReports = async () => {
    if (!task || !task.id) return;
    setLoadingReports(true);
    try { const r = await getTaskReports(task.id); setReports(r.data || []); }
    catch (e) { console.error(e); }
    finally { setLoadingReports(false); }
  };

  const loadAttachments = async () => {
    if (!task || !task.id) return;
    setLoadingAttachments(true);
    try { const r = await getTaskAttachments(task.id); setAttachments(r.data || []); }
    catch (e) { console.error(e); }
    finally { setLoadingAttachments(false); }
  };

  const handleSubmit = (e) => { e.preventDefault(); onSave(formData); };

  const handleAssigneeToggle = (userId) => {
    setFormData(prev => ({
      ...prev,
      assigneeIds: prev.assigneeIds.includes(userId)
        ? prev.assigneeIds.filter(id => id !== userId)
        : [...prev.assigneeIds, userId]
    }));
  };

  const handleAddDependency = () => {
    setFormData(prev => ({ ...prev, dependencies: [...prev.dependencies, { depends_on_task_id: '', dependency_type: 'finish_to_start' }] }));
  };

  const handleRemoveDependency = (index) => {
    setFormData(prev => ({ ...prev, dependencies: prev.dependencies.filter((_, i) => i !== index) }));
  };

  const handleDependencyChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      dependencies: prev.dependencies.map((dep, i) => i === index ? { ...dep, [field]: parseInt(value) || value } : dep)
    }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !task || !task.id) return;
    if (file.size > 10 * 1024 * 1024) { alert(t('taskFileSizeError')); return; }
    setUploadingFile(true);
    try {
      await uploadFile(task.id, file);
      await loadAttachments();
      if (onAttachmentsChange) onAttachmentsChange();
      e.target.value = '';
    } catch (error) { alert(error.response?.data?.error || t('error')); }
    finally { setUploadingFile(false); }
  };

  const handleFileDownload = async (fileId, fileName) => {
    try {
      const response = await downloadFile(task.id, fileId);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url; link.setAttribute('download', fileName);
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
    } catch { alert(t('error')); }
  };

  const handleFileDelete = async (fileId, fileName) => {
    if (!window.confirm(`${t('taskDeleteFileConfirm')} "${fileName}"?`)) return;
    try {
      await deleteFile(task.id, fileId);
      await loadAttachments();
      if (onAttachmentsChange) onAttachmentsChange();
    } catch { alert(t('error')); }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const availableTasksForDependency = allTasks?.filter(t => t.id !== task?.id) || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{task ? t('editTaskTitle') : t('createTaskTitle')}</h2>
          <button type="button" onClick={onClose} className="close-btn" title={t('close')} aria-label={t('close')}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('taskTitleLabel')} <span className="required-mark">*</span></label>
            <input type="text" autoFocus={!task} value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required placeholder={t('taskTitlePlaceholder')} />
          </div>

          <div className="form-group">
            <label>{t('taskDescLabel')}</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder={t('taskDescPlaceholder')} rows="4" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('taskStartDate')}</label>
              <input type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('taskEndDate')}</label>
              <input type="date" value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} min={formData.startDate} />
            </div>
          </div>

          <div className="form-group">
            <label>{t('taskAssignees')}</label>
            <div className="assignees-select">
              {members.map(member => (
                <label key={member.id} className="assignee-checkbox">
                  <input type="checkbox" checked={formData.assigneeIds.includes(member.id)} onChange={() => handleAssigneeToggle(member.id)} />
                  <span>{member.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <div className="dependency-header">
              <label>{t('taskDependencies')}</label>
              <button type="button" onClick={handleAddDependency} className="btn-add-dependency" disabled={availableTasksForDependency.length === 0}>
                {t('taskAddDependency')}
              </button>
            </div>
            {formData.dependencies.length === 0 ? (
              <p className="no-dependencies">{t('taskNoDependencies')}</p>
            ) : (
              <div className="dependencies-list">
                {formData.dependencies.map((dep, index) => (
                  <div key={index} className="dependency-item">
                    <select value={dep.depends_on_task_id} onChange={(e) => handleDependencyChange(index, 'depends_on_task_id', e.target.value)} required>
                      <option value="">{t('taskSelectTask')}</option>
                      {availableTasksForDependency.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                    <select value={dep.dependency_type} onChange={(e) => handleDependencyChange(index, 'dependency_type', e.target.value)}>
                      <option value="finish_to_start">{t('depFinishToStart')}</option>
                      <option value="start_to_start">{t('depStartToStart')}</option>
                      <option value="finish_to_finish">{t('depFinishToFinish')}</option>
                      <option value="start_to_finish">{t('depStartToFinish')}</option>
                    </select>
                    <button type="button" onClick={() => handleRemoveDependency(index)} className="btn-remove-dependency">×</button>
                  </div>
                ))}
              </div>
            )}
            <p className="dependency-hint">{t('taskDependencyHint')}</p>
          </div>

          {task && task.id && (
            <div className="form-group">
              <div className="attachments-header">
                <label>{t('taskFiles')}</label>
                <label className="btn-upload-file" htmlFor="file-upload">
                  {uploadingFile ? t('taskUploading') : t('taskAddFile')}
                </label>
                <input id="file-upload" type="file" onChange={handleFileUpload} disabled={uploadingFile} style={{ display: 'none' }} accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" />
              </div>
              {loadingAttachments ? (
                <p className="attachments-loading">{t('taskLoadingFiles')}</p>
              ) : attachments.length === 0 ? (
                <p className="no-attachments">{t('taskNoFiles')}</p>
              ) : (
                <div className="attachments-list">
                  {attachments.map(file => (
                    <div key={file.id} className="attachment-item">
                      <div className="attachment-info">
                        <span className="attachment-icon">📄</span>
                        <div className="attachment-details">
                          <div className="attachment-name">{file.original_name}</div>
                          <div className="attachment-meta">{formatFileSize(file.file_size)} · {formatDate(file.uploaded_at, lang)}</div>
                        </div>
                      </div>
                      <div className="attachment-actions">
                        <button type="button" onClick={() => handleFileDownload(file.id, file.original_name)} className="btn-download-file" title={t('taskDownload')}>⬇️</button>
                        <button type="button" onClick={() => handleFileDelete(file.id, file.original_name)} className="btn-delete-file" title={t('delete')}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="attachments-hint">{t('taskFileHint')}</p>
            </div>
          )}

          {!task && <p className="create-task-hint">{t('taskCreateHint')}</p>}

          {task && task.id && (
            <div className="form-group reports-section">
              <label>{t('taskReports')}</label>
              {loadingReports ? (
                <p className="muted-text">{t('taskLoadingReports')}</p>
              ) : reports.length === 0 ? (
                <p className="muted-text">{t('taskNoReports')}</p>
              ) : (
                <div className="reports-list">
                  {reports.map(report => (
                    <div key={report.id} className="report-item">
                      <div className="report-header">
                        <span className="report-author">👤 {report.user_name}</span>
                        <span className="report-date">{formatDate(report.submitted_at, lang)}</span>
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
              <button type="button" onClick={() => onDelete(task.id)} className="btn-danger">{t('delete')}</button>
            )}
            <div className="modal-actions-right">
              <button type="button" onClick={onClose} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" className="btn-primary">{task ? t('save') : t('create')}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskModal;
