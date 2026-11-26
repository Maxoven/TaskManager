// Среды пользователей: по контейнеру aiportal-u<ID> на человека, в песочнице gVisor, со своим диском.
// Запускаются по требованию, засыпают после простоя; файлы на диске пользователя остаются.
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Docker = require('dockerode');
const config = require('./config');
const { userToken } = require('./tokens');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const run = promisify(execFile);
const S = config.sandbox;

const nameFor = (userId) => `aiportal-u${userId}`;
const lastActivity = new Map(); // userId → ms
const starting = new Map();     // userId → Promise
const cache = new Map();        // userId → { ip, password, at }

function touch(userId) { lastActivity.set(Number(userId), Date.now()); }

async function inspect(userId) {
  try {
    return await docker.getContainer(nameFor(userId)).inspect();
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

function endpointOf(info) {
  const ip = info?.NetworkSettings?.Networks?.[S.network]?.IPAddress;
  const pw = (info?.Config?.Env || []).find(e => e.startsWith('OPENCODE_PASSWORD='))?.slice(18);
  return ip && pw ? { ip, password: pw } : null;
}

async function listRunning() {
  const list = await docker.listContainers({ filters: { label: ['aiportal.user'], status: ['running'] } });
  return list.map(c => Number(c.Labels['aiportal.user']));
}

async function listRunningDetailed() {
  const list = await docker.listContainers({ filters: { label: ['aiportal.user'], status: ['running'] } });
  return list.map(c => ({ id: Number(c.Labels['aiportal.user']), containerId: c.Id }));
}

// Сколько памяти дать среде, которая сейчас запускается: «большие» места — первым bigSlots работающим
const memoryOf = (mb) => ({ Memory: mb * 1024 * 1024, MemorySwap: (mb + S.swapMb) * 1024 * 1024 });
async function memoryForNext() {
  const running = await docker.listContainers({ filters: { label: ['aiportal.user'], status: ['running'] } });
  let big = 0;
  for (const c of running) {
    const info = await docker.getContainer(c.Id).inspect();
    if (info.HostConfig.Memory >= S.memoryMb * 1024 * 1024) big++;
  }
  return big < S.bigSlots ? S.memoryMb : S.memorySmallMb;
}

async function imageId() {
  return (await docker.getImage(S.image).inspect()).Id;
}

async function create(user, memoryMb) {
  await run('sudo', [S.volumeHelper, 'ensure', String(user.id), String(S.diskGb)]);
  const password = crypto.randomBytes(24).toString('base64url');
  return docker.createContainer({
    name: nameFor(user.id),
    Image: S.image,
    Hostname: 'workspace',
    Labels: { 'aiportal.user': String(user.id), 'aiportal.email': user.email },
    Env: [
      `OPENCODE_PASSWORD=${password}`,
      `AIPORTAL_TOKEN=${userToken(user.id)}`,
      `AIPORTAL_SCREEN=${S.screen}`,
      `AIPORTAL_USER_NAME=${user.name || ''}`,
      'TZ=Europe/Moscow'
    ],
    HostConfig: {
      Runtime: S.runtime,
      NetworkMode: S.network,
      Binds: [
        `${S.dataDir}/home/u${user.id}:/home/user`,
        `${S.resolvConf}:/etc/resolv.conf:ro`
      ],
      ...memoryOf(memoryMb),
      NanoCpus: Math.round(S.cpus * 1e9),
      PidsLimit: 2048,
      ShmSize: 512 * 1024 * 1024,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      LogConfig: { Type: 'local', Config: { 'max-size': '5m' } },
      RestartPolicy: { Name: 'no' }
    }
  });
}

async function waitReady(ep, ms = 90000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://${ep.ip}:4096/api/info`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`opencode:${ep.password}`).toString('base64') },
        signal: AbortSignal.timeout(3000)
      });
      if (r.ok) return true;
    } catch { /* ещё стартует */ }
    await new Promise(r => setTimeout(r, 700));
  }
  throw new Error('Среда не запустилась за отведённое время');
}

// → { state: 'running', endpoint } | { state: 'busy', active }
async function ensureRunning(user) {
  const id = Number(user.id);
  if (starting.has(id)) return starting.get(id);
  const p = (async () => {
    let info = await inspect(id);
    if (info?.State?.Running) {
      const ep = endpointOf(info);
      cache.set(id, { ...ep, at: Date.now() });
      touch(id);
      return { state: 'running', endpoint: ep };
    }
    const running = await listRunning();
    if (running.length >= S.maxActive) return { state: 'busy', active: running.length, max: S.maxActive };

    // Остановленный контейнер со старым образом пересоздаём — данные на диске пользователя, не в контейнере
    if (info && info.Image !== await imageId()) {
      await docker.getContainer(nameFor(id)).remove({ force: true });
      info = null;
    }
    const memoryMb = await memoryForNext();
    if (!info) await create(user, memoryMb);
    else {
      await run('sudo', [S.volumeHelper, 'ensure', String(id), String(S.diskGb)]);
      // Среда уже есть — выставляем ей память под свободное сейчас место (применится при запуске)
      if (info.HostConfig.Memory !== memoryOf(memoryMb).Memory) await docker.getContainer(nameFor(id)).update(memoryOf(memoryMb));
    }
    await docker.getContainer(nameFor(id)).start();
    info = await inspect(id);
    const ep = endpointOf(info);
    await waitReady(ep);
    cache.set(id, { ...ep, at: Date.now() });
    touch(id);
    return { state: 'running', endpoint: ep };
  })();
  starting.set(id, p);
  try { return await p; } finally { starting.delete(id); }
}

// Адрес работающей среды без запуска (для проксирования). null — не запущена.
async function endpoint(userId) {
  const id = Number(userId);
  const c = cache.get(id);
  if (c && Date.now() - c.at < 30000) return c;
  const info = await inspect(id);
  if (!info?.State?.Running) { cache.delete(id); return null; }
  const ep = endpointOf(info);
  cache.set(id, { ...ep, at: Date.now() });
  return ep;
}

// Выполнить команду в среде человека от его имени (не root). Возвращает код выхода и вывод.
async function exec(userId, cmd) {
  const e = await docker.getContainer(nameFor(userId)).exec({ Cmd: cmd, User: 'user', AttachStdout: true, AttachStderr: true });
  const stream = await e.start({});
  const out = [], err = [];
  await new Promise((resolve, reject) => {
    docker.modem.demuxStream(stream, { write: (c) => out.push(c) }, { write: (c) => err.push(c) });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const info = await e.inspect();
  return { code: info.ExitCode, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') };
}

async function stop(userId) {
  const id = Number(userId);
  cache.delete(id);
  try { await docker.getContainer(nameFor(id)).stop({ t: 10 }); } catch (e) { if (e.statusCode !== 304 && e.statusCode !== 404) throw e; }
}

async function status(userId) {
  const info = await inspect(userId);
  if (!info) return { state: 'none' };
  return { state: info.State.Running ? 'running' : 'stopped', startedAt: info.State.StartedAt };
}

// Засыпание после простоя: ни запросов к среде, ни обращений агента к моделям
function startReaper() {
  setInterval(async () => {
    try {
      const now = Date.now();
      for (const id of await listRunning()) {
        if (!lastActivity.has(id)) { touch(id); continue; } // шлюз перезапускался — даём отсрочку
        // Среду могли запустить заново уже после последней отметки — простой считаем не раньше её запуска
        const startedAt = Date.parse((await inspect(id))?.State?.StartedAt || '') || 0;
        if (now - Math.max(lastActivity.get(id), startedAt) > S.idleMinutes * 60000) {
          console.log(`[reaper] u${id}: простой ${S.idleMinutes} мин — останавливаю`);
          await stop(id);
          lastActivity.delete(id);
        }
      }
    } catch (e) {
      console.error('[reaper]', e.message);
    }
  }, 60000).unref();
}

module.exports = { ensureRunning, endpoint, exec, stop, status, touch, listRunning, listRunningDetailed, startReaper };
