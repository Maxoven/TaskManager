#!/usr/bin/env bash
# Выкладка AI-портала (ai.ecoestate.tv) на сервер "taskmanager". Root не нужен:
# сервер один раз готовится скриптом server/setup-root.sh.
#   ./deploy.sh            — код шлюза + образ среды (если менялся)
#   SKIP_IMAGE=1 ./deploy.sh — только шлюз
set -euo pipefail
cd "$(dirname "$0")"

HOST=taskmanager
REMOTE='~/aiportal'
OPENCODE_VERSION=${OPENCODE_VERSION:-2.4.1}
KEYS_DIR=..   # deepseek.txt и glm.txt лежат в корне репозитория (в git не попадают)

echo "1/5 Загрузка кода"
rsync -az --delete --exclude node_modules --exclude .env --exclude data gateway/ "$HOST:$REMOTE/gateway/"
rsync -az --delete --exclude opencode sandbox/ "$HOST:$REMOTE/sandbox/"

echo "2/5 Настройки (.env)"
ssh "$HOST" "mkdir -p $REMOTE/gateway/data && cd $REMOTE/gateway && touch .env && chmod 600 .env && \
  (grep -q '^SESSION_SECRET=.' .env || printf 'SESSION_SECRET=%s\n' \"\$(openssl rand -base64 48 | tr -d '\n')\" >> .env) && \
  (grep '^nameserver' /run/systemd/resolve/resolv.conf; echo 'nameserver 77.88.8.8') > data/resolv.conf"
put_key() { # put_key <ИМЯ_В_ENV> <файл>: ключ уходит по stdin, в аргументах и логах его нет
  [ -f "$2" ] || { echo "    нет файла $2 — $1 не меняю"; return; }
  tr -d ' \n\r' < "$2" | ssh "$HOST" "cd $REMOTE/gateway && key=\$(cat) && \
    { grep -v '^$1=' .env || true; } > .env.new && printf '$1=%s\n' \"\$key\" >> .env.new && mv .env.new .env && chmod 600 .env"
}
put_key DEEPSEEK_API_KEY "$KEYS_DIR/deepseek.txt"
put_key ZAI_API_KEY "$KEYS_DIR/glm.txt"

if [ -z "${SKIP_IMAGE:-}" ]; then
  echo "3/5 Образ среды (OpenCode $OPENCODE_VERSION)"
  ssh "$HOST" "set -e; mkdir -p $REMOTE/dl && cd $REMOTE/dl && \
    if [ ! -f opencode-$OPENCODE_VERSION ]; then \
      base=https://github.com/anomalyco/opencode/releases/download/v$OPENCODE_VERSION; \
      curl -fsSL -o oc.tgz \$base/opencode-linux-x64.tar.gz && curl -fsSL -o SHA256SUMS \$base/SHA256SUMS && \
      grep ' opencode-linux-x64.tar.gz\$' SHA256SUMS | awk '{print \$1\"  oc.tgz\"}' | sha256sum -c - && \
      tar xzf oc.tgz && mv opencode opencode-$OPENCODE_VERSION && rm -f oc.tgz; \
    fi && cp opencode-$OPENCODE_VERSION $REMOTE/sandbox/opencode && \
    cd $REMOTE/sandbox && docker build -q -t aiportal-sandbox:latest . && rm -f opencode && docker image prune -f >/dev/null"
else
  echo "3/5 Образ среды — пропущен"
fi

echo "4/5 Зависимости и перезапуск шлюза"
ssh "$HOST" "cd $REMOTE/gateway && npm ci --omit=dev --silent && \
  (pm2 describe aiportal >/dev/null 2>&1 && pm2 restart aiportal --update-env >/dev/null || pm2 start src/index.js --name aiportal --time >/dev/null) && \
  pm2 save >/dev/null && sleep 3 && pm2 logs aiportal --lines 8 --nostream --out 2>/dev/null | tail -8"

echo "5/5 Проверка"
code=$(curl -s -o /dev/null -w '%{http_code}' https://ai.ecoestate.tv/login)
[ "$code" = 200 ] && echo "    https://ai.ecoestate.tv отвечает" || { echo "    ВНИМАНИЕ: страница входа вернула $code — смотрите: ssh $HOST 'pm2 logs aiportal --lines 50'" >&2; exit 1; }
echo "Готово. Работающие среды обновятся на новый образ после выключения и запуска."
