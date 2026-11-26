// Экран «Помощник»: простой чат поверх OpenCode. Ни моделей, ни терминала, ни настроек — человек пишет задачу
// обычными словами, видит ответ, шаги работы простым языком, экран облачного браузера и свои файлы.
import { renderMarkdown } from './md.js';

const $ = (id) => document.getElementById(id);
const WORKSPACE = '/home/user/workspace';
const UPLOAD_DIR = 'Мои файлы';
const ATTACH_HEAD = 'К сообщению приложены файлы (лежат в рабочей папке):';

// ─── Иконки (набор Task Manager) ────────────────────────────────────────────
const ICONS = {
  sparkles: '<path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',
  send: '<path d="M4.5 12L20 4.5l-5 15.5-3.2-6.3zM11.8 13.7L20 4.5"/>',
  paperclip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>',
  file: '<path d="M6.5 3.5h7L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V8H18"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  screen: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v5.5M14 11v5.5"/>',
  logout: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M15 8l4 4-4 4M19 12H9.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.2v.2"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'
};
const icon = (name, size = 16) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'html') node.innerHTML = v;
    else if (k === 'on') for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    else if (k === 'attrs') for (const [a, val] of Object.entries(v)) node.setAttribute(a, val);
    else node[k] = v;
  }
  node.append(...children.filter(c => c !== null && c !== undefined));
  return node;
}

// ─── Модели ─────────────────────────────────────────────────────────────────
// Человек выбирает, кто отвечает ему в разговоре. Подручные помощника всегда работают на DeepSeek.
const MODELS = [
  { key: 'glm', id: 'glm-5.3', providerID: 'portal-glm', name: 'GLM-5.3', short: 'GLM', hint: 'Умнее. Для сложных задач и документов' },
  { key: 'deepseek', id: 'deepseek-flash', providerID: 'portal-deepseek', name: 'DeepSeek Flash', short: 'DeepSeek', hint: 'Быстрее. Для простых вопросов' },
  { key: 'giga', id: 'GigaChat-3-Ultra', providerID: 'portal-giga', name: 'GigaChat 3 Ultra', short: 'GigaChat', hint: 'Хорошо работает с русским языком. Умеет рисовать картинки' }
];
const modelByKey = (key) => MODELS.find(m => m.key === key) || MODELS[0];
const modelOfSession = (s) => MODELS.find(m => m.id === s?.model?.id && m.providerID === s?.model?.providerID);
function savedModel() {
  try { return modelByKey(localStorage.getItem('aip_model')).key; } catch { return MODELS[0].key; }
}

// ─── Состояние ──────────────────────────────────────────────────────────────
const state = {
  me: null,
  sessions: [],
  currentId: null,
  messages: [],
  busy: false,
  status: '',
  pendingUser: null,        // сообщение, которое уже отправили, но сервер ещё не вернул
  live: { msgId: null, texts: new Map() },
  toolNames: new Map(),     // id вызова → имя инструмента (для подписи шага до завершения)
  asks: [],
  attachments: [],
  expanded: new Set(),
  panel: { open: false, tab: 'screen', autoOpened: false },
  filesDir: '',
  model: savedModel()      // выбранная модель; у открытого разговора — та, что в нём
};

// ─── Запросы ────────────────────────────────────────────────────────────────
let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const node = el('div', { className: 'toast', textContent: text, attrs: { role: 'status' } });
  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), 4500);
}

const toLogin = () => { location.href = '/login'; };

async function start() {
  const r = await fetch('/api/start', { method: 'POST' });
  if (r.status === 401) { toLogin(); throw new Error('Нужно войти'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Не получилось подготовить помощника.');
}

// Рабочее место уснуло — будим один раз для всех ждущих запросов
let waking = null;
function wake() {
  if (!waking) {
    toast('Продолжаем с того же места…');
    waking = start().finally(() => { waking = null; });
    waking.then(connectEvents, () => {});
  }
  return waking;
}

async function oc(path, { method = 'GET', body, raw, full } = {}, retried = false) {
  const r = await fetch(`/api/oc${path}`, {
    method,
    headers: body && !raw ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined
  });
  if (r.status === 401) { toLogin(); throw new Error('Нужно войти'); }
  if (r.status === 409 && !retried) { await wake(); return oc(path, { method, body, raw, full }, true); }
  if (!r.ok) throw new Error(`Ошибка ${r.status}`);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => null);
  return !full && data && typeof data === 'object' && 'data' in data ? data.data : data;
}

// ─── Подписи шагов простым языком ───────────────────────────────────────────
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';

function serviceCallLabel(call) {
  const tool = String(call?.tool || '');
  const input = call?.input || {};
  if (tool.startsWith('browser.')) {
    const url = input.url || input.href;
    if (url && host(url)) return `Открываю сайт ${host(url)}`;
    if (/click/.test(tool)) return 'Нажимаю на странице';
    if (/type|fill|select|press/.test(tool)) return 'Заполняю поля на странице';
    if (/snapshot|screenshot|evaluate|console|network/.test(tool)) return 'Читаю страницу';
    return 'Работаю в браузере';
  }
  if (/\.mail_(send|reply|forward)/.test(tool)) return 'Отправляю письмо';
  if (/\.mail_save_draft/.test(tool)) return 'Сохраняю черновик письма';
  if (/\.mail_/.test(tool)) return 'Работаю с почтой';
  if (tool.startsWith('taskmanager.')) return 'Работаю с Task Manager';
  return 'Пользуюсь подключённым сервисом';
}

function stepLabel(name, input = {}, metadata = {}) {
  switch (name) {
    case 'execute': {
      const calls = (metadata.toolCalls || []).filter(c => c.tool !== 'search' && c.tool !== 'describe');
      if (calls.length) return serviceCallLabel(calls[calls.length - 1]);
      const code = String(input.code || '');
      const url = /https?:\/\/[^\s"'`)]+/.exec(code)?.[0];
      if (/browser\./.test(code)) return url && host(url) ? `Открываю сайт ${host(url)}` : 'Работаю в браузере';
      if (/mail_/.test(code)) return 'Работаю с почтой';
      if (/taskmanager\./.test(code)) return 'Работаю с Task Manager';
      return 'Пользуюсь подключённым сервисом';
    }
    case 'shell': return 'Выполняю действие';
    case 'read': return base(input.path || input.filePath) ? `Читаю файл «${base(input.path || input.filePath)}»` : 'Читаю файл';
    case 'write': case 'edit': case 'patch': {
      const name = base(input.path || input.filePath);
      // Служебные файлы (скрипты, черновики) человеку называть незачем
      const internal = !name || /\.(py|js|ts|sh|json|ya?ml|toml|log|tmp)$/i.test(name) || String(input.path || input.filePath).includes('/.work/');
      return internal ? 'Готовлю результат' : `Записываю файл «${name}»`;
    }
    case 'glob': case 'grep': case 'list': return 'Ищу в файлах';
    case 'webfetch': return host(input.url) ? `Читаю страницу ${host(input.url)}` : 'Читаю страницу в интернете';
    case 'websearch': return input.query ? `Ищу в интернете: «${String(input.query).slice(0, 80)}»` : 'Ищу в интернете';
    case 'subagent': return input.description ? `Поручил подручному: ${String(input.description).slice(0, 90)}` : 'Поручил часть работы подручному';
    case 'todowrite': return 'Составляю план';
    case 'skill': return 'Вспоминаю, как это делается';
    default: return 'Работаю';
  }
}
// Помощник работает с сайтом (а не просто выясняет, какие у него есть инструменты)
const isBrowserStep = (name, input, metadata) => name === 'execute' && (
  (metadata?.toolCalls || []).some(c => String(c.tool).startsWith('browser.')) || /tools\.browser\./.test(String(input?.code || '')));
// Служебный шаг: помощник смотрит список своих инструментов — человеку это знать незачем
const isInternalStep = (name, input, metadata) => name === 'execute' && (
  Array.isArray(metadata?.toolCalls) && metadata.toolCalls.length
    ? metadata.toolCalls.every(c => c.tool === 'search' || c.tool === 'describe')
    : !/tools\.[a-z_]+\./i.test(String(input?.code || '')));

// ─── Список разговоров ──────────────────────────────────────────────────────
const titleOf = (s) => (!s.title || /^new session/i.test(s.title) ? 'Новый разговор' : s.title);

async function loadSessions() {
  try {
    const list = await oc('/session?parentID=null&limit=100');
    state.sessions = (Array.isArray(list) ? list : [])
      .filter(s => !s.parentID)
      .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
    renderSessions();
  } catch { /* покажем то, что было */ }
}

function renderSessions() {
  const list = $('chat-list');
  if (!state.sessions.length) {
    list.replaceChildren(el('li', { className: 'chat-list-empty', textContent: 'Здесь появятся ваши разговоры' }));
    return;
  }
  list.replaceChildren(...state.sessions.map(s => {
    const title = titleOf(s);
    return el('li', { className: `chat-item${s.id === state.currentId ? ' active' : ''}` },
      el('button', { className: 'chat-item-open', type: 'button', title, on: { click: () => openSession(s.id) } }, el('span', { textContent: title })),
      el('button', {
        className: 'btn-icon chat-item-delete', type: 'button', html: icon('trash', 15),
        attrs: { 'aria-label': `Удалить разговор «${title}»` }, on: { click: () => deleteSession(s) }
      }));
  }));
}

async function deleteSession(s) {
  if (!confirm(`Удалить разговор «${titleOf(s)}»? Вернуть его будет нельзя.`)) return;
  try {
    await oc(`/session/${s.id}`, { method: 'DELETE' });
    if (s.id === state.currentId) newChat();
    await loadSessions();
  } catch { toast('Не получилось удалить. Попробуйте ещё раз.'); }
}

function resetTurn() {
  state.messages = []; state.pendingUser = null; state.asks = []; state.status = '';
  state.live = { msgId: null, texts: new Map() };
  state.toolNames.clear(); state.expanded.clear(); state.panel.autoOpened = false;
}

function newChat() {
  state.currentId = null; state.busy = false;
  state.model = savedModel();
  renderModel();
  resetTurn();
  renderSessions(); render(); closeSidebar();
  $('input').focus();
}

async function openSession(id) {
  state.currentId = id; state.busy = false;
  state.model = (modelOfSession(state.sessions.find(x => x.id === id)) || modelByKey(savedModel())).key;
  renderModel();
  resetTurn();
  renderSessions(); closeSidebar();
  $('feed-inner').replaceChildren(el('div', { className: 'working' }, el('span', { className: 'spinner' }), el('span', { textContent: 'Открываем разговор…' })));
  try {
    const [, active, asks] = await Promise.all([
      loadMessages(),
      oc('/session/active').catch(() => ({})),
      oc(`/session/${id}/permission`).catch(() => [])
    ]);
    if (state.currentId !== id) return;
    state.busy = !!active?.[id];
    state.asks = Array.isArray(asks) ? asks : [];
    maybeShowScreen();
  } catch { toast('Не получилось открыть разговор.'); }
  render(true);
}

// ─── Сообщения ──────────────────────────────────────────────────────────────
async function loadMessages() {
  const id = state.currentId;
  if (!id) return;
  // Сервер отдаёт не больше 200 сообщений за раз — длинный разговор дочитываем страницами
  const list = [];
  let cursor = '';
  for (let page = 0; page < 25; page++) {
    // Курсор уже помнит порядок — вместе с order сервер его не принимает
    const res = await oc(`/session/${id}/message?limit=200&${cursor ? `cursor=${encodeURIComponent(cursor)}` : 'order=asc'}`, { full: true });
    const chunk = Array.isArray(res?.data) ? res.data : [];
    list.push(...chunk);
    cursor = res?.cursor?.next;
    if (!cursor || chunk.length < 200) break;
  }
  if (state.currentId !== id) return;
  state.messages = list;
  // Текст, который шёл «вживую», уже пришёл в сообщении — живую копию убираем
  if (state.live.msgId && state.messages.some(m => m.id === state.live.msgId && (m.content || []).some(p => p.type === 'text'))) {
    for (const [k, v] of state.live.texts) if (v.ended) state.live.texts.delete(k);
  }
  if (state.pendingUser && state.messages.filter(m => m.type === 'user').length > state.pendingUser.count) state.pendingUser = null;
  maybeShowScreen();
}

// Помощник зашёл на сайт — показываем его экран (один раз за ответ; закрытую человеком панель не открываем снова)
function maybeShowScreen() {
  if (state.busy && !state.panel.autoOpened) {
    const tools = state.messages.slice(-6).flatMap(m => (m.content || []).filter(p => p.type === 'tool'));
    const last = tools[tools.length - 1];
    if (last && last.state?.status !== 'completed' && isBrowserStep(last.name, last.state?.input, last.state?.metadata)) {
      state.panel.autoOpened = true;
      openPanel('screen');
    }
  }
}

let refetchTimer;
function scheduleRefetch(delay = 250) {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(async () => { try { await loadMessages(); render(); } catch { /* следующий раз */ } }, delay);
}

function splitAttachments(text) {
  const i = String(text || '').indexOf(ATTACH_HEAD);
  if (i < 0) return { text: text || '', files: [] };
  const files = text.slice(i + ATTACH_HEAD.length).split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  return { text: text.slice(0, i).trim(), files };
}

function userBubble(fullText) {
  const { text, files } = splitAttachments(fullText);
  const node = el('div', { className: 'message message-user' }, text);
  if (files.length) {
    node.append(el('div', { className: 'file-chips' }, ...files.map(f =>
      el('span', { className: 'file-chip', html: icon('file', 14) }, el('span', { textContent: base(f) })))));
  }
  return node;
}

function stepsBlock(steps) {
  const key = steps[0].id;
  const LIMIT = 4;
  const collapsed = steps.length > LIMIT && !state.expanded.has(key);
  const shown = collapsed ? steps.slice(-LIMIT + 1) : steps;
  const block = el('div', { className: 'steps' });
  if (collapsed) {
    block.append(el('button', {
      className: 'steps-more', type: 'button', textContent: `Показать все шаги (${steps.length})`,
      on: { click: () => { state.expanded.add(key); render(); } }
    }));
  }
  for (const s of shown) {
    block.append(el('div', {
      className: `step ${s.status}`,
      html: (s.status === 'running' ? '<span class="spinner" aria-hidden="true"></span>' : icon(s.status === 'failed' ? 'alert' : 'check', 14))
    }, el('span', { textContent: s.label })));
  }
  return block;
}

function buildFeed() {
  const nodes = [];
  let steps = null;
  const flush = () => { if (steps) { nodes.push(stepsBlock(steps)); steps = null; } };

  for (const m of state.messages) {
    if (m.type === 'user') {
      flush();
      nodes.push(userBubble(m.text));
    } else if (m.type === 'assistant') {
      for (const part of m.content || []) {
        if (part.type === 'text' && part.text?.trim()) {
          flush();
          nodes.push(el('div', { className: 'message message-assistant md', html: renderMarkdown(part.text) }));
        } else if (part.type === 'tool') {
          const st = part.state || {};
          if (isInternalStep(part.name, st.input, st.metadata)) continue;
          let status = st.status === 'completed' ? 'done' : st.status === 'error' ? 'failed' : 'running';
          if (status === 'running' && !state.busy) status = 'done';
          (steps ||= []).push({ id: part.id, label: stepLabel(part.name, st.input, st.metadata), status });
        }
      }
      if (m.finish === 'error' && m.error && m.error.type !== 'aborted') {
        flush();
        nodes.push(el('div', { className: 'message-error', textContent: 'Не получилось. Попробуйте ещё раз.' }));
      }
    } else if (m.type === 'idle') {
      flush();
      if (m.outcome === 'interrupted') nodes.push(el('div', { className: 'message-note', textContent: 'Остановлено' }));
      else if (m.outcome === 'failed') nodes.push(el('div', { className: 'message-error', textContent: 'Не получилось довести до конца. Напишите «продолжай» или попробуйте ещё раз.' }));
    }
  }
  flush();

  if (state.pendingUser) nodes.push(userBubble(state.pendingUser.text));
  for (const [, v] of [...state.live.texts].sort((a, b) => a[0] - b[0])) {
    if (v.text.trim()) nodes.push(el('div', { className: 'message message-assistant md', html: renderMarkdown(v.text) }));
  }
  for (const ask of state.asks) nodes.push(askCard(ask));
  if (state.busy) {
    nodes.push(el('div', { className: 'working', attrs: { role: 'status' } },
      el('span', { className: 'typing', html: '<i></i><i></i><i></i>' }),
      el('span', { textContent: state.status || 'Помощник думает…' })));
  }
  return nodes;
}

const ASK_ACTIONS = { shell: 'выполнить действие', edit: 'изменить файл', read: 'прочитать файл', webfetch: 'открыть страницу в интернете', external_directory: 'открыть папку вне рабочей' };
function askCard(ask) {
  const what = ASK_ACTIONS[ask.action] || 'продолжить работу';
  const reply = async (decision) => {
    try {
      await oc(`/session/${ask.sessionID}/permission/${ask.id}/reply`, { method: 'POST', body: { decision } });
      state.asks = state.asks.filter(a => a.id !== ask.id); render();
    } catch { toast('Не получилось. Попробуйте ещё раз.'); }
  };
  return el('div', { className: 'ask' },
    el('p', { textContent: `Помощник просит разрешения ${what}. Разрешить?` }),
    el('div', { className: 'ask-actions' },
      el('button', { className: 'btn-primary', type: 'button', textContent: 'Да', on: { click: () => reply('once') } }),
      el('button', { className: 'btn-secondary', type: 'button', textContent: 'Нет', on: { click: () => reply('reject') } })));
}

const SUGGESTIONS = [
  'Покажи мои задачи на эту неделю',
  'Какие письма пришли сегодня?',
  'Найди в интернете и сравни…',
  'Составь письмо клиенту…',
  'Разбери документ, который я приложу'
];

function welcome() {
  const first = (state.me?.user?.name || '').split(' ')[0];
  return el('div', { className: 'welcome' },
    el('div', { className: 'welcome-mark', html: icon('sparkles', 28) }),
    el('h1', { textContent: first ? `Здравствуйте, ${first}!` : 'Здравствуйте!' }),
    el('p', { textContent: 'Напишите, что нужно сделать. Помощник работает с вашими задачами и почтой, ищет в интернете, заходит на сайты, готовит документы и таблицы.' }),
    el('div', { className: 'suggestions' }, ...SUGGESTIONS.map(text => el('button', {
      className: 'suggestion', type: 'button', textContent: text,
      on: { click: () => {
        if (text.endsWith('…') || text.includes('приложу')) {
          $('input').value = text.replace(/…$/, ' '); autosize(); $('input').focus();
        } else send(text);
      } }
    }))));
}

function render(forceBottom = false) {
  const feed = $('feed');
  const nearBottom = forceBottom || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  const empty = !state.currentId && !state.messages.length && !state.pendingUser;
  $('feed-inner').replaceChildren(...(empty ? [welcome()] : buildFeed()));
  showImages();
  if (nearBottom) feed.scrollTop = feed.scrollHeight;
  $('stop-btn').hidden = !state.busy;
  $('send-btn').hidden = state.busy;
}

function setBusy(on, status) {
  state.busy = on;
  if (status !== undefined) state.status = status;
  if (!on) { state.status = ''; state.panel.autoOpened = false; }
}

// ─── Выбор модели ───────────────────────────────────────────────────────────
function renderModel() {
  const current = modelByKey(state.model);
  $('model-btn').innerHTML = `<span>${current.short}<span class="model-name-long">${current.name.slice(current.short.length)}</span></span>${icon('chevron', 14)}`;
  $('model-btn').setAttribute('aria-label', `Модель: ${current.name}. Сменить`);
  $('model-menu').replaceChildren(
    el('div', { className: 'model-menu-label', textContent: 'Кто отвечает' }),
    ...MODELS.map(m => el('button', {
      className: 'model-option', type: 'button', html: icon('check', 16),
      attrs: { role: 'menuitemradio', 'aria-checked': String(m.key === current.key) },
      on: { click: () => chooseModel(m.key) }
    }, el('span', { className: 'model-option-text' },
      el('span', { className: 'model-option-name', textContent: m.name }),
      el('span', { className: 'model-option-hint', textContent: m.hint })))));
}

function toggleModelMenu(open) {
  const menu = $('model-menu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('model-btn').setAttribute('aria-expanded', String(show));
}

function chooseModel(key) {
  state.model = key;
  try { localStorage.setItem('aip_model', key); } catch { /* приватный режим */ }
  renderModel();
  toggleModelMenu(false);
  $('input').focus();
}

// ─── Голосовой ввод ─────────────────────────────────────────────────────────
// Речь в текст переводит сам браузер (Chrome, Edge, Safari); звук на наш сервер не передаётся.
// В браузерах без этой возможности (Firefox) кнопки нет.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function stopDictation() {
  const rec = recognition;
  recognition = null;
  try { rec?.stop(); } catch { /* уже остановлен */ }
  $('mic-btn').setAttribute('aria-pressed', 'false');
  $('mic-btn').title = 'Надиктовать';
  $('input').placeholder = 'Напишите задачу обычными словами…';
}

function startDictation() {
  const input = $('input');
  const before = input.value.trim() ? `${input.value.trim()} ` : '';
  let finalText = '';
  const rec = new Recognition();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += piece; else interim += piece;
    }
    input.value = (before + finalText + interim).replace(/\s+/g, ' ').trimStart();
    autosize();
    input.scrollTop = input.scrollHeight;
  };
  rec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    toast(event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Браузер не дал доступ к микрофону. Разрешите его в настройках сайта (значок слева от адреса).'
      : event.error === 'audio-capture' ? 'Микрофон не найден.'
      : 'Не получилось распознать речь. Попробуйте ещё раз.');
  };
  // Браузер сам обрывает запись после паузы — тогда просто выключаем кнопку, текст остаётся в поле
  rec.onend = () => { if (recognition === rec) stopDictation(); input.focus(); };
  try {
    rec.start();
  } catch {
    return toast('Не получилось включить микрофон. Попробуйте ещё раз.');
  }
  recognition = rec;
  $('mic-btn').setAttribute('aria-pressed', 'true');
  $('mic-btn').title = 'Остановить запись';
  input.placeholder = 'Говорите…';
}

// ─── Отправка ───────────────────────────────────────────────────────────────
function autosize() {
  const input = $('input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 176)}px`;
}

async function send(text) {
  if (recognition) stopDictation();
  text = String(text || '').trim();
  if (state.busy || (!text && !state.attachments.length)) return;
  const files = state.attachments.slice();
  const full = files.length
    ? `${text || 'Посмотри приложенные файлы.'}\n\n${ATTACH_HEAD}\n${files.map(p => `- ${p}`).join('\n')}`
    : text;
  state.pendingUser = { text: full, count: state.messages.filter(m => m.type === 'user').length };
  state.attachments = []; renderAttachments();
  $('input').value = ''; autosize();
  setBusy(true, 'Помощник думает…');
  render(true);
  try {
    const model = modelByKey(state.model);
    const wanted = { id: model.id, providerID: model.providerID };
    if (!state.currentId) {
      const session = await oc('/session', { method: 'POST', body: { location: { directory: WORKSPACE }, model: wanted } });
      state.currentId = session.id;
      loadSessions();
    } else {
      // Модель сменили посреди разговора — переключаем его перед отправкой
      const session = state.sessions.find(x => x.id === state.currentId);
      if (session && modelOfSession(session)?.key !== model.key) {
        await oc(`/session/${state.currentId}/model`, { method: 'POST', body: { model: wanted } });
        session.model = wanted;
      }
    }
    await oc(`/session/${state.currentId}/prompt`, { method: 'POST', body: { text: full } });
    scheduleRefetch(600);
  } catch {
    setBusy(false); state.pendingUser = null;
    $('input').value = text; autosize();
    state.attachments = files; renderAttachments();
    render();
    toast('Не получилось отправить. Попробуйте ещё раз.');
  }
}

async function stop() {
  if (!state.currentId) return;
  $('stop-btn').disabled = true;
  try { await oc(`/session/${state.currentId}/interrupt`, { method: 'POST' }); } catch { /* событие придёт или нет — обновимся ниже */ }
  $('stop-btn').disabled = false;
  scheduleRefetch(500);
}

// ─── События (поток с сервера) ──────────────────────────────────────────────
let events = null, eventsRetry = 1000;

function connectEvents() {
  events?.close();
  events = new EventSource('/api/oc/event');
  events.onopen = () => { eventsRetry = 1000; };
  events.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch { /* незнакомое событие */ } };
  events.onerror = () => {
    events.close();
    setTimeout(async () => {
      try { await oc('/session/active'); } catch { /* разбудим при следующем запросе */ }
      connectEvents();
    }, eventsRetry);
    eventsRetry = Math.min(eventsRetry * 2, 15000);
  };
}

let sessionsTimer;
const refreshSessionsSoon = () => { clearTimeout(sessionsTimer); sessionsTimer = setTimeout(loadSessions, 400); };

function handleEvent(ev) {
  const d = ev.data || {};
  const type = ev.type;
  if (type === 'server.connected') {
    loadSessions();
    if (state.currentId) scheduleRefetch(0);
    return;
  }
  if (type === 'session.created' || type === 'session.renamed' || type === 'session.deleted') refreshSessionsSoon();
  if (!state.currentId || d.sessionID !== state.currentId) return;

  switch (type) {
    case 'session.execution.started':
      setBusy(true, 'Помощник думает…'); render(); break;
    case 'session.step.started':
      state.live = { msgId: d.assistantMessageID, texts: new Map() };
      setBusy(true, 'Помощник думает…'); render(); break;
    case 'session.text.started':
      state.live.texts.set(d.ordinal, { text: '', ended: false }); break;
    case 'session.text.delta': {
      const cur = state.live.texts.get(d.ordinal) || { text: '', ended: false };
      cur.text += d.delta || '';
      state.live.texts.set(d.ordinal, cur);
      state.status = 'Помощник пишет…';
      render(); break;
    }
    case 'session.text.ended':
      state.live.texts.set(d.ordinal, { text: d.text || state.live.texts.get(d.ordinal)?.text || '', ended: true });
      scheduleRefetch(); break;
    case 'session.tool.input.started':
      state.toolNames.set(d.id, d.name);
      if (d.name !== 'execute') { state.status = `${stepLabel(d.name)}…`; render(); }
      break;
    case 'session.tool.called': {
      const name = state.toolNames.get(d.id) || d.name;
      if (!isInternalStep(name, d.input)) state.status = `${stepLabel(name, d.input)}…`;
      if (isBrowserStep(name, d.input) && !state.panel.autoOpened) { state.panel.autoOpened = true; openPanel('screen'); }
      scheduleRefetch(); break;
    }
    case 'session.tool.success': case 'session.tool.failed': case 'session.tool.progress':
    case 'session.step.ended': case 'session.step.failed': case 'session.synthetic':
      scheduleRefetch(); break;
    case 'session.execution.succeeded': case 'session.execution.interrupted': case 'session.execution.failed':
      setBusy(false);
      state.live = { msgId: null, texts: new Map() };
      state.asks = [];
      loadMessages().then(() => render(), () => render());
      refreshSessionsSoon();
      if (state.panel.open && state.panel.tab === 'files') loadFiles();
      break;
    case 'permission.asked':
      if (!state.asks.some(a => a.id === d.id)) state.asks.push(d);
      render(true); break;
    case 'permission.replied':
      state.asks = state.asks.filter(a => a.id !== d.requestID); render(); break;
    default:
  }
}

// ─── Правая панель: экран помощника ─────────────────────────────────────────
let RFB = null, rfb = null, screenTimer;

function screenStatus(text, spinning = true) {
  const node = $('screen-status');
  node.hidden = !text;
  if (text) node.replaceChildren(...(spinning ? [el('span', { className: 'spinner' })] : []), el('span', { textContent: text }));
}

const screenWanted = () => state.panel.open && state.panel.tab === 'screen' && !document.hidden;

async function connectScreen() {
  clearTimeout(screenTimer);
  if (rfb || !screenWanted()) return;
  screenStatus('Подключаем экран…');
  try {
    if (!RFB) {
      const probe = await fetch('/screen/core/rfb.js', { method: 'GET' });
      if (probe.status === 409) await wake();
      RFB = (await import('/screen/core/rfb.js')).default;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const conn = new RFB($('screen-view'), `${proto}://${location.host}/screen/websockify`);
    conn.scaleViewport = true; conn.resizeSession = false; conn.focusOnClick = true;
    conn.background = 'transparent';
    conn.addEventListener('connect', () => screenStatus(''));
    conn.addEventListener('disconnect', () => {
      if (rfb === conn) rfb = null;
      if (screenWanted()) { screenStatus('Подключаем экран…'); screenTimer = setTimeout(connectScreen, 2500); }
    });
    rfb = conn;
  } catch {
    screenStatus('Подключаем экран…');
    screenTimer = setTimeout(connectScreen, 4000);
  }
}

function disconnectScreen() {
  clearTimeout(screenTimer);
  const conn = rfb; rfb = null;
  try { conn?.disconnect(); } catch { /* уже закрыт */ }
}

// Вставка текста из буфера в облачный браузер: кладём в его буфер, дальше — обычное Ctrl+V там
document.addEventListener('paste', (e) => {
  if (!rfb || !$('screen-view').contains(document.activeElement)) return;
  const text = e.clipboardData?.getData('text');
  if (text) rfb.clipboardPasteFrom(text);
});

// ─── Правая панель: файлы ───────────────────────────────────────────────────
const encPath = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

// ─── Картинки в ответах ─────────────────────────────────────────────────────
// Ответ ссылается на файл человека; забираем его один раз и держим в памяти — лента перерисовывается часто
const imageCache = new Map(); // путь → адрес картинки | 'loading' | 'failed'
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
function showImages() {
  for (const img of $('feed-inner').querySelectorAll('img.md-image[data-file]')) {
    const file = img.dataset.file; const known = imageCache.get(file);
    if (known === 'failed') { img.replaceWith(el('span', { className: 'md-image-missing', textContent: `Картинка «${base(file)}» — откройте её в «Файлах»` })); continue; }
    if (known && known !== 'loading') { if (!img.src) img.src = known; continue; }
    if (known) continue;
    imageCache.set(file, 'loading');
    fetch(`/api/oc/fs/read/${encPath(file)}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(buf => imageCache.set(file, URL.createObjectURL(new Blob([buf], { type: IMAGE_TYPES[file.split('.').pop().toLowerCase()] || 'image/jpeg' }))))
      .catch(() => imageCache.set(file, 'failed'))
      .then(showImages);
  }
}
// Нажатие на картинку сохраняет её на устройство
document.addEventListener('click', (e) => {
  const img = e.target.closest?.('img.md-image[src]');
  if (img) el('a', { href: img.src, download: base(img.dataset.file) }).click();
});

async function loadFiles() {
  const dir = state.filesDir;
  renderCrumbs();
  try {
    const list = await oc(`/fs/list${dir ? `?path=${encodeURIComponent(dir)}` : ''}`);
    if (dir !== state.filesDir) return;
    const entries = (Array.isArray(list) ? list : [])
      .map(e => ({ path: e.path.replace(/\/$/, ''), dir: e.type === 'directory' }))
      .map(e => ({ ...e, name: base(e.path) }))
      .filter(e => e.name && !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'ru'));
    const box = $('file-list');
    if (!entries.length) {
      box.replaceChildren(el('div', { className: 'files-empty', textContent: dir
        ? 'В этой папке пока пусто.'
        : 'Здесь пока пусто. Сюда попадают ваши документы и то, что подготовил помощник.' }));
      return;
    }
    box.replaceChildren(...entries.map(e => e.dir
      ? el('div', { className: 'file-row', html: icon('folder', 18) },
          el('button', { className: 'file-name', type: 'button', textContent: e.name, on: { click: () => { state.filesDir = e.path; loadFiles(); } } }))
      : el('div', { className: 'file-row', html: icon('file', 18) },
          el('span', { className: 'file-name', textContent: e.name, title: e.name }),
          el('a', { className: 'btn-small', href: `/api/oc/fs/read/${encPath(e.path)}`, download: e.name, html: `${icon('download', 14)}Скачать` }))));
  } catch {
    $('file-list').replaceChildren(el('div', { className: 'files-empty', textContent: 'Не получилось показать файлы. Попробуйте ещё раз.' }));
  }
}

function renderCrumbs() {
  const parts = state.filesDir.split('/').filter(Boolean);
  const nodes = [];
  const go = (p) => () => { state.filesDir = p; loadFiles(); };
  if (!parts.length) nodes.push(el('strong', { textContent: 'Файлы' }));
  else nodes.push(el('button', { type: 'button', textContent: 'Файлы', on: { click: go('') } }));
  parts.forEach((p, i) => {
    nodes.push(el('span', { textContent: '/', attrs: { 'aria-hidden': 'true' } }));
    if (i === parts.length - 1) nodes.push(el('strong', { textContent: p }));
    else nodes.push(el('button', { type: 'button', textContent: p, on: { click: go(parts.slice(0, i + 1).join('/')) } }));
  });
  $('crumbs').replaceChildren(...nodes);
}

async function uploadOne(file, dir, retried = false) {
  const r = await fetch(`/api/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
  });
  if (r.status === 401) { toLogin(); throw new Error('Нужно войти'); }
  if (r.status === 409 && !retried) { await wake(); return uploadOne(file, dir, true); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Не получилось сохранить файл');
  return data.path;
}

async function uploadFiles(fileList, dir) {
  const files = [...fileList];
  if (!files.length) return [];
  toast(files.length === 1 ? `Загружаем «${files[0].name}»…` : `Загружаем файлы: ${files.length}…`);
  const done = [];
  for (const file of files) {
    try { done.push(await uploadOne(file, dir)); }
    catch (e) { toast(`«${file.name}»: ${e.message}`); }
  }
  if (done.length) toast(done.length === 1 ? 'Файл загружен' : `Загружено файлов: ${done.length}`);
  if (state.panel.open && state.panel.tab === 'files') loadFiles();
  return done;
}

function renderAttachments() {
  const box = $('composer-files');
  box.hidden = !state.attachments.length;
  box.replaceChildren(...state.attachments.map(p => el('span', { className: 'file-chip', html: icon('file', 14) },
    el('span', { textContent: base(p) }),
    el('button', { type: 'button', html: icon('x', 12), attrs: { 'aria-label': `Убрать файл ${base(p)}` },
      on: { click: () => { state.attachments = state.attachments.filter(x => x !== p); renderAttachments(); } } }))));
}

async function attach(fileList) {
  const paths = await uploadFiles(fileList, UPLOAD_DIR);
  state.attachments.push(...paths.filter(p => !state.attachments.includes(p)));
  renderAttachments();
  $('input').focus();
}

// ─── Сервисы ────────────────────────────────────────────────────────────────
async function svc(path, { method = 'GET', body } = {}, retried = false) {
  const r = await fetch(`/api/services${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { toLogin(); throw new Error('Нужно войти'); }
  if (r.status === 409 && !retried) { await wake(); return svc(path, { method, body }, true); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Не получилось. Попробуйте ещё раз.');
  return data;
}

const sv = { data: null, form: null, error: '', busy: null };
let signin = null; // идёт вход в сервис на «Экране помощника»

async function loadServices() {
  try { sv.data = await svc(''); sv.error = sv.error || ''; }
  catch (e) { if (!sv.data) sv.error = e.message; }
  renderServices();
}

function openServices() {
  sv.form = null; sv.error = '';
  $('services-modal').hidden = false;
  renderServices();
  loadServices();
}
const closeServices = () => { $('services-modal').hidden = true; };

const badge = (text, kind) => el('span', { className: `badge badge-${kind}`, html: kind === 'ok' ? icon('check', 12) : '' }, text);
const smallBtn = (text, onClick, extra = '') => el('button', { className: `btn-small ${extra}`, type: 'button', textContent: text, on: { click: onClick } });
const markClass = (name) => `service-mark m${[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 6}`;

function tile({ name, about, mark }, ...actions) {
  return el('div', { className: 'service' },
    el('span', { className: mark || markClass(name), textContent: name.trim()[0].toUpperCase(), attrs: { 'aria-hidden': 'true' } }),
    el('div', { className: 'service-info' },
      el('div', { className: 'service-name', textContent: name }),
      el('div', { className: 'service-about', textContent: about || '', title: about || '' })),
    el('div', { className: 'service-actions' }, ...actions));
}

function field(id, label, props = {}, hint) {
  return el('div', { className: 'form-group' },
    el('label', { htmlFor: id, textContent: label }),
    el('input', { id, ...props }),
    hint ? el('p', { className: 'field-hint', textContent: hint }) : null);
}

function serviceForm(fields, submitLabel, onSubmit) {
  const error = el('p', { className: 'field-error', hidden: true, attrs: { role: 'alert' } });
  const submit = el('button', { className: 'btn-primary', type: 'submit', textContent: submitLabel });
  const form = el('form', { className: 'service-form', on: { submit: async (e) => {
    e.preventDefault();
    error.hidden = true; submit.disabled = true;
    submit.innerHTML = '<span class="spinner" aria-hidden="true"></span> Подключаем…';
    try { await onSubmit(form); }
    catch (err) { error.textContent = err.message; error.hidden = false; submit.disabled = false; submit.textContent = submitLabel; }
  } } }, ...fields, error,
    el('div', { className: 'service-form-actions' },
      el('button', { className: 'btn-secondary', type: 'button', textContent: 'Отмена', on: { click: () => { sv.form = null; renderServices(); } } }),
      submit));
  return form;
}

function serviceActions(s) {
  if (sv.busy === s.id) return [el('span', { className: 'spinner', attrs: { 'aria-label': 'Подождите' } })];
  switch (s.state) {
    case 'connected': return [badge('Подключено', 'ok'), smallBtn('Отключить', () => disconnectService(s), 'btn-small-danger')];
    case 'soon': return [badge('Скоро', 'soon')];
    case 'pending': return [badge('Подключается…', 'soon')];
    case 'signin': return [smallBtn('Войти', () => connectService(s)), smallBtn('Убрать', () => disconnectService(s), 'btn-small-danger')];
    case 'failed': return [smallBtn('Попробовать ещё раз', () => connectService(s)), smallBtn('Убрать', () => disconnectService(s), 'btn-small-danger')];
    default: return [smallBtn('Подключить', () => connectService(s))];
  }
}

function renderServices() {
  const body = $('services-body');
  if (!sv.data) {
    body.replaceChildren(sv.error
      ? el('div', { className: 'error', textContent: sv.error })
      : el('div', { className: 'services-loading' }, el('span', { className: 'spinner' }), el('span', { textContent: 'Смотрим, что подключено…' })));
    return;
  }
  const nodes = [];
  if (sv.error) nodes.push(el('div', { className: 'error', textContent: sv.error, attrs: { role: 'alert' } }));

  nodes.push(el('div', { className: 'services-section', textContent: 'Ваша работа' }));
  const own = el('div', { className: 'service-list' },
    tile({ name: 'Task Manager', about: 'Ваши задачи, проекты, сроки и «Входящие»', mark: 'service-mark m0' }, badge('Подключено', 'ok')));
  const mail = sv.data.mail;
  if (mail) {
    own.append(mail.state === 'ok'
      ? tile({ name: 'Рабочая почта', about: mail.email, mark: 'service-mark m0' }, badge('Подключено', 'ok'), smallBtn('Отключить', disconnectMail, 'btn-small-danger'))
      : tile({ name: 'Рабочая почта', about: mail.email, mark: 'service-mark m0' },
          sv.form === 'mail' ? null : smallBtn('Подключить', () => { sv.form = 'mail'; sv.error = ''; renderServices(); $('mail-password')?.focus(); })));
    if (sv.form === 'mail' && mail.state !== 'ok') {
      own.append(serviceForm(
        [field('mail-password', `Пароль от почты ${mail.email}`, { type: 'password', autocomplete: 'off', required: true },
          'Пароль хранится на сервере в зашифрованном виде и нужен, чтобы помощник читал и отправлял письма от вашего имени.')],
        'Подключить почту',
        async (form) => {
          await svc('/mail', { method: 'POST', body: { password: form.querySelector('#mail-password').value } });
          sv.form = null; toast('Почта подключена'); await loadServices();
        }));
    }
  }
  nodes.push(own);

  nodes.push(el('div', { className: 'services-section', textContent: 'Другие сервисы' }));
  nodes.push(el('div', { className: 'service-list' }, ...sv.data.services.map(s => tile(s, ...serviceActions(s)))));

  if (sv.form === 'custom') {
    nodes.push(serviceForm([
      field('custom-name', 'Название', { type: 'text', required: true, maxLength: 40, placeholder: 'Например, CRM' }),
      field('custom-url', 'Адрес сервиса', { type: 'url', required: true, placeholder: 'https://…' }, 'Адрес для подключения помощников (MCP). Его даёт сам сервис или ваш администратор.'),
      field('custom-key', 'Ключ доступа (если есть)', { type: 'password', autocomplete: 'off' }, 'Если ключа нет, помощник попросит войти в сервис на «Экране помощника».')
    ], 'Добавить', async (form) => {
      const name = form.querySelector('#custom-name').value.trim();
      const r = await svc('/custom', { method: 'POST', body: { name, url: form.querySelector('#custom-url').value.trim(), key: form.querySelector('#custom-key').value } });
      sv.form = null;
      afterConnect({ name }, r);
      await loadServices();
    }));
  } else {
    nodes.push(el('div', { className: 'services-add' },
      el('button', { className: 'btn-secondary', type: 'button', html: `${icon('plus', 16)}Добавить другой сервис`,
        on: { click: () => { sv.form = 'custom'; sv.error = ''; renderServices(); $('custom-name')?.focus(); } } })));
  }
  body.replaceChildren(...nodes);
}

function afterConnect(s, r) {
  if (r.state === 'connected') toast(`«${s.name}» подключён`);
  else if (r.state === 'signin') startSignin(s, r);
  else toast('Сервис подключается — загляните в «Сервисы» через минуту');
}

async function connectService(s) {
  sv.busy = s.id; sv.error = ''; renderServices();
  try { afterConnect(s, await svc(`/${s.id}/connect`, { method: 'POST' })); }
  catch (e) { sv.error = `${s.name}: ${e.message}`; }
  sv.busy = null;
  await loadServices();
}

async function disconnectService(s) {
  if (!confirm(`Отключить «${s.name}»? Помощник больше не сможет им пользоваться, пока вы не подключите снова.`)) return;
  sv.busy = s.id; sv.error = ''; renderServices();
  try { await svc(`/${s.id}/disconnect`, { method: 'POST' }); toast(`«${s.name}» отключён`); }
  catch (e) { sv.error = `${s.name}: ${e.message}`; }
  sv.busy = null;
  await loadServices();
}

async function disconnectMail() {
  if (!confirm('Отключить рабочую почту? Помощник больше не сможет читать и отправлять письма.')) return;
  try { await svc('/mail', { method: 'DELETE' }); toast('Почта отключена'); }
  catch (e) { sv.error = e.message; }
  await loadServices();
}

// Вход в сервис: страница входа уже открыта в облачном браузере — показываем экран и ждём, пока человек войдёт
function endSignin() {
  clearInterval(signin?.timer);
  signin = null;
  $('signin-banner').hidden = true;
  $('screen-hint').hidden = false;
}

function startSignin(s, r) {
  if (signin) endSignin();
  const cur = { name: s.name, integrationID: r.integrationID, attemptID: r.attemptID };
  signin = cur;
  closeServices();
  openPanel('screen');
  $('signin-text').textContent = `Войдите в «${s.name}» на этом экране и разрешите доступ. Когда закончите, сервис подключится сам.`;
  $('signin-banner').hidden = false;
  $('screen-hint').hidden = true;
  cur.timer = setInterval(async () => {
    try {
      const { status } = await svc(`/attempt/${cur.integrationID}/${cur.attemptID}`);
      if (signin !== cur) return;
      if (status === 'complete') { endSignin(); toast(`«${cur.name}» подключён`); }
      else if (status === 'failed' || status === 'expired') { endSignin(); toast(`Не получилось войти в «${cur.name}». Попробуйте ещё раз в «Сервисах».`); }
    } catch { /* попробуем на следующем круге */ }
  }, 2500);
}

function cancelSignin() {
  const cur = signin;
  if (!cur) return;
  endSignin();
  svc(`/attempt/${cur.integrationID}/${cur.attemptID}`, { method: 'DELETE' }).catch(() => {});
}

// ─── Панель и боковая колонка ───────────────────────────────────────────────
function syncPanel() {
  const { open, tab } = state.panel;
  $('panel').hidden = !open;
  $('toggle-screen').setAttribute('aria-pressed', String(open && tab === 'screen'));
  $('toggle-files').setAttribute('aria-pressed', String(open && tab === 'files'));
  $('tab-screen').setAttribute('aria-selected', String(tab === 'screen'));
  $('tab-files').setAttribute('aria-selected', String(tab === 'files'));
  $('body-screen').hidden = tab !== 'screen';
  $('body-files').hidden = tab !== 'files';
  if (screenWanted()) connectScreen(); else disconnectScreen();
  if (open && tab === 'files') loadFiles();
}
// Панель меняет ширину переписки — возвращаем её к последнему сообщению
const stickBottom = () => requestAnimationFrame(() => { const f = $('feed'); f.scrollTop = f.scrollHeight; });
function openPanel(tab) { state.panel.open = true; state.panel.tab = tab; syncPanel(); stickBottom(); }
function closePanel() { state.panel.open = false; syncPanel(); stickBottom(); }
function togglePanel(tab) { if (state.panel.open && state.panel.tab === tab) closePanel(); else openPanel(tab); }

function closeSidebar() { $('sidebar').classList.remove('open'); $('backdrop').classList.remove('open'); }
function toggleSidebar() { const open = $('sidebar').classList.toggle('open'); $('backdrop').classList.toggle('open', open); }

// ─── Запуск ─────────────────────────────────────────────────────────────────
function initStatic() {
  $('logo-mark').innerHTML = icon('sparkles', 20);
  $('menu-btn').innerHTML = icon('menu', 20);
  $('toggle-screen').innerHTML = `${icon('screen', 16)}<span>Экран помощника</span>`;
  $('toggle-files').innerHTML = `${icon('folder', 16)}<span>Файлы</span>`;
  $('logout-btn').innerHTML = `${icon('logout', 16)}<span>Выйти</span>`;
  $('new-chat').innerHTML = `${icon('plus', 16)}Новый разговор`;
  $('attach-btn').innerHTML = icon('paperclip', 20);
  $('send-btn').innerHTML = icon('send', 18);
  $('panel-close').innerHTML = icon('x', 18);
  $('upload-btn').innerHTML = `${icon('upload', 14)}Загрузить`;
  $('services-btn').innerHTML = `${icon('grid', 16)}<span>Сервисы</span>`;
  $('services-close').innerHTML = icon('x', 20);
  $('services-btn').addEventListener('click', openServices);
  $('services-close').addEventListener('click', closeServices);
  $('services-modal').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeServices(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('services-modal').hidden) closeServices(); });
  $('signin-cancel').addEventListener('click', cancelSignin);

  $('menu-btn').addEventListener('click', toggleSidebar);
  $('backdrop').addEventListener('click', closeSidebar);
  $('new-chat').addEventListener('click', newChat);
  $('toggle-screen').addEventListener('click', () => togglePanel('screen'));
  $('toggle-files').addEventListener('click', () => togglePanel('files'));
  $('tab-screen').addEventListener('click', () => openPanel('screen'));
  $('tab-files').addEventListener('click', () => openPanel('files'));
  $('panel-close').addEventListener('click', closePanel);
  $('logout-btn').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); toLogin(); });
  $('stop-btn').addEventListener('click', stop);

  if (Recognition) {
    $('mic-btn').innerHTML = icon('mic', 20);
    $('mic-btn').hidden = false;
    $('mic-btn').addEventListener('click', () => (recognition ? stopDictation() : startDictation()));
  }
  renderModel();
  $('model-btn').addEventListener('click', () => toggleModelMenu());
  document.addEventListener('mousedown', (e) => { if (!$('model-menu').hidden && !e.target.closest('.model-picker')) toggleModelMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('model-menu').hidden) { toggleModelMenu(false); $('model-btn').focus(); } });

  const input = $('input');
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

  $('attach-btn').addEventListener('click', () => $('attach-input').click());
  $('attach-input').addEventListener('change', (e) => { attach(e.target.files); e.target.value = ''; });
  $('upload-btn').addEventListener('click', () => $('upload-input').click());
  $('upload-input').addEventListener('change', (e) => { uploadFiles(e.target.files, state.filesDir); e.target.value = ''; });

  // Перетаскивание: на список файлов — в открытую папку, на переписку — приложить к сообщению
  const dropZone = (node, onDrop, cls) => {
    node.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); if (cls) node.classList.add(cls); } });
    node.addEventListener('dragleave', () => cls && node.classList.remove(cls));
    node.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); if (cls) node.classList.remove(cls);
      onDrop(e.dataTransfer.files);
    });
  };
  dropZone($('body-files'), (files) => uploadFiles(files, state.filesDir), 'files-drop');
  dropZone(document.querySelector('.chat'), attach);

  document.addEventListener('visibilitychange', () => {
    if (screenWanted()) connectScreen(); else disconnectScreen();
    if (!document.hidden && state.currentId) scheduleRefetch(0);
  });
  // Пока страница открыта и видна, рабочее место не засыпает
  setInterval(() => { if (!document.hidden) fetch('/api/ping', { method: 'POST' }).catch(() => {}); }, 60000);
}

async function boot() {
  const cover = $('cover');
  const fail = (title, text) => {
    cover.querySelector('.spinner').hidden = true;
    $('cover-title').textContent = title; $('cover-text').textContent = text;
    $('cover-retry').hidden = false;
  };
  $('cover-retry').onclick = () => {
    cover.querySelector('.spinner').hidden = false; $('cover-retry').hidden = true;
    $('cover-title').textContent = 'Готовим всё к работе…'; $('cover-text').textContent = 'Обычно это занимает до полминуты.';
    boot();
  };
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) return toLogin();
    state.me = await r.json();
    const name = state.me.user.name || state.me.user.email;
    $('user-name').textContent = name;
    $('avatar').textContent = (name.trim()[0] || '?').toUpperCase();
    $('user-chip').hidden = false;
  } catch {
    return fail('Нет связи с сервером', 'Проверьте интернет и попробуйте ещё раз.');
  }
  try {
    await start();
  } catch (e) {
    return fail('Не получилось начать', e.message);
  }
  cover.hidden = true;
  connectEvents();
  await loadSessions();
  render();
  $('input').focus();
}

initStatic();
render();
boot();
