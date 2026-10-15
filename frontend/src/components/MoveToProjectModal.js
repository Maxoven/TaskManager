import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useFeedback } from '../context/FeedbackContext';
import { getProject, moveInboxItems } from '../services/api';
import useProjectOptions from '../utils/useProjectOptions';
import apiError from '../utils/apiError';
import Modal from './Modal';
import ProjectSelect from './ProjectSelect';
import Avatar from './Avatar';

// Разбор «Входящих»: перенести одну или несколько записей в проект — выбрать проект,
// колонку и исполнителей. Каждая запись становится обычной задачей проекта.
function MoveToProjectModal({ items, onClose, onMoved }) {
  const { t } = useLanguage();
  const { notify } = useFeedback();
  const { projects, loaded } = useProjectOptions();
  const single = items.length === 1 ? items[0] : null;

  const [projectId, setProjectId] = useState(null);
  const [details, setDetails] = useState(null); // { statuses, members }
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [statusId, setStatusId] = useState('');
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState(single?.due_date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) { setDetails(null); return undefined; }
    let cancelled = false;
    setLoadingDetails(true);
    setError('');
    getProject(projectId)
      .then(({ data }) => {
        if (cancelled) return;
        const members = (data.members || []).filter(m => m.status === 'approved');
        setDetails({ statuses: data.statuses || [], members });
        setStatusId(String(data.statuses?.[0]?.id || ''));
        setAssigneeIds(ids => ids.filter(id => members.some(m => m.id === id)));
      })
      .catch(err => { if (!cancelled) setError(apiError(err, t, 'projectLoadError')); })
      .finally(() => { if (!cancelled) setLoadingDetails(false); });
    return () => { cancelled = true; };
  }, [projectId, t]);

  const toggleAssignee = (id) => setAssigneeIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  const lastStatusId = details?.statuses?.length ? String(details.statuses[details.statuses.length - 1].id) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!projectId || !statusId || saving) return;
    if (startDate && dueDate && dueDate < startDate) { setError(t('moveDatesInvalid')); return; }
    setSaving(true);
    setError('');
    try {
      await moveInboxItems({
        ids: items.map(i => i.id),
        projectId,
        statusId: Number(statusId),
        assigneeIds,
        startDate: startDate || null,
        ...(single ? { dueDate: dueDate || null } : {})
      });
      const name = projects.find(p => p.id === projectId)?.name || '';
      notify.success(single
        ? t('moveDoneOne', { title: single.title, project: name })
        : t('moveDoneMany', { count: items.length, project: name }));
      onMoved(projectId);
    } catch (err) {
      setError(apiError(err, t, 'inboxMoveError'));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={single ? t('moveTitleOne') : t('moveTitleMany', { count: items.length })}
      description={single ? single.title : t('moveDescMany')}
      onClose={onClose}
      className="move-modal"
    >
      <form onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="move-project">{t('moveProjectLabel')}</label>
          {loaded && projects.length === 0
            ? <p className="field-hint">{t('moveNoProjects')}</p>
            : <ProjectSelect id="move-project" projects={projects} value={projectId} onChange={setProjectId} />}
        </div>

        {projectId && (
          loadingDetails || !details ? (
            !error && <p className="field-hint">{t('loading')}</p>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="move-status">{t('moveColumnLabel')}</label>
                <select id="move-status" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
                  {details.statuses.map(s => (
                    <option key={s.id} value={s.id}>
                      {String(s.id) === lastStatusId ? `${s.name} — ${t('moveColumnDone')}` : s.name}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="form-fieldset">
                <legend className="form-legend">{t('moveAssigneesLabel')}</legend>
                {details.members.length === 0 ? (
                  <p className="field-hint">{t('moveNoMembers')}</p>
                ) : (
                  <ul className="move-people">
                    {details.members.map(m => (
                      <li key={m.id}>
                        <label className={`move-person ${assigneeIds.includes(m.id) ? 'move-person-on' : ''}`}>
                          <input type="checkbox" checked={assigneeIds.includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                          <Avatar name={m.name} src={m.avatar} size="xs" aria-hidden="true" />
                          <span>{m.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="field-hint">{t('moveAssigneesHint')}</p>
              </fieldset>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="move-start">{t('taskStartDate')}</label>
                  <input id="move-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label htmlFor="move-due">{t('taskEndDate')}</label>
                  {single
                    ? <input id="move-due" type="date" value={dueDate} min={startDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
                    : <p className="field-hint move-due-hint">{t('moveDueKept')}</p>}
                </div>
              </div>
            </>
          )
        )}

        {error && <p className="field-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <div className="modal-actions-right">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="btn-primary" disabled={!projectId || !statusId || saving || loadingDetails}>
              {saving ? t('saving') : t('moveSubmit')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default MoveToProjectModal;
