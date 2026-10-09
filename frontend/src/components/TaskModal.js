import React, { useState, useEffect, useMemo, useRef } from 'react';
import { uploadFile, getTaskAttachments, downloadFile, deleteFile, getTaskReports } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { toInputDate, formatDate } from '../utils/date';
import apiError from '../utils/apiError';
import Modal from './Modal';
import Icon from './Icon';
import Avatar from './Avatar';
import './TaskModal.css';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'rar'];

const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const initialForm = (task, defaultStatusId) => ({
  title: task?.title || '',
  description: task?.description || '',
  statusId: task?.status_id ?? defaultStatusId ?? '',
  startDate: toInputDate(task?.start_date),
  endDate: toInputDate(task?.end_date),
  assigneeIds: task?.assignees?.map(a => a.id) || [],
  // Тип связи в интерфейсе больше не выбирается, но сохранённое значение не теряем
  dependencies: task?.dependencies?.map(d => ({
    depends_on_task_id: d.depends_on_task_id,
    dependency_type: d.dependency_type || 'finish_to_start'
  })) || []
});

// onSave(formData, files) → Promise<boolean>: true — сохранено, окно можно закрыть
function TaskModal({ task, members, statuses, defaultStatusId, onSave, onDelete, onClose, allTasks, onAttachmentsChange }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const initial = useMemo(() => initialForm(task, defaultStatusId), [task, defaultStatusId]);
  const [formData, setFormData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]); // файлы новой задачи — загрузятся после создания
  const [uploadingFile, setUploadingFile] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [fileError, setFileError] = useState('');
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const fileInputRef = useRef(null);
  const isEdit = !!(task && task.id);
  const doneStatusId = statuses?.length ? statuses[statuses.length - 1].id : null;

  useEffect(() => {
    setFormData(initial);
    if (isEdit) { loadAttachments(); loadReports(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const loadReports = async () => {
    setLoadingReports(true);
    try { const r = await getTaskReports(task.id); setReports(r.data || []); }
    catch (e) { /* блок отчётов просто останется пустым */ }
    finally { setLoadingReports(false); }
  };

  const loadAttachments = async () => {
    setLoadingAttachments(true);
    try { const r = await getTaskAttachments(task.id); setAttachments(r.data || []); }
    catch (e) { setFileError(apiError(e, t, 'filesLoadError')); }
    finally { setLoadingAttachments(false); }
  };

  const isDirty = pendingFiles.length > 0 || JSON.stringify(formData) !== JSON.stringify(initial);

  // Закрытие крестиком, фоном или Escape не должно молча терять введённое
  const requestClose = async () => {
    if (saving) return;
    if (isDirty) {
      const ok = await confirm({
        title: t('unsavedTitle'),
        message: t('unsavedMessage'),
        confirmLabel: t('unsavedDiscard'),
        cancelLabel: t('unsavedStay'),
        focusCancel: true
      });
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const payload = {
      ...formData,
      statusId: formData.statusId || undefined,
      dependencies: formData.dependencies.filter(d => d.depends_on_task_id)
    };
    const saved = await onSave(payload, pendingFiles);
    if (!saved) setSaving(false);
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
    setFormData(prev => ({ ...prev, dependencies: [...prev.dependencies, { depends_on_task_id: '', dependency_type: 'finish_to_start' }] }));
  };

  const handleRemoveDependency = (index) => {
    setFormData(prev => ({ ...prev, dependencies: prev.dependencies.filter((_, i) => i !== index) }));
  };

  const handleDependencyChange = (index, value) => {
    setFormData(prev => ({
      ...prev,
      dependencies: prev.dependencies.map((dep, i) => i === index ? { ...dep, depends_on_task_id: parseInt(value, 10) || '' } : dep)
    }));
  };

  // Проверяем размер и формат до отправки, чтобы сразу сказать, какой файл не подошёл
  const splitValidFiles = (fileList) => {
    const valid = [];
    const problems = [];
    Array.from(fileList).forEach(file => {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) problems.push(t('taskFileTypeError', { name: file.name }));
      else if (file.size > MAX_FILE_SIZE) problems.push(t('taskFileSizeErrorNamed', { name: file.name }));
      else valid.push(file);
    });
    return { valid, problems };
  };

  const handleFilesSelected = async (e) => {
    const { valid, problems } = splitValidFiles(e.target.files || []);
    e.target.value = '';
    setFileError(problems.join(' '));
    if (valid.length === 0) return;

    if (!isEdit) {
      setPendingFiles(prev => [...prev, ...valid]);
      return;
    }
    setUploadingFile(true);
    const failed = [];
    for (const file of valid) {
      try { await uploadFile(task.id, file); }
      catch (error) { failed.push(`${file.name}: ${apiError(error, t, 'fileUploadError')}`); }
    }
    if (failed.length) setFileError([...problems, ...failed].join(' '));
    await loadAttachments();
    if (onAttachmentsChange) onAttachmentsChange();
    setUploadingFile(false);
  };

  const handleFileDownload = async (fileId, fileName) => {
    try {
      const response = await downloadFile(task.id, fileId);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url; link.setAttribute('download', fileName);
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) { notify.error(t('fileDownloadError')); }
  };

  const handleFileDelete = async (fileId, fileName) => {
    const ok = await confirm({
      title: t('deleteFileTitle', { name: fileName }),
      message: t('deleteFileMessage'),
      confirmLabel: t('delete'),
      danger: true
    });
    if (!ok) return;
    try {
      await deleteFile(task.id, fileId);
      await loadAttachments();
      if (onAttachmentsChange) onAttachmentsChange();
    } catch (error) { notify.error(apiError(error, t, 'fileDeleteError')); }
  };

  const otherTasks = allTasks?.filter(other => other.id !== task?.id) || [];
  const chosenIds = formData.dependencies.map(d => d.depends_on_task_id).filter(Boolean);
  const hasOthers = members.length > 1;

  return (
    <Modal title={isEdit ? t('editTaskTitle') : t('createTaskTitle')} onClose={requestClose} className="task-modal">
      {/* Широкий экран: слева суть задачи (название, описание, файлы, отчёты),
          справа — параметры (колонка, сроки, исполнители, зависимости). Порядок в разметке
          прежний, поэтому на телефоне и при переходе по Tab всё идёт сверху вниз. */}
      <form onSubmit={handleSubmit} className="task-form">
        <div className="task-form-grid">
        <div className="task-form-main">
        <div className="form-group">
          <label htmlFor="task-title">{t('taskTitleLabel')} <span className="required-mark" aria-hidden="true">*</span></label>
          <input id="task-title" type="text" autoFocus={!isEdit} value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required maxLength={255} placeholder={t('taskTitlePlaceholder')} />
        </div>

        <div className="form-group">
          <label htmlFor="task-description">{t('taskDescLabel')}</label>
          <textarea id="task-description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder={t('taskDescPlaceholder')} rows="4" />
        </div>
        </div>

        <div className="task-form-side">
        {statuses?.length > 0 && (
          <div className="form-group">
            <label htmlFor="task-status">{t('taskStatusLabel')}</label>
            <select id="task-status" value={formData.statusId} onChange={(e) => setFormData({ ...formData, statusId: parseInt(e.target.value, 10) })} aria-describedby="task-status-hint">
              {statuses.map(status => (
                <option key={status.id} value={status.id}>
                  {status.name}{status.id === doneStatusId ? ` — ${t('columnDoneOption')}` : ''}
                </option>
              ))}
            </select>
            <p id="task-status-hint" className="field-hint">
              {formData.statusId === doneStatusId ? t('taskStatusDoneHint') : t('taskStatusHint')}
            </p>
          </div>
        )}

        <fieldset className="form-fieldset">
          <legend className="visually-hidden">{t('taskDatesLegend')}</legend>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="task-start">{t('taskStartDate')}</label>
              <input id="task-start" type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} max={formData.endDate || undefined} />
            </div>
            <div className="form-group">
              <label htmlFor="task-end">{t('taskEndDate')}</label>
              <input id="task-end" type="date" value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} min={formData.startDate || undefined} />
            </div>
          </div>
          <p className="field-hint task-dates-hint">{t('taskDatesHint')}</p>
        </fieldset>

        <fieldset className="form-group form-fieldset">
          <legend className="form-legend">{t('taskAssignees')}</legend>
          <div className="assignees-select">
            {members.map(member => (
              <label key={member.id} className="assignee-checkbox">
                <input type="checkbox" checked={formData.assigneeIds.includes(member.id)} onChange={() => handleAssigneeToggle(member.id)} />
                <Avatar name={member.name} size="xs" aria-hidden="true" />
                <span>{member.name}</span>
              </label>
            ))}
          </div>
          <p className="field-hint">{hasOthers ? t('taskAssigneesHint') : t('taskAssigneesAloneHint')}</p>
        </fieldset>

        {(otherTasks.length > 0 || formData.dependencies.length > 0) && (
          <fieldset className="form-group form-fieldset">
            <legend className="form-legend">{t('taskDependencies')}</legend>
            <p className="field-hint dependency-hint">{t('taskDependencyHint')}</p>
            {formData.dependencies.length > 0 && (
              <ul className="dependencies-list">
                {formData.dependencies.map((dep, index) => (
                  <li key={index} className="dependency-item">
                    <select
                      value={dep.depends_on_task_id}
                      onChange={(e) => handleDependencyChange(index, e.target.value)}
                      aria-label={t('taskSelectTask')}
                    >
                      <option value="">{t('taskSelectTask')}</option>
                      {otherTasks
                        .filter(other => other.id === dep.depends_on_task_id || !chosenIds.includes(other.id))
                        .map(other => <option key={other.id} value={other.id}>{other.title}</option>)}
                    </select>
                    <button type="button" onClick={() => handleRemoveDependency(index)} className="btn-icon btn-remove-dependency" aria-label={t('taskRemoveDependency')} title={t('taskRemoveDependency')}><Icon name="x" size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={handleAddDependency} className="btn-small btn-add-dependency" disabled={chosenIds.length >= otherTasks.length || formData.dependencies.some(d => !d.depends_on_task_id)}>
              <Icon name="plus" size={14} />
              {t('taskAddDependency')}
            </button>
          </fieldset>
        )}
        </div>

        <div className="task-form-main task-form-extra">
        <fieldset className="form-group form-fieldset">
          <legend className="form-legend">{t('taskFiles')}</legend>
          {isEdit && loadingAttachments ? (
            <p className="attachments-loading">{t('taskLoadingFiles')}</p>
          ) : (
            <>
              {isEdit && attachments.length > 0 && (
                <ul className="attachments-list">
                  {attachments.map(file => (
                    <li key={file.id} className="attachment-item">
                      <div className="attachment-info">
                        <span className="attachment-icon" aria-hidden="true"><Icon name="file" size={18} /></span>
                        <div className="attachment-details">
                          <div className="attachment-name">{file.original_name}</div>
                          <div className="attachment-meta">{formatFileSize(file.file_size)} · {formatDate(file.uploaded_at, lang)}{file.uploader_name ? ` · ${file.uploader_name}` : ''}</div>
                        </div>
                      </div>
                      <div className="attachment-actions">
                        <button type="button" onClick={() => handleFileDownload(file.id, file.original_name)} className="btn-small"><Icon name="download" size={14} />{t('taskDownload')}</button>
                        <button type="button" onClick={() => handleFileDelete(file.id, file.original_name)} className="btn-small btn-small-danger" aria-label={t('deleteFileAria', { name: file.original_name })}>{t('delete')}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!isEdit && pendingFiles.length > 0 && (
                <ul className="attachments-list attachments-list-pending">
                  {pendingFiles.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="attachment-item">
                      <div className="attachment-info">
                        <span className="attachment-icon" aria-hidden="true"><Icon name="file" size={18} /></span>
                        <div className="attachment-details">
                          <div className="attachment-name">{file.name}</div>
                          <div className="attachment-meta">{formatFileSize(file.size)} · {t('taskFilePending')}</div>
                        </div>
                      </div>
                      <div className="attachment-actions">
                        <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== index))} className="btn-small" aria-label={t('removeFileAria', { name: file.name })}>{t('taskFileRemove')}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesSelected} accept={ALLOWED_EXT.map(ext => `.${ext}`).join(',')} aria-label={t('taskAddFile')} />
          <button type="button" className="btn-small btn-upload-file" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}>
            {uploadingFile ? <span className="spinner" aria-hidden="true" /> : <Icon name="paperclip" size={14} />}
            {uploadingFile ? t('taskUploading') : t('taskAddFile')}
          </button>
          {fileError && <p className="field-error" role="alert">{fileError}</p>}
          <p className="field-hint attachments-hint">{t('taskFileHint')}</p>
        </fieldset>

        {isEdit && (
          <section className="form-group reports-section" aria-labelledby="task-reports-title">
            <h3 id="task-reports-title" className="form-legend">{t('taskReports')}</h3>
            {loadingReports ? (
              <p className="muted-text">{t('taskLoadingReports')}</p>
            ) : reports.length === 0 ? (
              <p className="field-hint">{t('taskNoReports')}</p>
            ) : (
              <ul className="reports-list">
                {reports.map(report => (
                  <li key={report.id} className="report-item">
                    <div className="report-header">
                      <span className="report-author"><Avatar name={report.user_name} size="xs" aria-hidden="true" />{report.user_name}</span>
                      <span className="report-date">{formatDate(report.submitted_at, lang)}</span>
                    </div>
                    <p className="report-text">{report.report_text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        </div>
        </div>

        <div className="modal-actions">
          {onDelete && isEdit && (
            <button type="button" onClick={() => onDelete(task)} className="btn-ghost btn-ghost-danger btn-delete-task" disabled={saving}><Icon name="trash" /><span className="btn-delete-task-text">{t('deleteTaskBtn')}</span></button>
          )}
          <div className="modal-actions-right">
            <button type="button" onClick={requestClose} className="btn-secondary" disabled={saving}>{t('cancel')}</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('saving') : (isEdit ? t('save') : t('createTaskSubmit'))}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default TaskModal;
