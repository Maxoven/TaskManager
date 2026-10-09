// ИИ-ассистент: запросы к DeepSeek (API совместим с OpenAI Chat Completions).
// Ключ — в DEEPSEEK_API_KEY. Без ключа ассистент выключен, остальное приложение работает как раньше.
const API_URL = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';

// Модель выбирается сама из списка доступных ключу: сначала ищем быструю «flash»,
// затем прежнее название быстрой модели, затем любую. Когда DeepSeek выпустит
// новую версию, она подхватится без правки кода. Жёстко задать модель можно в DEEPSEEK_MODEL.
const MODEL_PREFERENCE = [/^deepseek-flash$/, /flash/, /^deepseek-chat$/, /chat/];
const FALLBACK_MODEL = 'deepseek-flash';
const MODEL_CACHE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;

let cachedModel = null;
let cachedAt = 0;
let cachedVision = true; // умеет ли выбранная модель смотреть картинки

const isEnabled = () => !!API_KEY;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error?.message || `DeepSeek HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function pickModel(ids) {
  for (const pattern of MODEL_PREFERENCE) {
    const found = ids.find(id => pattern.test(id));
    if (found) return found;
  }
  return ids[0] || FALLBACK_MODEL;
}

async function resolveModel() {
  if (process.env.DEEPSEEK_MODEL) return process.env.DEEPSEEK_MODEL;
  if (cachedModel && Date.now() - cachedAt < MODEL_CACHE_MS) return cachedModel;
  try {
    const list = await request('/models');
    const models = list?.data || [];
    cachedModel = pickModel(models.map(m => m.id));
    const modalities = models.find(m => m.id === cachedModel)?.input_modalities;
    cachedVision = !Array.isArray(modalities) || modalities.includes('image');
    cachedAt = Date.now();
    console.log(`[AI] Модель ассистента: ${cachedModel}`);
  } catch (e) {
    console.error('[AI] Не удалось получить список моделей:', e.message);
    if (!cachedModel) return FALLBACK_MODEL; // не кэшируем — попробуем ещё раз при следующем запросе
  }
  return cachedModel;
}

// Один шаг диалога. messages — в формате Chat Completions; tools — описания функций, которые
// модель может вызвать. Возвращает сообщение модели целиком (в нём может быть tool_calls).
async function complete(messages, tools) {
  const send = async () => request('/chat/completions', {
    method: 'POST',
    // Запас по токенам: «размышления» модели тоже входят в лимит ответа
    body: JSON.stringify({
      model: await resolveModel(), messages, max_tokens: 6000,
      ...(tools && tools.length ? { tools } : {})
    })
  });
  let data;
  try {
    data = await send();
  } catch (e) {
    // Модель сняли с поддержки или переименовали — выбираем заново и повторяем один раз
    if (process.env.DEEPSEEK_MODEL || ![400, 404].includes(e.status)) throw e;
    cachedModel = null;
    data = await send();
  }
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error('DeepSeek вернул пустой ответ');
  return message;
}

const supportsImages = async () => { await resolveModel(); return cachedVision; };

module.exports = { isEnabled, complete, supportsImages, pickModel };
