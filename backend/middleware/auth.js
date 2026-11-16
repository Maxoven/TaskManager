const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: req.t('authRequired') });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Тем же секретом подписаны служебные токены MCP (OAuth, typ/aud) — к REST API они не подходят
    if (!Number.isInteger(decoded.userId) || decoded.typ !== undefined || decoded.aud !== undefined) {
      return res.status(401).json({ error: req.t('invalidToken') });
    }
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: req.t('invalidToken') });
  }
};

module.exports = authMiddleware;
