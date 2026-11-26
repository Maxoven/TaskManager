#!/usr/bin/env bash
# Процессы среды: виртуальный экран, браузер, VNC → веб, OpenCode. Упавший процесс перезапускается.
set -u
export HOME=/home/user DISPLAY=:99
SCREEN=${AIPORTAL_SCREEN:-1440x900}
W=${SCREEN%x*}; H=${SCREEN#*x}

mkdir -p "$HOME/workspace" "$HOME/.config/opencode" "$HOME/.cache" "$HOME/.local/share"
mkdir -p "$HOME/.work"

# Выход в интернет — через шлюз портала: он сам решает, открыть сайт напрямую или через зарубежный сервер.
# К самому шлюзу (модели, Task Manager) и к локальным службам среды — без прокси.
PROXY=${AIPORTAL_PROXY-http://172.30.0.1:3210}
if [ -n "$PROXY" ]; then
  export HTTP_PROXY=$PROXY HTTPS_PROXY=$PROXY http_proxy=$PROXY https_proxy=$PROXY
  export NO_PROXY=localhost,127.0.0.1,172.30.0.1 no_proxy=localhost,127.0.0.1,172.30.0.1
fi

keep() { # keep <имя> <команда...>: перезапускать, если упала
  local name=$1; shift
  ( while true; do "$@" >>"/tmp/$name.log" 2>&1; echo "[$(date +%T)] $name exited ($?)" >>"/tmp/$name.log"; sleep 2; done ) &
}

rm -f /tmp/.X99-lock
keep xvfb Xvfb :99 -screen 0 "${W}x${H}x24" -nolisten tcp
for _ in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
keep openbox openbox
keep vnc x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet -noxdamage
keep novnc websockify --web /usr/share/novnc 6080 127.0.0.1:5900

# Браузер — общий для человека (смотрит на «Экране помощника») и агента (подключается по CDP на 9222).
# --no-sandbox: вся среда уже в песочнице gVisor, а своя песочница Chromium в ней не запускается.
# --test-type убирает плашку про --no-sandbox; остальное — чтобы после сна не спрашивал «Восстановить страницы?»
clean_exit() {
  local prefs="$HOME/.config/chromium-portal/Default/Preferences"
  [ -f "$prefs" ] && sed -i 's/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$prefs"
  rm -f "$HOME/.config/chromium-portal"/Singleton*
  return 0
}
run_chromium() {
  clean_exit
  exec chromium "$@"
}
export -f clean_exit run_chromium
keep chromium bash -c 'run_chromium "$@"' _ --no-sandbox --test-type --disable-dev-shm-usage --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble --hide-crash-restore-bubble --disable-infobars \
  --disable-features=Translate,MediaRouter --password-store=basic \
  --user-data-dir="$HOME/.config/chromium-portal" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  ${PROXY:+--proxy-server=$PROXY --proxy-bypass-list=172.30.0.1} \
  --window-position=0,0 --window-size="${W},${H}" --start-maximized --lang=ru about:blank

cd "$HOME/workspace"
exec opencode serve --hostname 0.0.0.0 --port 4096
