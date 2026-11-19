import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { formatDate, projectDueState } from '../utils/date';
import Icon from './Icon';

// Даты проекта на карточке и на доске: период «начало — срок», только срок или только начало.
// Состояние (просрочен, скоро, выполнен) — по сроку; значок и слово, цвет — дополнительный признак.
function ProjectDueChip({ project, className = '' }) {
  const { t, lang } = useLanguage();
  const start = project?.start_date;
  const state = projectDueState(project);
  if (state === null && !start) return null;

  if (state === null) {
    return (
      <span className={`chip project-due-chip ${className}`} title={t('projectStartTitle')}>
        <Icon name="calendar" size={13} />
        {t('projectStartChip', { date: formatDate(start, lang) })}
      </span>
    );
  }

  const cls = { overdue: 'chip-danger', 'due-soon': 'chip-warning', done: 'chip-success' }[state] || '';
  const icon = { overdue: 'alert', 'due-soon': 'clock', done: 'check' }[state] || 'calendar';
  const label = start
    ? t('projectPeriodChip', { start: formatDate(start, lang), end: formatDate(project.due_date, lang) })
    : t('projectDueChip', { date: formatDate(project.due_date, lang) });
  return (
    <span className={`chip project-due-chip ${cls} ${className}`} title={t('projectDueTitle')}>
      <Icon name={icon} size={13} />
      {label}
      {state === 'overdue' && ` · ${t('projectDueOverdue')}`}
    </span>
  );
}

export default ProjectDueChip;
