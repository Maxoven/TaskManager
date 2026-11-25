# AI-портал «Помощник» — ai.ecoestate.tv

Простой чат с ИИ-помощником для сотрудников без технической подготовки. Вход — аккаунтом Task Manager.
У каждого человека своя изолированная среда: помощник (OpenCode), облачный браузер, папка с файлами.

## Что видит человек

Один экран в стиле Task Manager: слева разговоры, в центре переписка и поле «Напишите задачу обычными словами…»,
справа сворачиваемая панель «Экран помощника» (живой экран облачного браузера, можно кликать и печатать самому)
и «Файлы» (загрузить / скачать). Никаких моделей, режимов, терминала и настроек. Интерфейс OpenCode наружу не отдаётся.

## Как устроено

```
браузер ── nginx (ai.ecoestate.tv) ── gateway (Node, pm2 «aiportal», 127.0.0.1:3200)
                                          │  вход: POST /api/auth/login Task Manager
                                          │  /api/oc/* — узкий список запросов к OpenCode среды
                                          │  /screen/*  — noVNC среды
                                          ▼
                    среда человека: контейнер aiportal-u<ID> (Docker + gVisor, сеть aiportal)
                      opencode serve :4096 · Chromium на Xvfb · x11vnc → websockify :6080 · Playwright MCP
                      /home/user — диск-файл человека (/srv/aiportal/images/u<ID>.img, лимит места)
                                          │
                    прокси моделей и MCP (gateway, 172.30.0.1:3210 — виден только средам)
                      /zai/v1, /deepseek/v1   — подставляет настоящие ключи, пускает только glm-5.3 и deepseek-flash,
                                                пишет расход по людям в gateway/data/usage.jsonl
                      /mcp/taskmanager        — MCP Task Manager и почты от имени вошедшего человека
```

- **Модели.** Главный помощник — GLM-5.3, все подручные (субагенты `general`, `explore`, `browser`, `verifier`) — DeepSeek Flash.
  Ключи лежат только в `gateway/.env` на сервере; в среде — лишь её собственный токен.
- **Изоляция.** gVisor (свой ядро-посредник), сеть без доступа к серверу, другим средам и локальным сетям; наружу — интернет
  (кроме порта 25). CPU, память, число процессов и место на диске ограничены.
- **Сон.** Среда поднимается при входе (3–5 секунд) и засыпает после `IDLE_MINUTES` без запросов; файлы, разговоры
  и входы на сайтах в облачном браузере сохраняются на диске человека.
- **Инструкция помощнику** — `sandbox/opencode-config/ultra-code.md`: простой язык без терминов, всё делать самому,
  перед необратимым спрашивать «да», большие задачи дробить и раздавать подручным параллельно, проверять результат.

## Папки

| Папка | Что там |
|---|---|
| `server/setup-root.sh` | Однократная подготовка сервера от root: Docker, gVisor, сеть и правила, диски людей, nginx, сертификат |
| `sandbox/` | Образ среды: Dockerfile, запуск процессов, настройки OpenCode (`/etc/opencode`) |
| `gateway/` | Шлюз: вход, запуск сред, прокси к OpenCode, прокси моделей, мост к MCP Task Manager, страницы портала |
| `deploy.sh` | Выкладка (root не нужен): код, `.env`, образ среды, перезапуск pm2 |

## Настройки (`gateway/.env` на сервере)

`SESSION_SECRET`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY` создаёт `deploy.sh` (ключи берёт из `deepseek.txt` и `glm.txt` в корне репозитория).
Необязательные: `MAX_ACTIVE` (сколько сред одновременно, по умолчанию 2), `IDLE_MINUTES` (30), `SANDBOX_MEMORY_MB` (1536),
`SANDBOX_CPUS` (1.5), `SANDBOX_DISK_GB` (5, для новых людей), `MAX_UPLOAD_MB` (100).

## Полезное

```bash
./deploy.sh                      # выложить всё; SKIP_IMAGE=1 — только шлюз и страницы
OPENCODE_VERSION=2.4.1 ./deploy.sh   # другая версия OpenCode (скачивается с GitHub, сверяется SHA256)
ssh taskmanager 'pm2 logs aiportal --lines 50'
ssh taskmanager 'docker ps --filter label=aiportal.user'          # кто сейчас работает
ssh taskmanager 'tail -5 ~/aiportal/gateway/data/usage.jsonl'     # расход моделей
ssh taskmanager 'sudo /usr/local/sbin/aiportal-volume grow 7 20'  # дать человеку №7 20 ГБ
```
