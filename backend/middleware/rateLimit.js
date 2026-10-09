// Простой лимит запросов в памяти процесса (без внешних зависимостей):
// защищает вход и отправку писем от перебора и рассылки спама.
function rateLimit({ windowMs, max, keyFn = (req) => req.ip }) {
  const hits = new Map(); // ключ → { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: req.t('tooManyRequests') });
    }
    next();
  };
}

module.exports = rateLimit;
