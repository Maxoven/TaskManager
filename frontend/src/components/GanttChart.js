import React, { useState, useRef, useEffect } from 'react';
import { format, addDays, subDays, differenceInDays, startOfDay, eachMonthOfInterval, endOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import './GanttChart.css';

const PERIOD_DAYS = 365;
const DAY_PX = 16;         // пикселей на день
const ROW_H = 44;          // высота строки
const SIDEBAR_W = 200;     // ширина колонки задач
const HEADER_H = 36;       // высота шапки

function GanttChart({ tasks, onTaskClick, members }) {
  const today = startOfDay(new Date());
  const [viewStart] = useState(subDays(today, 20));
  const [filterAssignee, setFilterAssignee] = useState('all');
  const scrollRef = useRef(null);

  const viewEnd = addDays(viewStart, PERIOD_DAYS - 1);
  const totalWidth = PERIOD_DAYS * DAY_PX;

  // Скролл к сегодняшнему дню при загрузке
  useEffect(() => {
    if (scrollRef.current) {
      const todayPx = differenceInDays(today, viewStart) * DAY_PX;
      scrollRef.current.scrollLeft = Math.max(0, todayPx - 100);
    }
  }, []);

  const tasksWithDates = tasks
    .filter(t => t.start_date && t.end_date)
    .filter(t => {
      if (filterAssignee === 'all') return true;
      return t.assignees && t.assignees.some(a => a.id === parseInt(filterAssignee));
    });

  // Позиция в пикселях
  const dateToPx = (date) => differenceInDays(startOfDay(new Date(date)), viewStart) * DAY_PX;

  const getTaskBar = (task) => {
    const left = dateToPx(task.start_date);
    const right = dateToPx(task.end_date) + DAY_PX;
    return { left, width: Math.max(4, right - left) };
  };

  const isTaskDone = (task) => {
    const s = (task.status_name || '').toLowerCase();
    return s === 'готово' || s === 'done' || s === 'выполнено';
  };

  const getTaskColor = (task) => {
    if (isTaskDone(task)) return '#66bb6a';
    if (task.has_report) return '#26a69a';
    if (task.end_date && new Date(task.end_date) < today) return '#ef5350';
    return '#42a5f5';
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
              fill="none"
              stroke="#aaa"
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

  if (tasks.filter(t => t.start_date && t.end_date).length === 0) {
    return (
      <div className="gantt-empty">
        <p>Нет задач с установленными датами</p>
        <p>Добавьте даты начала и окончания к задачам, чтобы увидеть диаграмму Ганта</p>
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
            {format(viewStart, 'd MMM yyyy', { locale: ru })} — {format(viewEnd, 'd MMM yyyy', { locale: ru })}
          </span>
        </div>

        <div className="gantt-filter">
          <select className="gantt-assignee-filter" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="all">Все исполнители</option>
            {members && members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="gantt-legend">
          <div className="legend-item"><span className="legend-color" style={{ background: '#42a5f5' }}></span><span>В процессе</span></div>
          <div className="legend-item"><span className="legend-color" style={{ background: '#66bb6a' }}></span><span>Выполнено</span></div>
          <div className="legend-item"><span className="legend-color" style={{ background: '#26a69a' }}></span><span>Отчёт сдан</span></div>
          <div className="legend-item"><span className="legend-color" style={{ background: '#ef5350' }}></span><span>Просрочена</span></div>
        </div>
      </div>

      {/* Основная таблица */}
      <div className="gantt-chart">
        <div className="gantt-layout">

          {/* Фиксированная колонка с названиями */}
          <div className="gantt-sidebar-col">
            <div className="gantt-sidebar-header">Задача</div>
            {tasksWithDates.length === 0 ? null : tasksWithDates.map(task => (
              <div key={task.id} className="gantt-sidebar">
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
                    {format(monthStart, 'LLLL yyyy', { locale: ru })}
                  </div>
                );
              })}
            </div>

            {/* Тело: строки + SVG стрелки */}
            <div className="gantt-body" style={{ width: totalWidth, height: bodyHeight, position: 'relative' }}>

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
              <svg
                style={{ position: 'absolute', top: 0, left: 0, width: totalWidth, height: bodyHeight, pointerEvents: 'none', overflow: 'visible' }}
              >
                <defs>
                  <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M 0 0 L 6 3 L 0 6 z" fill="#aaa" />
                  </marker>
                </defs>
                {renderArrows()}
              </svg>

              {/* Полосы задач */}
              {tasksWithDates.map((task, i) => {
                const bar = getTaskBar(task);
                return (
                  <div
                    key={task.id}
                    className="gantt-task-bar"
                    style={{
                      left: bar.left,
                      width: bar.width,
                      top: i * ROW_H + 6,
                      background: getTaskColor(task)
                    }}
                    onClick={() => onTaskClick(task)}
                    title={`${task.title}\n${format(new Date(task.start_date), 'dd.MM.yyyy')} – ${format(new Date(task.end_date), 'dd.MM.yyyy')}`}
                  >
                    <span className="gantt-task-bar-label">{task.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GanttChart;
