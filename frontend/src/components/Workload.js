import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { canManageRole } from '../context/TeamContext';
import { getWorkload } from '../services/api';
import { formatDate, formatHours } from '../utils/date';
import apiError from '../utils/apiError';
import Avatar from './Avatar';
import Icon from './Icon';

// Вкладка «Трудоёмкость»: сумма человеко-часов по исполнителям за выбранный период.
// Часы задачи делятся поровну между днями её срока, в период попадает доля пересечения.
// Владелец и админы видят всю команду, участник — только себя.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetRange(kind) {
  const now = new Date();
  if (kind === 'week') {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: iso(monday), to: iso(sunday) };
  }
  const offset = kind === 'nextMonth' ? 1 : 0;
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(first), to: iso(last) };
}

const PRESETS = ['week', 'month', 'nextMonth'];

function Workload({ team }) {
  const { t, lang } = useLanguage();
  const [range, setRange] = useState(() => presetRange('month'));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const everyone = canManageRole(team.role);

  const load = useCallback(async () => {
    if (!range.from || !range.to || range.to < range.from) return;
    setLoading(true);
    try {
      const { data: res } = await getWorkload(team.id, range.from, range.to);
      setData(res);
      setError('');
    } catch (err) {
      setError(apiError(err, t, 'workloadError'));
    } finally {
      setLoading(false);
    }
  }, [team.id, range.from, range.to, t]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const activePreset = PRESETS.find(p => {
    const r = presetRange(p);
    return r.from === range.from && r.to === range.to;
  });
  const capacity = data ? data.working_days * data.hours_per_day : 0;
  const rangeInvalid = range.from && range.to && range.to < range.from;

  return (
    <div className="workload-section view-enter">
      <p className="section-intro">{everyone ? t('workloadIntroAll') : t('workloadIntroSelf')}</p>

      <div className="workload-controls">
        <div className="segmented workload-presets" role="group" aria-label={t('workloadPresetsLabel')}>
          {PRESETS.map(p => (
            <button key={p} type="button" className={`segmented-btn ${activePreset === p ? 'active' : ''}`} aria-pressed={activePreset === p} onClick={() => setRange(presetRange(p))}>
              {t(`workloadPreset_${p}`)}
            </button>
          ))}
        </div>
        <div className="workload-dates">
          <label>
            <span>{t('workloadFrom')}</span>
            <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange(r => ({ ...r, from: e.target.value }))} />
          </label>
          <label>
            <span>{t('workloadTo')}</span>
            <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange(r => ({ ...r, to: e.target.value }))} />
          </label>
        </div>
      </div>

      {rangeInvalid && <div className="error" role="alert">{t('workloadRangeInvalid')}</div>}
      {error && <div className="error" role="alert">{error}</div>}

      {data && !rangeInvalid && (
        <>
          <p className="workload-summary">
            {t('workloadSummary', {
              from: formatDate(data.from, lang), to: formatDate(data.to, lang),
              days: data.working_days, hours: formatHours(capacity, lang)
            })}
          </p>

          <ul className={`workload-list ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
            {data.people.map(person => {
              const percent = capacity ? Math.round((person.hours / capacity) * 100) : 0;
              const level = percent > 100 ? 'over' : percent >= 80 ? 'high' : 'ok';
              const expanded = open.has(person.id);
              const listId = `workload-tasks-${person.id}`;
              return (
                <li key={person.id} className={`workload-person workload-${level}`}>
                  <div className="workload-row">
                    <Avatar name={person.name} src={person.avatar} size="sm" aria-hidden="true" />
                    <span className="workload-name">{person.name}</span>
                    <span className="workload-hours"><strong>{formatHours(person.hours, lang)}</strong> {t('hoursShort')}</span>
                    <span className="workload-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(percent, 100)}%` }} />
                    </span>
                    <span className="workload-percent" title={t('workloadPercentTitle', { hours: formatHours(capacity, lang) })}>
                      {level === 'over' && <Icon name="alert" size={13} />}{percent}%
                    </span>
                    {person.tasks.length > 0 ? (
                      <button type="button" className="btn-icon workload-toggle" onClick={() => toggle(person.id)} aria-expanded={expanded} aria-controls={listId} aria-label={t(expanded ? 'workloadHideTasks' : 'workloadShowTasks', { name: person.name })}>
                        <Icon name="chevron-down" size={16} />
                      </button>
                    ) : <span className="workload-toggle-spacer" aria-hidden="true" />}
                  </div>
                  {person.undated_hours > 0 && (
                    <p className="workload-undated">{t('workloadUndated', { hours: formatHours(person.undated_hours, lang) })}</p>
                  )}
                  {expanded && (
                    <ul className="workload-tasks" id={listId}>
                      {person.tasks.map(task => (
                        <li key={task.task_id}>
                          <Link to={`/project/${task.project_id}?task=${task.task_id}`} className="workload-task-title">{task.title}</Link>
                          <span className="workload-task-meta">
                            {task.project_name}
                            {' · '}
                            {task.start ? `${formatDate(task.start, lang)} — ${formatDate(task.end, lang)}` : t('workloadNoDates')}
                          </span>
                          <span className="workload-task-hours">
                            {task.hours_in_period === null
                              ? t('workloadTaskUndated', { total: formatHours(task.hours_total, lang) })
                              : t('workloadTaskHours', { part: formatHours(task.hours_in_period, lang), total: formatHours(task.hours_total, lang) })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {data.people.every(p => p.tasks.length === 0) && <p className="hint-text">{t('workloadEmpty')}</p>}
          <p className="field-hint workload-note">{t('workloadHowCounted')}</p>
        </>
      )}
    </div>
  );
}

export default Workload;
