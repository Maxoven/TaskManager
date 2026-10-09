#!/bin/bash
# Выкладка Task Manager на сервер (хост "taskmanager" из ~/.ssh/config).
# Готовая сборка фронтенда (frontend/build) хранится в репозитории, поэтому достаточно:
#   git pull && ./deploy.sh
# Если меняли код фронтенда сами — сначала пересоберите: (cd frontend && npm run build)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f frontend/build/index.html ]; then
  echo "Нет frontend/build — соберите фронтенд: (cd frontend && npm run build)" >&2
  exit 1
fi
echo "Выкладываю $(git rev-parse --abbrev-ref HEAD 2>/dev/null) @ $(git log -1 --format='%h %s' 2>/dev/null)"

HOST=taskmanager
REMOTE=/var/www/taskmanager
STAMP=$(date +%Y%m%d-%H%M%S)

echo "1/6 Резервная копия на сервере: ~/taskmanager-backup-$STAMP.tgz"
ssh "$HOST" "cd $REMOTE && tar czf ~/taskmanager-backup-$STAMP.tgz --exclude=backend/node_modules --exclude=backend/storage backend frontend"

echo "2/6 Загрузка backend (без .env, node_modules и файлов задач)"
rsync -az --exclude node_modules --exclude .env --exclude storage --exclude uploads --exclude .DS_Store \
  backend/ "$HOST:$REMOTE/backend/"

# Ключ ИИ-ассистента: переносим из локального deepseek.txt в .env на сервере, если его там ещё нет
if [ -f deepseek.txt ] && ! ssh "$HOST" "grep -q '^DEEPSEEK_API_KEY=.' $REMOTE/backend/.env"; then
  echo "    Добавляю DEEPSEEK_API_KEY в .env на сервере"
  tr -d ' \n\r' < deepseek.txt | ssh "$HOST" "printf '\nDEEPSEEK_API_KEY=%s\n' \"\$(cat)\" >> $REMOTE/backend/.env"
fi

echo "3/6 Установка зависимостей и обновление схемы БД"
ssh "$HOST" "cd $REMOTE/backend && npm ci --omit=dev && npm run db:init"

echo "4/6 Перезапуск API"
ssh "$HOST" "pm2 restart taskmanager-api && sleep 3"

echo "5/6 Загрузка frontend"
rsync -az --delete --exclude .DS_Store frontend/build/ "$HOST:$REMOTE/frontend/"

echo "6/6 Проверка"
ssh "$HOST" "pm2 logs taskmanager-api --lines 6 --nostream --out"
curl -fsS https://taskmanager.ecoestate.tv/api && echo
echo "Готово. Откат: ssh $HOST 'cd $REMOTE && tar xzf ~/taskmanager-backup-$STAMP.tgz && cd backend && npm ci --omit=dev && pm2 restart taskmanager-api'"
