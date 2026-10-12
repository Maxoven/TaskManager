import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { canManageRole } from '../context/TeamContext';
import { getWorkload } from '../services/api';
import { formatDate, formatHours, taskDays, HOURS_PER_DAY } from '../utils/date';
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

// Часы в отчёте — с одним знаком: доля часов за период редко бывает «круглой»
const h1 = (value, lang) => formatHours(value, lang, 1);

// CSV для Excel: точка с запятой и BOM, чтобы кириллица открывалась без настройки
function downloadCsv(data, t) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const num = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
  const lines = [[t('csvPerson'), t('csvProject'), t('csvTask'), t('csvStart'), t('csvEnd'), t('csvHoursInPeriod'), t('csvHoursTotal')].map(cell).join(';')];
  data.people.forEach(p => {
    p.tasks.forEach(task => {
      lines.push([cell(p.name), cell(task.project_name), cell(task.title), cell(task.start || ''), cell(task.end || ''), num(task.hours_in_period), num(task.hours_total)].join(';'));
    });
    lines.push([cell(p.name), cell(t('csvPersonTotal')), '', '', '', num(p.hours), ''].join(';'));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workload_${data.from}_${data.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
          <button type="button" className="btn-secondary workload-export" onClick={() => data && downloadCsv(data, t)} disabled={!data || rangeInvalid}>
            <Icon name="download" size={16} />{t('workloadExport')}
          </button>
        </div>
      </div>

      {rangeInvalid && <div className="error" role="alert">{t('workloadRangeInvalid')}</div>}
      {error && <div className="error" role="alert">{error}</div>}

      {data && !rangeInvalid && (
        <>
          <p className="workload-summary">
            {t(everyone ? 'workloadSummary' : 'workloadSummarySelf', {
              from: formatDate(data.from, lang), to: formatDate(data.to, lang),
              days: data.working_days, hours: formatHours(capacity, lang)
            })}
          </p>

          <ul className={`workload-list ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
            <li className="workload-head" aria-hidden="true">
              <span />
              <span>{t('workloadColPerson')}</span>
              <span>{t('workloadColHours')}</span>
              <span>{t('workloadColLoad')}</span>
              <span />
              <span />
            </li>
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
                    <span className="workload-hours"><strong>{h1(person.hours, lang)}</strong> {t('hoursShort')}</span>
                    <span className="workload-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(percent, 100)}%` }} />
                    </span>
                    <span className="workload-percent" title={t('workloadPercentTitle', { hours: formatHours(capacity, lang) })}>
                      {level === 'over' && <Icon name="alert" size={13} />}{percent}%
                      <span className="visually-hidden"> {t('workloadPercentTitle', { hours: formatHours(capacity, lang) })}</span>
                    </span>
                    {person.tasks.length > 0 ? (
                      <button type="button" className="btn-icon workload-toggle" onClick={() => toggle(person.id)} aria-expanded={expanded} aria-controls={listId} aria-label={t(expanded ? 'workloadHideTasks' : 'workloadShowTasks', { name: person.name })}>
                        <Icon name="chevron-down" size={16} />
                      </button>
                    ) : <span className="workload-toggle-spacer" aria-hidden="true" />}
                  </div>
                  {person.undated_hours > 0 && (
                    <p className="workload-undated">{t('workloadUndated', { hours: h1(person.undated_hours, lang) })}</p>
                  )}
                  {expanded && (
                    <ul className="workload-tasks" id={listId}>
                      {person.tasks.map(task => {
                        // Задача, в срок которой часы исполнителя не помещаются (8 ч в день)
                        const days = task.start ? taskDays(task.start, task.end) : null;
                        const over = days && task.hours_total / HOURS_PER_DAY > days;
                        return (
                        <li key={task.task_id} className={over ? 'is-over' : ''}>
                          <Link to={`/project/${task.project_id}?task=${task.task_id}`} className="workload-task-title">
                            {over && <span className="workload-task-over" title={t('workloadTaskOver')}><Icon name="alert" size={13} /><span className="visually-hidden">{t('workloadTaskOver')}: </span></span>}
                            {task.title}
                          </Link>
                          <span className="workload-task-meta">
                            {task.project_name}
                            {' · '}
                            {task.start ? `${formatDate(task.start, lang)} — ${formatDate(task.end, lang)}` : t('workloadNoDates')}
                          </span>
                          <span className="workload-task-hours">
                            {task.hours_in_period === null
                              ? t('workloadTaskUndated', { total: h1(task.hours_total, lang) })
                              : t('workloadTaskHours', { part: h1(task.hours_in_period, lang), total: h1(task.hours_total, lang) })}
                          </span>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {everyone && data.people.length > 1 && (() => {
              const total = data.people.reduce((sum, p) => sum + p.hours, 0);
              const teamCapacity = capacity * data.people.length;
              const pct = teamCapacity ? Math.round((total / teamCapacity) * 100) : 0;
              return (
                <li className="workload-total">
                  {t('workloadTeamTotal', { hours: h1(total, lang), capacity: formatHours(teamCapacity, lang), percent: pct })}
                </li>
              );
            })()}
          </ul>
          {data.people.every(p => p.tasks.length === 0) && <p className="hint-text">{t('workloadEmpty')}</p>}
          <p className="field-hint workload-note">{t('workloadHowCounted')}</p>
        </>
      )}
    </div>
  );
}

export default Workload;
