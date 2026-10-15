// Разбор строки быстрого добавления, как в Quick Add у Todoist:
//   «Позвонить бухгалтеру завтра #Офис» → название «Позвонить бухгалтеру», срок — завтра, проект «Офис».
// Понимает русский и английский независимо от языка интерфейса. Распознаётся первая дата в строке.
// Короткие английские формы, совпадающие с обычными словами (sun, sat, wed), не распознаются.

const pad = (n) => String(n).padStart(2, '0');
export const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const WEEKDAYS = [
  // [номер дня (0 — воскресенье), формы]
  [1, ['понедельник', 'пн', 'monday', 'mon']],
  [2, ['вторник', 'вт', 'tuesday', 'tue', 'tues']],
  [3, ['среду', 'среда', 'ср', 'wednesday']],
  [4, ['четверг', 'чт', 'thursday', 'thu', 'thurs']],
  [5, ['пятницу', 'пятница', 'пт', 'friday', 'fri']],
  [6, ['субботу', 'суббота', 'сб', 'saturday']],
  [0, ['воскресенье', 'вс', 'sunday']]
];

const MONTHS = [
  ['января', 'январь', 'янв', 'january', 'jan'],
  ['февраля', 'февраль', 'фев', 'february', 'feb'],
  ['марта', 'март', 'мар', 'march', 'mar'],
  ['апреля', 'апрель', 'апр', 'april', 'apr'],
  ['мая', 'май', 'may'],
  ['июня', 'июнь', 'июн', 'june', 'jun'],
  ['июля', 'июль', 'июл', 'july', 'jul'],
  ['августа', 'август', 'авг', 'august', 'aug'],
  ['сентября', 'сентябрь', 'сен', 'сент', 'september', 'sep', 'sept'],
  ['октября', 'октябрь', 'окт', 'october', 'oct'],
  ['ноября', 'ноябрь', 'ноя', 'нояб', 'november', 'nov'],
  ['декабря', 'декабрь', 'дек', 'december', 'dec']
];

const monthIndex = (word) => MONTHS.findIndex(forms => forms.includes(word.toLowerCase().replace(/\.$/, '')));
const alt = (list) => list.slice().sort((a, b) => b.length - a.length).join('|');
const MONTH_RE = alt(MONTHS.flat());
const WEEKDAY_RE = alt(WEEKDAYS.flatMap(([, forms]) => forms));

// Граница слова с учётом кириллицы (\b в JS работает только с латиницей)
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
// Предлог перед датой убираем вместе с ней: «в пятницу», «до 20 октября», «on Friday», «by Monday»
const PREP = `(?:(?:в|во|на|до|к|by|on|due)\\s+)?`;

// Ближайшая дата с этим днём месяца/месяцем: прошедшая в этом году — значит, следующий год
function nearestDate(today, month, day, year) {
  if (year) return new Date(year < 100 ? 2000 + year : year, month, day);
  const candidate = new Date(today.getFullYear(), month, day);
  return candidate < today ? new Date(today.getFullYear() + 1, month, day) : candidate;
}

const RULES = [
  { re: `послезавтра|day after tomorrow`, date: (m, today) => addDays(today, 2) },
  { re: `сегодня|today`, date: (m, today) => today },
  { re: `завтра|tomorrow|tmr|tmrw`, date: (m, today) => addDays(today, 1) },
  { re: `на следующей неделе|next week`, date: (m, today) => addDays(today, ((8 - today.getDay()) % 7) || 7) },
  {
    re: `(?:через|in)\\s+(\\d{1,3})\\s+(дн(?:я|ей|ь)|день|days?|недел(?:ю|и|ь)|weeks?|месяц(?:а|ев)?|months?)`,
    date: (m, today) => {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      if (/^(недел|week)/.test(unit)) return addDays(today, n * 7);
      if (/^(месяц|month)/.test(unit)) { const d = new Date(today); d.setMonth(d.getMonth() + n); return d; }
      return addDays(today, n);
    }
  },
  {
    re: `(?:через неделю|in a week)`,
    date: (m, today) => addDays(today, 7)
  },
  {
    // «в пятницу» — ближайшая пятница (не сегодня); «next friday», «в следующую пятницу» —
    // пятница следующей недели, как в Todoist
    re: `(next\\s+|следующ(?:ий|ую|ее)\\s+)?(${WEEKDAY_RE})\\.?`,
    date: (m, today) => {
      const word = m[2].toLowerCase();
      const target = WEEKDAYS.find(([, forms]) => forms.includes(word))[0];
      if (m[1]) {
        const nextMonday = addDays(today, ((8 - today.getDay()) % 7) || 7);
        return addDays(nextMonday, (target + 6) % 7);
      }
      return addDays(today, ((target - today.getDay() + 7) % 7) || 7);
    }
  },
  {
    // 20.10, 20.10.2026, 20.10.26
    re: `(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?`,
    date: (m, today) => {
      const day = Number(m[1]), month = Number(m[2]) - 1;
      if (month < 0 || month > 11 || day < 1 || day > 31) return null;
      return nearestDate(today, month, day, m[3] ? Number(m[3]) : null);
    }
  },
  {
    // 20 октября, 20 oct 2026
    re: `(\\d{1,2})\\s+(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?`,
    date: (m, today) => nearestDate(today, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : null)
  },
  {
    // oct 20, October 20 2026
    re: `(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`,
    date: (m, today) => nearestDate(today, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null)
  }
];

function findDate(text, today) {
  let best = null;
  for (const rule of RULES) {
    const re = new RegExp(`${B}${PREP}(?:${rule.re})${E}`, 'iu');
    const m = re.exec(text);
    if (!m) continue;
    const date = rule.date(m, today);
    if (!date || isNaN(date)) continue;
    // Берём то, что стоит в строке раньше: «в пятницу купить билеты на 20 октября» → пятница
    if (!best || m.index < best.index) best = { index: m.index, match: m[0], date };
  }
  return best;
}

// Проект по «#Название» — ищем самое длинное подходящее название (в названии могут быть пробелы)
function findProject(text, projects) {
  const lower = text.toLowerCase();
  const sorted = (projects || []).slice().sort((a, b) => b.name.length - a.name.length);
  for (const project of sorted) {
    const token = `#${project.name.toLowerCase()}`;
    let from = 0;
    while (true) {
      const index = lower.indexOf(token, from);
      if (index === -1) break;
      const after = lower.charAt(index + token.length);
      if (!after || /\s|[,.;!?]/.test(after)) return { project, index, match: text.substr(index, token.length) };
      from = index + 1;
    }
  }
  return null;
}

const tidy = (s) => s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/^[\s,.;—-]+|[\s,;—-]+$/g, '').trim();

/**
 * @param {string} text — строка из поля ввода
 * @param {{ projects?: {id:number,name:string}[], today?: Date, skipDate?: boolean }} options
 * @returns {{ title: string, dueDate: string|null, dateText: string|null, project: object|null, projectText: string|null, unknownProject: string|null }}
 */
export function parseQuickAdd(text, { projects = [], today = new Date(), skipDate = false } = {}) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let rest = String(text || '');

  const found = findProject(rest, projects);
  let projectText = null;
  if (found) {
    projectText = found.match;
    rest = rest.slice(0, found.index) + ' ' + rest.slice(found.index + found.match.length);
  }
  const unknown = !found ? (rest.match(/(?:^|\s)#([^\s#]+)/) || [])[1] || null : null;

  let dueDate = null;
  let dateText = null;
  if (!skipDate) {
    const date = findDate(rest, base);
    if (date) {
      dueDate = toIso(date.date);
      dateText = date.match.trim();
      rest = rest.slice(0, date.index) + ' ' + rest.slice(date.index + date.match.length);
    }
  }

  return { title: tidy(rest), dueDate, dateText, project: found ? found.project : null, projectText, unknownProject: unknown };
}

// «#сло» в конце набранного текста — для подсказки проектов при вводе
export function projectQueryAtCursor(text, cursor) {
  const before = String(text || '').slice(0, cursor);
  const m = before.match(/(?:^|\s)#([^#\n]*)$/);
  return m ? { query: m[1], start: before.length - m[1].length - 1 } : null;
}
