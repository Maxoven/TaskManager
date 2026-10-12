# Task Manager — backend

Node.js (Express) + PostgreSQL. Отдаёт API на `/api`, шлёт письма через SMTP и по расписанию напоминает о дедлайнах.

## Установка

```bash
cd backend
npm install
cp .env.example .env   # заполнить DB_*, JWT_SECRET, SMTP_*, FRONTEND_URL
npm run db:init        # создаёт/обновляет таблицы (скрипт идемпотентный)
npm start
```

В консоли должно появиться `🚀 Сервер запущен на порту 3001`. Проверка: `GET /api` → `{"message":"Task Manager API работает!"}`.

Без `JWT_SECRET` сервер не стартует — задайте длинную случайную строку (32+ символа).

После обновления кода достаточно повторить `npm install` и `npm run db:init` — существующие данные скрипт не трогает.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` или `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` | Подключение к PostgreSQL |
| `JWT_SECRET` | Секрет подписи токенов (обязателен) |
| `PORT` | Порт API, по умолчанию 3001 |
| `FRONTEND_URL` | Адрес сайта — подставляется в ссылки из писем |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Почта |
| `UPLOADS_DIR` | Папка файлов задач, по умолчанию `backend/storage/uploads` |
| `AVATARS_DIR` | Папка фото профиля, по умолчанию `backend/storage/avatars` |
| `DEEPSEEK_API_KEY` | Ключ DeepSeek для ИИ-ассистента. Без него ассистент не показывается |
| `DEEPSEEK_MODEL` | Необязательно: конкретная модель. По умолчанию выбирается быстрая «flash» из доступных ключу |

## Структура

```
backend/
├── server.js             # точка входа
├── config/database.js    # пул PostgreSQL, withTransaction
├── middleware/           # auth (JWT), lang (язык ответа), rateLimit
├── routes/               # auth, avatars, projects, tasks, reports (magic link), teams, assistant (ИИ)
├── services/             # access (права), email, scheduler (напоминания), ai (DeepSeek), fileReader (чтение файлов для ИИ)
├── i18n/messages.js      # тексты ответов API (ru/en)
├── scripts/              # init-db, migrate-from-mysql
└── database-init.sql     # схема
```

## Команды и роли

Пользователь может состоять в нескольких командах и переключаться между ними. Проект принадлежит команде (`projects.team_id`), доступ даёт членство в ней (`team_memberships`):

| Роль | Что может |
|---|---|
| `owner` | создатель команды: всё, что admin, плюс удаление команды |
| `admin` | создаёт, меняет и удаляет проекты команды, приглашает людей, меняет роли |
| `member` | видит все проекты команды, создаёт и меняет задачи |

Отдельно можно пригласить человека только в один проект (`project_members`) — это гость с правами участника в этом проекте. Все проверки прав — в `services/access.js`.

При первом `npm run db:init` после обновления старая модель «одна команда на владельца» (`team_members`) переносится автоматически: у каждого владельца проектов появляется своя команда, прежние участники становятся `member`, старая таблица переименовывается в `team_members_legacy`.

## Развёртывание

- API работает за nginx: `/api` проксируется на `PORT`. Nginx должен передавать `X-Forwarded-For` — по нему считается лимит попыток входа.
- Файлы задач лежат вне раздаваемой nginx папки и скачиваются только через API с проверкой доступа. Папки `UPLOADS_DIR` и `AVATARS_DIR` нужно включить в резервные копии.
- Напоминания рассылаются в 9:00, 10:00 и 11:00 по времени сервера — процесс должен работать постоянно (pm2, systemd или менеджер Node.js-приложений хостинга).
- Перенос данных из старой MySQL-базы: `npm run db:migrate-mysql` (см. комментарии в `scripts/migrate-from-mysql.js`).
