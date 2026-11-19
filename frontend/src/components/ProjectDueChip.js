import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { formatDate, projectDueState } from '../utils/date';
import Icon from './Icon';

// Срок проекта на карточке и на доске: значок и слово, цвет — только дополнительный признак
function ProjectDueChip({ project, className = '' }) {
  const { t, lang } = useLanguage();
  const state = projectDueState(project);
  if (state === null) return null;
  const cls = { overdue: 'chip-danger', 'due-soon': 'chip-warning', done: 'chip-success' }[state] || '';
  const icon = { overdue: 'alert', 'due-soon': 'clock', done: 'check' }[state] || 'calendar';
  return (
    <span className={`chip project-due-chip ${cls} ${className}`} title={t('projectDueTitle')}>
      <Icon name={icon} size={13} />
      {t('projectDueChip', { date: formatDate(project.due_date, lang) })}
      {state === 'overdue' && ` · ${t('projectDueOverdue')}`}
    </span>
  );
}

export default ProjectDueChip;
