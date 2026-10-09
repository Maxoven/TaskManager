import React, { useState, useRef, useEffect, useMemo } from 'react';
import { format, addDays, subDays, differenceInDays, startOfDay, eachMonthOfInterval, endOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useLanguage } from '../context/LanguageContext';
import { parseDate, formatDate } from '../utils/date';
import Icon from './Icon';
import Avatar from './Avatar';
import './GanttChart.css';

const MIN_PERIOD_DAYS = 365;
const DAYS_BEFORE_TODAY = 60;
const DAY_PX = 16;         // пикселей на день
const ROW_H = 44;          // высота строки (то же значение — --gantt-row в GanttChart.css)

// Состояние полосы: цвет + значок (в полосе и в легенде), чтобы не полагаться только на цвет
const BAR_ICONS = { done: 'check', report: 'file-check', overdue: 'alert' };

// Задачи без обеих дат на диаграмме не помещаются — показываем их списком, чтобы не «пропадали»
function UndatedTasks({ tasks, onTaskClick }) {
  const { t } = useLanguage();
  if (tasks.length === 0) return null;
  return (
    <details className="gantt-undated">
      <summary><Icon name="chevron-right" size={14} className="gantt-undated-chevron" />{t('ganttUndatedSummary', { count: tasks.length })}</summary>
      <p className="field-hint">{t('ganttUndatedHint')}</p>
      <ul className="gantt-undated-list">
        {tasks.map(task => (
          <li key={task.id}>
            <button type="button" className="btn-link" onClick={() => onTaskClick(task)}>{task.title}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GanttChart({ tasks, onTaskClick, onAddTask, members }) {
  const { t, lang } = useLanguage();
  const dateLocale = lang === 'ru' ? ru : undefined;
  const today = startOfDay(new Date());
  const [filterAssignee, setFilterAssignee] = useState('all');
  const scrollRef = useRef(null);

  const datedTasks = tasks.filter(task => task.start_date && task.end_date);
  const undatedTasks = tasks.filter(task => !(task.start_date && task.end_date));

  // Период подстраивается под задачи: раньше окно было жёстким (60 дней назад, год всего),
  // и задачи за его пределами молча оказывались вне шкалы
  const todayTime = today.getTime();
  const { viewStart, periodDays } = useMemo(() => {
    const base = new Date(todayTime);
    let start = subDays(base, DAYS_BEFORE_TODAY);
    let end = addDays(start, MIN_PERIOD_DAYS - 1);
    tasks.forEach(task => {
      if (!task.start_date || !task.end_date) return;
      const taskStart = subDays(startOfDay(parseDate(task.start_date)), 14);
      const taskEnd = addDays(startOfDay(parseDate(task.end_date)), 30);
      if (taskStart < start) start = taskStart;
      if (taskEnd > end) end = taskEnd;
    });
    return { viewStart: start, periodDays: differenceInDays(end, start) + 1 };
  }, [tasks, todayTime]);

  const viewEnd = addDays(viewStart, periodDays - 1);
  const totalWidth = periodDays * DAY_PX;

  const tasksWithDates = datedTasks
    .filter(t => {
      if (filterAssignee === 'all') return true;
      return t.assignees && t.assignees.some(a => a.id === parseInt(filterAssignee));
    });

  // Позиция в пикселях
  const dateToPx = (date) => differenceInDays(startOfDay(parseDate(date)), viewStart) * DAY_PX;

  // Скролл к сегодняшнему дню при загрузке
  useEffect(() => {
    if (scrollRef.current) {
      // Показываем «сегодня», но так, чтобы начало самой ранней задачи тоже было видно
      const todayPx = differenceInDays(today, viewStart) * DAY_PX;
      const starts = tasks.filter(t => t.start_date).map(t => dateToPx(t.start_date));
      const earliest = starts.length ? Math.min(...starts) : todayPx;
      const target = Math.max(Math.min(todayPx - 100, earliest - 40), todayPx - scrollRef.current.clientWidth + 160);
      scrollRef.current.scrollLeft = Math.max(0, target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getTaskBar = (task) => {
    const left = dateToPx(task.start_date);
    const right = dateToPx(task.end_date) + DAY_PX;
    return { left, width: Math.max(4, right - left) };
  };

  const getTaskState = (task) => {
    if (task.is_done) return 'done';
    if (task.has_report) return 'report';
    if (task.end_date && parseDate(task.end_date) < today) return 'overdue';
    return 'progress';
  };

  // Месяцы для шапки
  const months = eachMonthOfInterval({ start: viewStart, end: viewEnd });

  // Линия сегодня
  const todayPx = dateToPx(today);

  // Стрелки связей
  const renderArrows = () => {
    const arrows = [];
    tasksWithDates.forEach((task, toIndex) => {
      if (!task.dependencies || task.dependencies.length === 0) return;
      task.dependencies.forEach(dep => {
        const fromTask = tasksWithDates.find(t => t.id === dep.depends_on_task_id);
        if (!fromTask) return;
        const fromIndex = tasksWithDates.indexOf(fromTask);
        const fromBar = getTaskBar(fromTask);
        const toBar = getTaskBar(task);

        // Координаты: конец predecessor → начало successor
        const x1 = fromBar.left + fromBar.width;
        const y1 = fromIndex * ROW_H + ROW_H / 2;
        const x2 = toBar.left;
        const y2 = toIndex * ROW_H + ROW_H / 2;

        const midX = x1 + Math.max(12, (x2 - x1) / 2);

        arrows.push(
          <g key={`${task.id}-${dep.depends_on_task_id}`}>
            <path
              d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
              className="gantt-arrow"
              fill="none"
              strokeWidth="1.5"
              strokeDasharray="4 2"
              markerEnd="url(#arrow)"
            />
          </g>
        );
      });
    });
    return arrows;
  };

  const scrollToToday = () => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayPx - 100);
  };

  if (datedTasks.length === 0) {
    return (
      <div className="gantt-container">
        <div className="gantt-empty empty-state">
          <div className="empty-state-icon" aria-hidden="true"><Icon name="timeline" size={26} /></div>
          <p className="empty-state-title">{tasks.length === 0 ? t('ganttNoTasksAtAll') : t('ganttNoTasks')}</p>
          <p>{tasks.length === 0 ? t('ganttNoTasksAtAllHint') : t('ganttNoTasksHint')}</p>
          {tasks.length === 0 && onAddTask && (
            <button type="button" className="btn-primary" onClick={onAddTask}><Icon name="plus" />{t('newTaskBtn')}</button>
          )}
        </div>
        {undatedTasks.length > 0 && (
          <div className="gantt-undated gantt-undated-open">
            <p className="field-hint">{t('ganttUndatedHint')}</p>
            <ul className="gantt-undated-list">
              {undatedTasks.map(task => (
                <li key={task.id}>
                  <button type="button" className="btn-link" onClick={() => onTaskClick(task)}>{task.title}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const bodyHeight = tasksWithDates.length * ROW_H;

  return (
    <div className="gantt-container">
      {/* Панель управления */}
      <div className="gantt-controls">
        <div className="gantt-nav">
          <span className="gantt-period-label">
            {format(viewStart, 'd MMM yyyy', { locale: dateLocale })} — {format(viewEnd, 'd MMM yyyy', { locale: dateLocale })}
          </span>
          <button type="button" className="btn-small" onClick={scrollToToday}>{t('ganttGoToday')}</button>
        </div>

        <div className="gantt-filter">
          <label htmlFor="gantt-assignee" className="visually-hidden">{t('filterAssignee')}</label>
          <select id="gantt-assignee" className="gantt-assignee-filter" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="all">{t('ganttAllAssignees')}</option>
            {members && members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="gantt-legend">
          {[['progress', 'ganttInProgress'], ['done', 'ganttDone'], ['report', 'ganttReportSent'], ['overdue', 'ganttOverdue']].map(([state, key]) => (
            <div key={state} className="legend-item">
              <span className={`legend-color gantt-bar-${state}`} aria-hidden="true">
                {BAR_ICONS[state] && <Icon name={BAR_ICONS[state]} size={11} />}
              </span>
              <span>{t(key)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="field-hint gantt-hint">{t('ganttHint')}</p>
      <UndatedTasks tasks={undatedTasks} onTaskClick={onTaskClick} />

      {tasksWithDates.length === 0 && (
        <div className="gantt-empty empty-state">
          <p className="empty-state-title">{t('ganttNoTasksForAssignee')}</p>
          <button type="button" className="btn-secondary" onClick={() => setFilterAssignee('all')}>{t('ganttShowAll')}</button>
        </div>
      )}

      {/* Основная таблица */}
      {tasksWithDates.length > 0 && (
      <div className="gantt-chart">
        <div className="gantt-layout">

          {/* Фиксированная колонка с названиями */}
          <div className="gantt-sidebar-col">
            <div className="gantt-sidebar-header">{t('ganttTaskColumn')}</div>
            {tasksWithDates.length === 0 ? null : tasksWithDates.map(task => (
              <div key={task.id} className="gantt-sidebar" onClick={() => onTaskClick(task)}>
                <div className="gantt-task-info">
                  <div className="gantt-task-title">{task.title}</div>
                  {task.assignees && task.assignees.length > 0 && (
                    <div className="gantt-task-assignees">
                      {task.assignees.map(a => (
                        <Avatar key={a.id} name={a.name} size="xs" className="gantt-assignee-badge" title={a.name} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Скроллируемая часть */}
          <div className="gantt-scroll-area" ref={scrollRef}>
            {/* Шапка месяцев */}
            <div className="gantt-timeline-header" style={{ width: totalWidth }}>
              {months.map((monthStart, i) => {
                const mLeftPx = Math.max(0, dateToPx(monthStart));
                const mEnd = endOfMonth(monthStart);
                const mEndPx = Math.min(totalWidth, dateToPx(mEnd) + DAY_PX);
                return (
                  <div key={i} className="gantt-month-header" style={{ left: mLeftPx, width: mEndPx - mLeftPx }}>
                    {format(monthStart, 'LLLL yyyy', { locale: dateLocale })}
                  </div>
                );
              })}
              {todayPx >= 0 && todayPx <= totalWidth && (
                <span className="gantt-today-marker" style={{ left: todayPx }} aria-hidden="true" />
              )}
            </div>

            {/* Тело: строки + SVG стрелки */}
            <div className="gantt-body" style={{ width: totalWidth, height: bodyHeight }}>

              {/* Фоновые строки */}
              {tasksWithDates.map((task, i) => (
                <div key={task.id} className="gantt-row-bg" style={{ top: i * ROW_H, width: totalWidth }} />
              ))}

              {/* Вертикальные линии месяцев */}
              {months.map((m, i) => {
                const px = dateToPx(m);
                if (px < 0 || px > totalWidth) return null;
                return <div key={i} className="gantt-month-line" style={{ left: px }} />;
              })}

              {/* Линия сегодня */}
              {todayPx >= 0 && todayPx <= totalWidth && (
                <div className="gantt-today-line" style={{ left: todayPx }} />
              )}

              {/* SVG стрелки связей */}
              <svg className="gantt-arrows" width={totalWidth} height={bodyHeight} aria-hidden="true">
                <defs>
                  <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path className="gantt-arrow-head" d="M 0 0 L 6 3 L 0 6 z" />
                  </marker>
                </defs>
                {renderArrows()}
              </svg>

              {/* Полосы задач */}
              {tasksWithDates.map((task, i) => {
                const bar = getTaskBar(task);
                const state = getTaskState(task);
                return (
                  <div
                    key={task.id}
                    className={`gantt-task-bar gantt-bar-${state}`}
                    style={{
                      left: bar.left,
                      width: bar.width,
                      top: i * ROW_H + 6
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => onTaskClick(task)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(task); } }}
                    title={`${task.title}\n${formatDate(task.start_date, lang)} – ${formatDate(task.end_date, lang)}`}
                  >
                    {BAR_ICONS[state] && <Icon name={BAR_ICONS[state]} size={13} />}
                    <span className="gantt-task-bar-label">{task.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

export default GanttChart;
