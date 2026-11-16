// Прокси MCP-сервера Task Manager через Cloudflare.
// Claude обращается к адресу Worker'а (https://<имя>.<поддомен>.workers.dev/api/mcp), Worker пересылает
// запросы на наш сервер. Зачем:
//   1) метаданные OAuth клиенты ищут в корне сайта (/.well-known/oauth-*), а nginx на сервере отдаёт там
//      фронтенд — Worker берёт их с /api/mcp/discovery/.well-known/*, куда nginx пропускает;
//   2) ИИ-клиенты ходят к Cloudflare, а не напрямую к серверу в России.
// На сервере в backend/.env должно быть MCP_PUBLIC_URL=<адрес этого Worker'а> — от него строятся
// адреса входа и проверяется, для какого ресурса выдан токен.

// Пропускаем только то, что нужно MCP: остальной сайт через Worker не открывается
const ALLOWED = [/^\/api\/mcp(\/|$)/, /^\/\.well-known\/oauth-(authorization-server|protected-resource)(\/|$)/];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!ALLOWED.some(re => re.test(url.pathname))) {
      return new Response('Not found', { status: 404 });
    }

    const origin = env.ORIGIN.replace(/\/+$/, '');
    const path = url.pathname.startsWith('/.well-known/')
      ? `/api/mcp/discovery${url.pathname}`
      : url.pathname;
    const target = `${origin}${path}${url.search}`;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // Редирект после входа (на claude.ai с кодом) отдаём клиенту как есть
      redirect: 'manual'
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers
    });
  }
};
