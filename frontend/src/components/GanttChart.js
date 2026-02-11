import React, { useState, useEffect, useRef } from 'react';
import { format, addDays, differenceInDays, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import './GanttChart.css';

function GanttChart({ tasks, onTaskClick, members }) {
  const [scale, setScale] = useState('day'); // day, week, month
  const chartRef = useRef(null);

  // Фильтруем задачи с датами
  const tasksWithDates = tasks.filter(task => task.start_date && task.end_date);

  if (tasksWithDates.length === 0) {
    return (
      <div className="gantt-empty">
        <p>Нет задач с установленными датами</p>
        <p>Добавьте даты начала и окончания к задачам, чтобы увидеть диаграмму Ганта</p>
      </div>
    );
  }

  // Находим минимальную и максимальную даты
  const allDates = tasksWithDates.flatMap(t => [new Date(t.start_date), new Date(t.end_date)]);
  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates));

  // Добавляем отступы
  const chartStart = addDays(startOfMonth(minDate), -7);
  const chartEnd = addDays(endOfMonth(maxDate), 7);
  const totalDays = differenceInDays(chartEnd, chartStart);

  // Генерируем дни для шкалы
  const days = eachDayOfInterval({ start: chartStart, end: chartEnd });

  // Функция для расчета позиции задачи
  const getTaskPosition = (task) => {
    const taskStart = new Date(task.start_date);
    const taskEnd = new Date(task.end_date);
    
    const startOffset = differenceInDays(taskStart, chartStart);
    const duration = differenceInDays(taskEnd, taskStart) + 1;
    
    const left = (startOffset / totalDays) * 100;
    const width = (duration / totalDays) * 100;
    
    return { left: `${left}%`, width: `${width}%` };
  };

  // Функция для получения цвета задачи по статусу
  const getTaskColor = (task) => {
    const status = task.status_id;
    // Можно добавить разные цвета в зависимости от статуса
    if (task.end_date && new Date(task.end_date) < new Date()) {
      return '#ef5350'; // Просроченная
    }
    return '#42a5f5'; // Обычная
  };

  // Функция для рисования связей между задачами
  const renderDependencies = () => {
    const lines = [];
    
    tasksWithDates.forEach((task, taskIndex) => {
      if (!task.dependencies || task.dependencies.length === 0) return;

      task.dependencies.forEach(dep => {
        const dependsOnTask = tasksWithDates.find(t => t.id === dep.depends_on_task_id);
        if (!dependsOnTask) return;

        const dependsOnIndex = tasksWithDates.indexOf(dependsOnTask);
        
        // Создаем SVG линию связи
        lines.push({
          key: `${task.id}-${dependsOnTask.id}`,
          fromIndex: dependsOnIndex,
          toIndex: taskIndex,
          type: dep.dependency_type
        });
      });
    });

    return lines;
  };

  const dependencies = renderDependencies();

  return (
    <div className="gantt-container">
      <div className="gantt-controls">
        <div className="gantt-legend">
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#42a5f5' }}></span>
            <span>В процессе</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ background: '#ef5350' }}></span>
            <span>Просрочена</span>
          </div>
        </div>
      </div>

      <div className="gantt-chart" ref={chartRef}>
        {/* Заголовок с датами */}
        <div className="gantt-header">
          <div className="gantt-sidebar-header">Задача</div>
          <div className="gantt-timeline-header">
            {days.map((day, index) => (
              <div 
                key={index} 
                className="gantt-day-header"
                style={{ width: `${100 / totalDays}%` }}
              >
                {format(day, 'd MMM', { locale: ru })}
              </div>
            ))}
          </div>
        </div>

        {/* Список задач */}
        <div className="gantt-body">
          {tasksWithDates.map((task, taskIndex) => {
            const position = getTaskPosition(task);
            const color = getTaskColor(task);

            return (
              <div key={task.id} className="gantt-row">
                <div className="gantt-sidebar">
                  <div className="gantt-task-info">
                    <div className="gantt-task-title">{task.title}</div>
                    {task.assignees && task.assignees.length > 0 && (
                      <div className="gantt-task-assignees">
                        {task.assignees.map(assignee => (
                          <span key={assignee.id} className="gantt-assignee-badge">
                            {assignee.name.charAt(0)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="gantt-timeline">
                  {/* Сетка дней */}
                  {days.map((day, index) => (
                    <div 
                      key={index} 
                      className="gantt-day-cell"
                      style={{ width: `${100 / totalDays}%` }}
                    />
                  ))}
                  
                  {/* Полоса задачи */}
                  <div 
                    className="gantt-task-bar"
                    style={{
                      ...position,
                      background: color
                    }}
                    onClick={() => onTaskClick(task)}
                    title={`${task.title}\n${format(new Date(task.start_date), 'dd.MM.yyyy')} - ${format(new Date(task.end_date), 'dd.MM.yyyy')}`}
                  >
                    <span className="gantt-task-bar-label">{task.title}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* SVG для связей */}
        {dependencies.length > 0 && (
          <svg className="gantt-dependencies-svg">
            {dependencies.map(dep => {
              const rowHeight = 60; // Высота строки
              const headerHeight = 50; // Высота заголовка
              
              const fromY = headerHeight + dep.fromIndex * rowHeight + rowHeight / 2;
              const toY = headerHeight + dep.toIndex * rowHeight + rowHeight / 2;
              
              // Простая линия связи
              return (
                <g key={dep.key}>
                  <line
                    x1="35%"
                    y1={fromY}
                    x2="35%"
                    y2={toY}
                    stroke="#ff9800"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                  <circle cx="35%" cy={toY} r="4" fill="#ff9800" />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export default GanttChart;
