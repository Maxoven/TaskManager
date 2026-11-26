// Сторож памяти сред. Главный потребитель памяти в среде — облачный браузер: вкладки копятся (подручные открывают
// новые и не закрывают), и когда среда упирается в свой потолок, ядро убивает её целиком — вместе с задачей.
// Сторож не даёт до этого дойти: держит число вкладок в разумных пределах, при нехватке памяти закрывает фоновые
// вкладки, а если не помогло — перезапускает браузер. Помощник (OpenCode) при этом продолжает работать.
const fs = require('fs');
const config = require('./config');
const containers = require('./containers');

const W = config.memwatch;
const CDP = 'http://127.0.0.1:9222';
const last = new Map();   // userId → { at, level } — когда и что делали в последний раз
const tabsAt = new Map(); // userId → когда последний раз считали вкладки

// Занятая память среды в долях потолка. Берём из cgroup контейнера: «кэш файлов» ядро освободит само,
// а вот память самой песочницы (shmem) — нет, поэтому её считаем занятой.
function usage(containerId) {
  const dir = `/sys/fs/cgroup/system.slice/docker-${containerId}.scope`;
  try {
    const max = Number(fs.readFileSync(`${dir}/memory.max`, 'utf8'));
    const cur = Number(fs.readFileSync(`${dir}/memory.current`, 'utf8'));
    const stat = Object.fromEntries(fs.readFileSync(`${dir}/memory.stat`, 'utf8').trim().split('\n').map(l => l.split(' ')));
    const reclaimable = Math.max(0, Number(stat.file || 0) - Number(stat.shmem || 0));
    if (!max || !Number.isFinite(max)) return null;
    return { used: cur - reclaimable, max, share: (cur - reclaimable) / max };
  } catch { return null; }
}

// Вкладки браузера среды: самая недавняя — первая
async function tabs(userId) {
  const r = await containers.exec(userId, ['curl', '-s', '-m', '5', `${CDP}/json/list`]);
  try { return JSON.parse(r.stdout).filter(t => t.type === 'page'); } catch { return null; }
}
async function closeTabs(userId, list) {
  if (!list.length) return;
  await containers.exec(userId, ['bash', '-c', list.map(t => `curl -s -m 5 -o /dev/null ${CDP}/json/close/${t.id}`).join('; ')]);
}

async function check(userId, containerId) {
  const now = Date.now();
  const u = usage(containerId);
  const state = last.get(userId) || { at: 0 };
  const cooled = now - state.at > W.cooldownMs;

  if (u && u.share >= W.restartAt && cooled) {
    // Закрыть вкладки не помогло или память растёт слишком быстро — перезапускаем браузер (его поднимет среда сама)
    last.set(userId, { at: now });
    await containers.exec(userId, ['pkill', '-x', 'chromium']);
    return console.log(`[память] u${userId}: ${(u.share * 100).toFixed(0)}% потолка — перезапустил браузер`);
  }
  if (u && u.share >= W.trimAt && cooled) {
    const list = await tabs(userId);
    if (list && list.length > W.keepUnderPressure) {
      last.set(userId, { at: now });
      await closeTabs(userId, list.slice(W.keepUnderPressure));
      return console.log(`[память] u${userId}: ${(u.share * 100).toFixed(0)}% потолка — закрыл фоновые вкладки (${list.length - W.keepUnderPressure} из ${list.length})`);
    }
  }
  // Раз в минуту — просто порядок: не больше maxTabs вкладок
  if (now - (tabsAt.get(userId) || 0) > 60000) {
    tabsAt.set(userId, now);
    const list = await tabs(userId);
    if (list && list.length > W.maxTabs) {
      await closeTabs(userId, list.slice(W.maxTabs));
      console.log(`[память] u${userId}: вкладок ${list.length} — закрыл самые старые (${list.length - W.maxTabs})`);
    }
  }
}

function startMemwatch() {
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
      for (const { id, containerId } of await containers.listRunningDetailed()) {
        await check(id, containerId).catch(e => console.error(`[память] u${id}:`, e.message));
      }
    } catch (e) { console.error('[память]', e.message); } finally { busy = false; }
  }, W.intervalMs).unref();
}

module.exports = { startMemwatch, usage };
