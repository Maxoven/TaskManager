require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задано ${name} в .env`);
  return v;
}

module.exports = {
  port: num(process.env.PORT, 3200),
  publicUrl: process.env.PUBLIC_URL || 'https://ai.ecoestate.tv',
  sessionSecret: required('SESSION_SECRET'),
  taskmanagerApi: process.env.TASKMANAGER_API || 'http://127.0.0.1:3001/api',
  // OAuth-клиент Google (тип «Desktop app») для Gmail, Календаря и Диска. Пока не задан — эти сервисы показаны как «скоро».
  google: { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '', clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '' },
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 100),
  taskmanagerEnvFile: process.env.TASKMANAGER_ENV || '/var/www/taskmanager/backend/.env',
  taskmanagerUrl: process.env.TASKMANAGER_URL || 'https://taskmanager.ecoestate.tv',

  // Прокси моделей: слушает адрес сервера в сети aiportal — его видят только среды
  llm: {
    host: process.env.LLM_HOST || '172.30.0.1',
    port: num(process.env.LLM_PORT, 3210),
    providers: {
      deepseek: { base: 'https://api.deepseek.com', key: process.env.DEEPSEEK_API_KEY, models: ['deepseek-flash'] },
      zai: { base: 'https://api.z.ai/api/paas/v4', key: process.env.ZAI_API_KEY, models: ['glm-5.3'] },
      // GigaChat (Сбер): ключ авторизации из личного кабинета; формат переводит gigachat.js
      giga: {
        adapter: 'gigachat', base: 'https://api.giga.chat/v1', oauth: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
        key: process.env.GIGACHAT_AUTH_KEY, scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS', models: ['GigaChat-3-Ultra']
      }
    },
    usageLog: process.env.USAGE_LOG || require('path').join(__dirname, '..', 'data', 'usage.jsonl')
  },

  // Выход сред в интернет: зарубежные сайты — через туннель ssh на свой сервер за границей (EGRESS_SSH=user@host).
  // Не задан — все сайты открываются напрямую с этого сервера.
  egress: {
    sshTarget: process.env.EGRESS_SSH || '',
    sshKey: process.env.EGRESS_SSH_KEY || require('path').join(require('os').homedir(), '.ssh', 'aiportal_tunnel'),
    socksPort: num(process.env.EGRESS_SOCKS_PORT, 1081),
    // Всегда через туннель и по имени (внутри России у них свои, замедленные адреса) / всегда напрямую
    forceTunnel: (process.env.EGRESS_FORCE_TUNNEL || 'youtube.com,youtu.be,googlevideo.com,ytimg.com,ggpht.com,youtube-nocookie.com').split(',').map(s => s.trim()).filter(Boolean),
    forceDirect: (process.env.EGRESS_FORCE_DIRECT || '').split(',').map(s => s.trim()).filter(Boolean)
  },

  // Сторож памяти сред (memwatch.js): доли от потолка памяти среды
  memwatch: {
    intervalMs: num(process.env.MEMWATCH_INTERVAL_MS, 10000),
    trimAt: num(process.env.MEMWATCH_TRIM_AT, 0.80),      // закрыть фоновые вкладки браузера
    restartAt: num(process.env.MEMWATCH_RESTART_AT, 0.92), // перезапустить браузер
    keepUnderPressure: 2,                                   // сколько недавних вкладок оставить при нехватке памяти
    maxTabs: num(process.env.MEMWATCH_MAX_TABS, 6),        // больше вкладок не держим и без нехватки
    cooldownMs: 30000
  },

  sandbox: {
    image: process.env.SANDBOX_IMAGE || 'aiportal-sandbox:latest',
    network: 'aiportal',
    runtime: process.env.SANDBOX_RUNTIME || 'runsc',
    dataDir: '/srv/aiportal',
    // Встроенный DNS Docker в gVisor не работает — средам подкладываем свой resolv.conf (его пишет deploy.sh)
    resolvConf: process.env.SANDBOX_RESOLV_CONF || require('path').join(__dirname, '..', 'data', 'resolv.conf'),
    volumeHelper: '/usr/local/sbin/aiportal-volume',
    diskGb: num(process.env.SANDBOX_DISK_GB, 5),
    // Память: первые bigSlots одновременно работающих сред получают memoryMb, следующие — memorySmallMb
    memoryMb: num(process.env.SANDBOX_MEMORY_MB, 2048),
    memorySmallMb: num(process.env.SANDBOX_MEMORY_SMALL_MB, 1536),
    bigSlots: num(process.env.SANDBOX_BIG_SLOTS, 2),
    swapMb: num(process.env.SANDBOX_SWAP_MB, 1536),
    cpus: num(process.env.SANDBOX_CPUS, 1.5),
    maxActive: num(process.env.MAX_ACTIVE, 3),
    idleMinutes: num(process.env.IDLE_MINUTES, 30),
    screen: process.env.SANDBOX_SCREEN || '1280x800'
  }
};
