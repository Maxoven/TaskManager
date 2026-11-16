# Прокси MCP через Cloudflare Worker

Claude подключается к адресу Worker'а, Worker пересылает запросы на сервер Task Manager.
Метаданные OAuth (`/.well-known/oauth-*`) Worker берёт с `/api/mcp/discovery/...`, поэтому
правка nginx на сервере не нужна.

## Выкладка

```bash
cd cloudflare-worker
wrangler login        # один раз: вход в аккаунт Cloudflare в браузере
wrangler deploy       # печатает адрес вида https://taskmanager-mcp.<поддомен>.workers.dev
```

Затем на сервере в `backend/.env`:

```
MCP_PUBLIC_URL=https://taskmanager-mcp.<поддомен>.workers.dev
```

и перезапуск API: `pm2 restart taskmanager-api --update-env`.

Адрес коннектора в Claude: `https://taskmanager-mcp.<поддомен>.workers.dev/api/mcp`.

Проверка:

```bash
curl https://taskmanager-mcp.<поддомен>.workers.dev/.well-known/oauth-authorization-server   # JSON
curl -i -X POST https://taskmanager-mcp.<поддомен>.workers.dev/api/mcp                       # 401 + WWW-Authenticate
```
