const { translate, normalizeLang } = require('../i18n/messages');

// Определяет язык запроса (фронтенд шлёт X-Lang) и добавляет хелпер req.t(key, vars)
const langMiddleware = (req, res, next) => {
  const header = req.headers['x-lang'] || (req.headers['accept-language'] || '').split(',')[0];
  req.lang = normalizeLang(header);
  req.t = (key, vars) => {
    const text = translate(req.lang, key);
    if (!vars || typeof text !== 'string') return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? vars[name] : m));
  };
  next();
};

module.exports = langMiddleware;
