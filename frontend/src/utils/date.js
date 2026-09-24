// Даты задач приходят как 'YYYY-MM-DD'. new Date('YYYY-MM-DD') парсит их в UTC,
// из-за чего в часовых поясах западнее UTC дата «съезжает» на день назад.
// parseDate создаёт дату в локальном часовом поясе.
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match && value.length <= 10) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(value);
}

export function toInputDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

export function formatDate(value, lang) {
  const date = parseDate(value);
  if (!date || isNaN(date)) return '';
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

// Сколько полных дней до даты (отрицательное — просрочено)
export function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / (1000 * 60 * 60 * 24));
}

// 'overdue' | 'due-soon' | ''
export function deadlineState(task) {
  if (!task.end_date || task.is_done) return '';
  const days = daysUntil(task.end_date);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'due-soon';
  return '';
}
