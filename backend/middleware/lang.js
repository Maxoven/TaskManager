const { translate, normalizeLang } = require('../i18n/messages');

// Определяет язык запроса (фронтенд шлёт X-Lang) и добавляет хелпер req.t(key)
const langMiddleware = (req, res, next) => {
  const header = req.headers['x-lang'] || (req.headers['accept-language'] || '').split(',')[0];
  req.lang = normalizeLang(header);
  req.t = (key) => translate(req.lang, key);
  next();
};

module.exports = langMiddleware;
