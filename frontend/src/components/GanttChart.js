import React, { useState, useRef } from 'react';
import { format, addDays, addMonths, subDays, subMonths, differenceInDays, startOfDay, eachDayOfInterval, isToday, isWeekend } from 'date-fns';
import { ru } from 'date-fns/locale';
import './GanttChart.css';

const PERIOD_OPTIONS = [
  { label: '1 мес', days: 30 },
  { label: '3 мес', days: 90 },
  { label: '6 мес', days: 180 },
  { label: '1 год', days: 365 },
];

function GanttChart({ tasks, onTaskClick, members }) {
  const today = startOfDay(new Date());
  const [viewStart, setViewStart] = useState(subDays(today, 15));
  const [periodDays, setPeriodDays] = useState(90);
  const chartRef = useRef(null);

  const tasksWithDates = tasks.filter(t => t.start_date && t.end_date);
  const viewEnd = addDays(viewStart, periodDays - 1);
  const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
  const totalDays = periodDays;

  // Навигация
  const goBack = () => setViewStart(prev => subDays(prev, Math.round(periodDays / 3)));
  const goForward = () => setViewStart(prev => addDays(prev, Math.round(periodDays / 3)));
  const goToday = () => setViewStart(subDays(today, Math.round(periodDays / 6)));

  // Позиция задачи
  const getTaskPosition = (task) => {
    const taskStart = startOfDay(new Date(task.start_date));
    const taskEnd = startOfDay(new Date(task.end_date));
    const startOffset = differenceInDays(taskStart, viewStart);
    const duration = differenceInDays(taskEnd, taskStart) + 1;
    const left = (startOffset / totalDays) * 100;
    const width = (duration / totalDays) * 100;
    // Clamp — задача может выходить за пределы
    const clampedLeft = Math.max(0, Math.min(left, 100));
    const clampedWidth = Math.max(0.5, Math.min(width, 100 - clampedLeft));
    const isOutOfView = left + width < 0 || left > 100;
    return { left: `${clampedLeft}%`, width: `${clampedWidth}%`, isOutOfView };
  };

  const getTaskColor = (task) => {
    if (task.end_date && new Date(task.end_date) < today) return '#ef5350';
    if (task.has_report) return '#66bb6a';
    return '#42a5f5';
  };

  // Позиция линии "сегодня"
  const todayOffset = differenceInDays(today, viewStart);
  const todayPercent = (todayOffset / totalDays) * 100;
  const showTodayLine = todayPercent >= 0 && todayPercent <= 100;

  // Группировка дней по месяцам для заголовка
  const months = [];
  let currentMonth = null;
  days.forEach((day, i) => {
    const monthKey = format(day, 'LLLL yyyy', { locale: ru });
    if (monthKey !== currentMonth) {
      months.push({ label: monthKey, startIndex: i, count: 1 });
      currentMonth = monthKey;
    } else {
      months[months.length - 1].count++;
    }
  });

  if (tasksWithDates.length === 0) {
    return (
      <div className="gantt-empty">
        <p>Нет задач с установленными датами</p>
        <p>Добавьте даты начала и окончания к задачам, чтобы увидеть диаграмму Ганта</p>
      </div>
    );
  }

  return (
    <div className="gantt-container">
      {/* Панель управления */}
      <div className="gantt-controls">
        <div className="gantt-nav">
          <button className="gantt-nav-btn" onClick={goBack} title="Назад">◀</button>
          <button className="gantt-nav-btn gantt-today-btn" onClick={goToday}>Сегодня</button>
          <button className="gantt-nav-btn" onClick={goForward} title="Вперёд">▶</button>
          <span className="gantt-period-label">
            {format(viewStart, 'd MMM yyyy', { locale: ru })} — {format(viewEnd, 'd MMM yyyy', { locale: ru })}
          </span>
        </div>

        <div className="gantt-period-selector">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.days}
              className={`period-btn ${periodDays === opt.days ? 'active' : ''}`}
              onClick={() => setPeriodDays(opt.days)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="gantt-legend">
          <div className="legend-item"><span className="legend-color" style={{ background: '#42a5f5' }}></span><span>В процессе</span></div>
          <div className="legend-item"><span className="legend-color" style={{ background: '#66bb6a' }}></span><span>Отчёт сдан</span></div>
          <div className="legend-item"><span className="legend-color" style={{ background: '#ef5350' }}></span><span>Просрочена</span></div>
        </div>
      </div>

      <div className="gantt-chart" ref={chartRef}>
        {/* Заголовок — месяцы */}
        <div className="gantt-header">
          <div className="gantt-sidebar-header">Задача</div>
          <div className="gantt-timeline-header">
            <div className="gantt-months-row">
              {months.map((m, i) => (
                <div key={i} className="gantt-month-header" style={{ width: `${(m.count / totalDays) * 100}%` }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="gantt-days-row">
              {days.map((day, index) => (
                <div
                  key={index}
                  className={`gantt-day-header ${isToday(day) ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}`}
                  style={{ width: `${100 / totalDays}%` }}
                >
                  {/* Показываем число только если не слишком много дней */}
                  {totalDays <= 60 ? format(day, 'd') : (day.getDate() === 1 || day.getDate() % 5 === 0 ? format(day, 'd') : '')}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Строки задач */}
        <div className="gantt-body">
          {tasksWithDates.map((task) => {
            const pos = getTaskPosition(task);
            if (pos.isOutOfView) return (
              <div key={task.id} className="gantt-row gantt-row-hidden">
                <div className="gantt-sidebar">
                  <div className="gantt-task-info">
                    <div className="gantt-task-title">{task.title}</div>
                  </div>
                </div>
                <div className="gantt-timeline">
                  <div className="gantt-out-of-view">← вне периода →</div>
                </div>
              </div>
            );

            return (
              <div key={task.id} className="gantt-row">
                <div className="gantt-sidebar">
                  <div className="gantt-task-info">
                    <div className="gantt-task-title">{task.title}</div>
                    {task.assignees && task.assignees.length > 0 && (
                      <div className="gantt-task-assignees">
                        {task.assignees.map(a => (
                          <span key={a.id} className="gantt-assignee-badge" title={a.name}>
                            {a.name.charAt(0)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="gantt-timeline" style={{ position: 'relative' }}>
                  {/* Сетка */}
                  {days.map((day, index) => (
                    <div
                      key={index}
                      className={`gantt-day-cell ${isWeekend(day) ? 'weekend' : ''} ${isToday(day) ? 'today-cell' : ''}`}
                      style={{ width: `${100 / totalDays}%` }}
                    />
                  ))}
                  {/* Линия сегодня */}
                  {showTodayLine && (
                    <div className="gantt-today-line" style={{ left: `${todayPercent}%` }} />
                  )}
                  {/* Полоса задачи */}
                  <div
                    className="gantt-task-bar"
                    style={{ left: pos.left, width: pos.width, background: getTaskColor(task) }}
                    onClick={() => onTaskClick(task)}
                    title={`${task.title}\n${format(new Date(task.start_date), 'dd.MM.yyyy')} – ${format(new Date(task.end_date), 'dd.MM.yyyy')}`}
                  >
                    <span className="gantt-task-bar-label">{task.title}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default GanttChart;
