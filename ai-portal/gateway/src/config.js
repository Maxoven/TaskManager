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
      zai: { base: 'https://api.z.ai/api/paas/v4', key: process.env.ZAI_API_KEY, models: ['glm-5.3'] }
    },
    usageLog: process.env.USAGE_LOG || require('path').join(__dirname, '..', 'data', 'usage.jsonl')
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
    memoryMb: num(process.env.SANDBOX_MEMORY_MB, 1536),
    swapMb: num(process.env.SANDBOX_SWAP_MB, 1536),
    cpus: num(process.env.SANDBOX_CPUS, 1.5),
    maxActive: num(process.env.MAX_ACTIVE, 2),
    idleMinutes: num(process.env.IDLE_MINUTES, 30),
    screen: process.env.SANDBOX_SCREEN || '1280x800'
  }
};
