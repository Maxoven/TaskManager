import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getProjectFiles, uploadProjectFile, downloadProjectFile, deleteProjectFile } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { formatDate } from '../utils/date';
import { ACCEPT_ATTR, formatFileSize, splitValidFiles, saveBlob } from '../utils/files';
import apiError from '../utils/apiError';
import Modal from './Modal';
import Icon from './Icon';

// Файлы самого проекта (договор, ТЗ, смета — то, что относится к проекту целиком, а не к задаче).
// Добавлять может каждый участник проекта; удалять — тот, кто загрузил, или тот, кто ведёт проект.
function ProjectFilesModal({ project, user, canManage, onClose, onChanged }) {
  const { t, lang } = useLanguage();
  const { notify, confirm } = useFeedback();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getProjectFiles(project.id);
      setFiles(data);
    } catch (err) {
      setError(apiError(err, t, 'filesFetchError'));
    } finally {
      setLoading(false);
    }
  }, [project.id, t]);

  useEffect(() => { load(); }, [load]);

  const handleSelected = async (e) => {
    const { valid, problems } = splitValidFiles(e.target.files || [], t);
    e.target.value = '';
    setError(problems.join(' '));
    if (valid.length === 0) return;
    setUploading(true);
    const failed = [];
    for (const file of valid) {
      try { await uploadProjectFile(project.id, file); }
      catch (err) { failed.push(`${file.name}: ${apiError(err, t, 'fileUploadError')}`); }
    }
    if (failed.length) setError([...problems, ...failed].join(' '));
    else if (valid.length) notify.success(t('projectFilesUploaded', { count: valid.length }));
    await load();
    onChanged?.();
    setUploading(false);
  };

  const handleDownload = async (file) => {
    try {
      const response = await downloadProjectFile(project.id, file.id);
      saveBlob(response.data, file.original_name);
    } catch {
      notify.error(t('fileDownloadError'));
    }
  };

  const handleDelete = async (file) => {
    const ok = await confirm({
      title: t('deleteFileTitle', { name: file.original_name }),
      message: t('projectFileDeleteMessage'),
      confirmLabel: t('delete'),
      danger: true
    });
    if (!ok) return;
    try {
      await deleteProjectFile(project.id, file.id);
      notify.success(t('fileDeletedToast', { name: file.original_name }));
      await load();
      onChanged?.();
    } catch (err) {
      notify.error(apiError(err, t, 'fileDeleteError'));
    }
  };

  return (
    <Modal
      title={t('projectFilesTitle')}
      description={t('projectFilesIntro', { name: project.name })}
      onClose={onClose}
      className="project-files-modal"
    >
      {loading ? (
        <p className="attachments-loading">{t('taskLoadingFiles')}</p>
      ) : files.length === 0 ? (
        <div className="project-files-empty">
          <span className="project-files-empty-icon" aria-hidden="true"><Icon name="paperclip" size={22} /></span>
          <p>{t('projectFilesEmpty')}</p>
        </div>
      ) : (
        <ul className="attachments-list">
          {files.map(file => {
            const canDelete = canManage || file.uploaded_by === user?.id;
            return (
              <li key={file.id} className="attachment-item">
                <div className="attachment-info">
                  <span className="attachment-icon" aria-hidden="true"><Icon name="file" size={18} /></span>
                  <div className="attachment-details">
                    <div className="attachment-name">{file.original_name}</div>
                    <div className="attachment-meta">
                      {formatFileSize(file.file_size)} · {formatDate(file.uploaded_at, lang)}{file.uploader_name ? ` · ${file.uploader_name}` : ''}
                    </div>
                  </div>
                </div>
                <div className="attachment-actions">
                  <button type="button" onClick={() => handleDownload(file)} className="btn-small"><Icon name="download" size={14} />{t('taskDownload')}</button>
                  {canDelete && (
                    <button type="button" onClick={() => handleDelete(file)} className="btn-small btn-small-danger" aria-label={t('deleteFileAria', { name: file.original_name })}>{t('delete')}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="field-hint">{t('taskFileHint')}</p>

      <div className="modal-actions">
        <div className="modal-actions-right">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('close')}</button>
          <input ref={inputRef} type="file" multiple hidden onChange={handleSelected} accept={ACCEPT_ATTR} aria-label={t('projectFilesAdd')} />
          <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <span className="spinner" aria-hidden="true" /> : <Icon name="paperclip" size={15} />}
            {uploading ? t('taskUploading') : t('projectFilesAdd')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ProjectFilesModal;
