// Task Manager и почта в среде без отдельного входа.
// Среда обращается к http://172.30.0.1:3210/mcp/taskmanager со своим токеном; шлюз узнаёт по нему человека
// (он уже вошёл в портал аккаунтом Task Manager), выписывает короткий MCP-токен на его имя и передаёт запрос
// MCP-серверу Task Manager на этом же сервере. Права — ровно как у этого человека в Task Manager.
const fs = require('fs');
const jwt = require('jsonwebtoken');
const config = require('./config');

let cached = null;
function taskmanagerEnv() {
  if (cached) return cached;
  const env = {};
  for (const line of fs.readFileSync(config.taskmanagerEnvFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!env.JWT_SECRET) throw new Error('В .env Task Manager нет JWT_SECRET');
  const base = (env.MCP_PUBLIC_URL || env.FRONTEND_URL || '').replace(/\/+$/, '');
  cached = { secret: env.JWT_SECRET, audience: `${base}/api/mcp` };
  return cached;
}

function mcpToken(userId) {
  const { secret, audience } = taskmanagerEnv();
  return jwt.sign({ userId, typ: 'mcp', cid: 'aiportal', scope: 'taskmanager' }, secret, { expiresIn: 300, audience });
}

async function handleTaskmanagerMcp(req, res, userId, body) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
  }
  const headers = {
    'Content-Type': 'application/json',
    Accept: req.headers.accept || 'application/json, text/event-stream',
    Authorization: `Bearer ${mcpToken(userId)}`,
    'X-Lang': 'ru'
  };
  if (req.headers['mcp-protocol-version']) headers['MCP-Protocol-Version'] = req.headers['mcp-protocol-version'];
  const upstream = await fetch(`${config.taskmanagerApi}/mcp`, { method: 'POST', headers, body, signal: AbortSignal.timeout(300000) });
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

module.exports = { handleTaskmanagerMcp };
