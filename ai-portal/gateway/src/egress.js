// Выход сред в интернет. Среды ходят на сайты не напрямую, а через этот прокси (тот же порт 3210, что и прокси моделей):
//   российские адреса   → напрямую с этого сервера (как раньше);
//   всё остальное       → через туннель на зарубежный сервер (ssh -D), если он настроен и поднят; иначе тоже напрямую.
// Так открываются сайты, недоступные с российского сервера, а российские сайты по-прежнему видят российский адрес.
//
// Безопасность: прокси — единственный путь из среды к адресам, куда этот сервер умеет ходить, поэтому имя сайта
// сначала превращается в адрес здесь, и соединение идёт только на публичный адрес: к самому серверу, его локальным
// службам, другим средам и внутренним сетям (в том числе зарубежного сервера) через прокси попасть нельзя.
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dns = require('dns').promises;
const { spawn } = require('child_process');
const config = require('./config');

const E = config.egress;
const ip4 = (s) => s.split('.').reduce((a, b) => (a * 256 + Number(b)) >>> 0, 0);
const inRange = (n, cidr) => { const [b, bits] = cidr.split('/'); const m = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0; return ((n & m) >>> 0) === ((ip4(b) & m) >>> 0); };

// Куда через прокси ходить нельзя: локальные, служебные и внутренние адреса
const PRIVATE = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/3'];
const ownAddresses = () => new Set(Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4').map(a => a.address));
function isPublic(ip) {
  if (!net.isIPv4(ip)) return false;
  const n = ip4(ip);
  return !PRIVATE.some(c => inRange(n, c));
}
// Собственные адреса сервера (в том числе внешний): из среды — только его открытые сайты, не остальные порты
let publicIps = new Set();
dns.resolve4(new URL(config.publicUrl).hostname).then(ips => { publicIps = new Set(ips); }).catch(() => {});
const isOwn = (ip) => ownAddresses().has(ip) || publicIps.has(ip);

// ─── Российские адреса ──────────────────────────────────────────────────────
// Список сетей России (RIPE) — отсортированные отрезки [начало, конец]. Хранится в data/, обновляется раз в неделю.
let ruRanges = [];
const RU_FILE = path.join(path.dirname(config.llm.usageLog), 'ru-ipv4.json');
function setRanges(prefixes) {
  const list = [];
  for (const p of prefixes) {
    if (p.includes('-')) { const [a, b] = p.split('-'); list.push([ip4(a.trim()), ip4(b.trim())]); continue; }
    const [b, bits = '32'] = p.split('/');
    if (!net.isIPv4(b)) continue;
    const start = ip4(b); list.push([start, (start + 2 ** (32 - Number(bits)) - 1) >>> 0]);
  }
  list.sort((x, y) => x[0] - y[0]);
  ruRanges = list;
}
function isRussian(ip) {
  const n = ip4(ip); let lo = 0, hi = ruRanges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; const [a, b] = ruRanges[mid];
    if (n < a) hi = mid - 1; else if (n > b) lo = mid + 1; else return true;
  }
  return false;
}
async function refreshRanges() {
  try {
    const st = fs.existsSync(RU_FILE) ? fs.statSync(RU_FILE) : null;
    if (st) setRanges(JSON.parse(fs.readFileSync(RU_FILE, 'utf8')));
    if (st && Date.now() - st.mtimeMs < 7 * 864e5 && ruRanges.length > 1000) return;
    const r = await fetch('https://stat.ripe.net/data/country-resource-list/data.json?resource=RU&v4_format=prefix', { signal: AbortSignal.timeout(60000) });
    const prefixes = (await r.json())?.data?.resources?.ipv4 || [];
    if (prefixes.length < 1000) throw new Error(`подозрительно короткий список: ${prefixes.length}`);
    fs.writeFileSync(RU_FILE, JSON.stringify(prefixes));
    setRanges(prefixes);
    console.log(`[egress] список российских сетей обновлён: ${prefixes.length}`);
  } catch (e) {
    console.error(`[egress] не удалось обновить список российских сетей (${e.message}); в памяти ${ruRanges.length}`);
  }
}

// ─── Туннель на зарубежный сервер ───────────────────────────────────────────
let tunnelProc = null; let stopping = false;
function startTunnel() {
  if (!E.sshTarget) { console.log('[egress] зарубежный туннель не настроен — все сайты открываются напрямую'); return; }
  const args = ['-i', E.sshKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
    '-N', '-D', `127.0.0.1:${E.socksPort}`, E.sshTarget];
  tunnelProc = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  tunnelProc.stderr.on('data', d => { err = (err + d).slice(-400); });
  tunnelProc.on('exit', (code) => {
    tunnelProc = null;
    if (stopping) return;
    console.error(`[egress] туннель оборвался (код ${code}) ${err.trim().split('\n').pop() || ''} — переподключение через 5 с`);
    setTimeout(startTunnel, 5000);
  });
  console.log(`[egress] туннель: ${E.sshTarget} → 127.0.0.1:${E.socksPort}`);
}
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) process.on(sig, () => { stopping = true; tunnelProc?.kill(); if (sig !== 'exit') process.exit(0); });

// Соединение через SOCKS5 туннеля. target — { ip } или { host } (имя — только для сайтов из своего списка)
function viaTunnel(target, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(E.socksPort, '127.0.0.1');
    const fail = (e) => { s.destroy(); reject(e instanceof Error ? e : new Error(e)); };
    s.setTimeout(20000, () => fail('туннель не ответил'));
    s.once('error', fail);
    let stage = 0; let buf = Buffer.alloc(0);
    s.once('connect', () => s.write(Buffer.from([5, 1, 0])));
    s.on('data', function onData(d) {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 5 || buf[1] !== 0) return fail('туннель отклонил приветствие');
        buf = buf.subarray(2); stage = 1;
        const addr = target.ip
          ? Buffer.from([1, ...target.ip.split('.').map(Number)])
          : Buffer.concat([Buffer.from([3, Buffer.byteLength(target.host)]), Buffer.from(target.host)]);
        s.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 255])]));
      }
      if (stage === 1) {
        if (buf.length < 5) return;
        const need = buf[3] === 1 ? 10 : buf[3] === 4 ? 22 : 7 + buf[4];
        if (buf.length < need) return;
        if (buf[1] !== 0) return fail(`сайт недоступен через туннель (код ${buf[1]})`);
        s.removeListener('data', onData); s.removeListener('error', fail); s.setTimeout(0);
        const rest = buf.subarray(need);
        if (rest.length) s.unshift(rest);
        resolve(s);
      }
    });
  });
}

function direct(ip, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: ip, port, timeout: 20000 });
    s.once('connect', () => { s.setTimeout(0); s.removeAllListeners('error'); resolve(s); });
    s.once('timeout', () => { s.destroy(); reject(new Error('сайт не ответил')); });
    s.once('error', reject);
  });
}

// ─── Выбор пути ─────────────────────────────────────────────────────────────
const RU_TLD = /\.(ru|su|xn--p1ai|moscow|xn--80adxhks|tatar|xn--p1acf|xn--d1acj3b)$/;
const matches = (host, list) => list.some(d => host === d || host.endsWith('.' + d));
const dnsCache = new Map(); // имя → { ips, until }
async function resolve(host) {
  if (net.isIPv4(host)) return [host];
  if (net.isIP(host)) throw new Error('адреса IPv6 не поддерживаются');
  const c = dnsCache.get(host);
  if (c && c.until > Date.now()) return c.ips;
  const ips = await dns.resolve4(host);
  if (dnsCache.size > 5000) dnsCache.clear();
  dnsCache.set(host, { ips, until: Date.now() + 60000 });
  return ips;
}

const stats = { direct: 0, tunnel: 0, fallback: 0, refused: 0 };

// → { socket, route }. Бросает ошибку с .status, если туда нельзя или не получилось.
async function open(hostRaw, port) {
  const host = String(hostRaw).toLowerCase().replace(/\.$/, '');
  const deny = (m, status = 403) => { stats.refused++; return Object.assign(new Error(m), { status }); };
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw deny('Некорректный адрес', 400);
  if (port === 25) throw deny('Порт 25 закрыт');
  const tunnelUp = Boolean(tunnelProc);

  // Сайты из своего списка идут через туннель по имени: их адреса внутри России могут отличаться
  if (tunnelUp && !net.isIP(host) && matches(host, E.forceTunnel)) {
    try { const socket = await viaTunnel({ host }, port); stats.tunnel++; return { socket, route: 'tunnel' }; } catch { /* ниже — обычный путь */ }
  }

  let ips;
  try { ips = await resolve(host); } catch { throw deny(`Сайт ${host} не найден`, 502); }
  const ip = ips.find(isPublic);
  if (!ip) throw deny(`Адрес ${host} недоступен из среды`);
  if (isOwn(ip) && port !== 80 && port !== 443) throw deny(`Адрес ${host}:${port} недоступен из среды`);

  const russian = RU_TLD.test(host) || isRussian(ip) || matches(host, E.forceDirect);
  if (!russian && tunnelUp) {
    try { const socket = await viaTunnel({ ip }, port); stats.tunnel++; return { socket, route: 'tunnel' }; }
    catch (e) { if (/код/.test(e.message)) throw deny(e.message, 502); stats.fallback++; /* туннель лёг — пробуем напрямую */ }
  }
  try { const socket = await direct(ip, port); stats.direct++; return { socket, route: 'direct' }; }
  catch (e) { throw deny(`Не удалось открыть ${host}: ${e.message}`, 502); }
}

// ─── Прокси для сред ────────────────────────────────────────────────────────
const SANDBOX_NET = '172.30.0.0/24';
const fromSandbox = (socket) => {
  const a = String(socket.remoteAddress || '').replace(/^::ffff:/, '');
  return net.isIPv4(a) && inRange(ip4(a), SANDBOX_NET) && a !== config.llm.host;
};

// HTTPS и всё остальное: CONNECT host:port
function handleConnect(req, client, head) {
  client.on('error', () => {});
  const reply = (status, text) => client.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  if (!fromSandbox(client)) return reply(403, 'Forbidden');
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || '');
  if (!m) return reply(400, 'Bad Request');
  open(m[1], Number(m[2])).then(({ socket }) => {
    if (client.destroyed) return socket.destroy();
    socket.on('error', () => client.destroy());
    client.on('close', () => socket.destroy());
    socket.on('close', () => client.destroy());
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) socket.write(head);
    socket.pipe(client); client.pipe(socket);
  }).catch(e => reply(e.status || 502, e.status === 403 ? 'Forbidden' : 'Bad Gateway'));
}

// Обычный http://: запрос с полным адресом. Возвращает false, если это не запрос через прокси.
function handleHttp(req, res) {
  if (!/^http:\/\//i.test(req.url)) return false;
  let u;
  try { u = new URL(req.url); } catch { res.writeHead(400); res.end(); return true; }
  // Среда обратилась к самому шлюзу «через прокси» — это обычный запрос к прокси моделей
  if (u.hostname === config.llm.host && Number(u.port || 80) === config.llm.port) { req.url = u.pathname + u.search; return false; }
  if (!fromSandbox(req.socket)) { res.writeHead(403); res.end(); return true; }
  open(u.hostname, Number(u.port || 80)).then(({ socket }) => {
    const headers = { ...req.headers, connection: 'close' };
    delete headers['proxy-connection']; delete headers['proxy-authorization'];
    const up = http.request({ method: req.method, path: u.pathname + u.search, headers, createConnection: () => socket, setHost: false });
    up.on('response', (r) => { res.writeHead(r.statusCode, r.statusMessage, r.rawHeaders); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => socket.destroy());
    req.pipe(up);
  }).catch(e => { res.writeHead(e.status || 502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e.message); });
  return true;
}

function startEgress(server) {
  server.on('connect', handleConnect);
  refreshRanges();
  setInterval(refreshRanges, 864e5).unref();
  startTunnel();
  setInterval(() => {
    if (stats.direct + stats.tunnel + stats.refused === 0) return;
    console.log(`[egress] за час: напрямую ${stats.direct}, через туннель ${stats.tunnel}, туннель лежал ${stats.fallback}, отказано ${stats.refused}`);
    stats.direct = stats.tunnel = stats.fallback = stats.refused = 0;
  }, 3600e3).unref();
}

module.exports = { startEgress, handleHttp, open, isPublic, isRussian, setRanges };
