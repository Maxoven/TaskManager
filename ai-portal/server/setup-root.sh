#!/usr/bin/env bash
# Портал ai.ecoestate.tv — однократная подготовка сервера. Запускать от root:
#   sudo bash setup-root.sh
# Скрипт можно запускать повторно: каждый шаг проверяет, сделан ли он уже.
#
# Что делает:
#   1. Docker + gVisor (runsc): среды пользователей работают в песочнице gVisor — у неё своё ядро,
#      поэтому скрипты пользователей не достают до ядра и процессов сервера.
#   2. Сеть aiportal для сред: среды не видят друг друга, сервер (базу, другие сайты) и локальные сети;
#      наружу в интернет — можно (кроме почтового порта 25). На сервер — только прокси моделей.
#   3. Папки пользователей: у каждого — свой диск-файл фиксированного размера (лимит места).
#   4. Подкачка 4 ГБ: памяти 3,8 ГБ, а среда с браузером занимает 1–1,5 ГБ.
#   5. Сайт ai.ecoestate.tv в nginx + сертификат Let's Encrypt.
#   6. Право для deploy запускать только помощника папок (aiportal-volume) от root.
set -euo pipefail

DOMAIN=ai.ecoestate.tv
GATEWAY_PORT=3200          # шлюз портала (Node, pm2), слушает 127.0.0.1
LLM_PORT=3210              # прокси моделей, слушает адрес сервера в сети aiportal
SUBNET=172.30.0.0/24
HOST_IP_IN_NET=172.30.0.1
BRIDGE=br-aiportal
APP_USER=deploy
DATA=/srv/aiportal
PUBLIC_IP=$(curl -s -4 -m 5 ifconfig.me || true)

[ "$(id -u)" = 0 ] || { echo "Запустите от root: sudo bash $0" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

log "1/6 Docker"
# Docker из официального репозитория (docker-ce). Если раньше пытались поставить docker.io из Ubuntu
# и он не доустановился (конфликт с docker-buildx-plugin) — сначала убираем его.
if dpkg -l docker.io 2>/dev/null | grep -q '^i'; then
  dpkg --remove --force-remove-reinstreq docker.io ubuntu-fan containerd runc 2>/dev/null || true
  apt-get -f install -y -q
fi
if ! docker version >/dev/null 2>&1; then
  if [ ! -f /etc/apt/sources.list.d/docker.list ]; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
  fi
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin
fi
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  # Docker Hub из России не отдаёт образы — берём через зеркало Google
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://mirror.gcr.io"],
  "log-driver": "local",
  "log-opts": { "max-size": "10m" }
}
JSON
fi
usermod -aG docker "$APP_USER"

log "   gVisor (runsc)"
if ! command -v runsc >/dev/null; then
  apt-get install -y -q gnupg curl
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update -q
  apt-get install -y -q runsc
fi
runsc install >/dev/null
systemctl enable docker >/dev/null
systemctl restart docker

log "2/6 Сеть aiportal и правила доступа"
docker network inspect aiportal >/dev/null 2>&1 || docker network create \
  --driver bridge --subnet "$SUBNET" --gateway "$HOST_IP_IN_NET" \
  -o com.docker.network.bridge.name="$BRIDGE" \
  -o com.docker.network.bridge.enable_icc=false \
  aiportal >/dev/null

cat > /usr/local/sbin/aiportal-firewall <<FW
#!/usr/bin/env bash
# Правила для сети сред портала (ставит aiportal-firewall.service после запуска Docker)
set -e
# На сам сервер из сред — только прокси моделей и ответы на соединения шлюза
iptables -N AIPORTAL_IN 2>/dev/null || iptables -F AIPORTAL_IN
iptables -A AIPORTAL_IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A AIPORTAL_IN -p tcp -d $HOST_IP_IN_NET --dport $LLM_PORT -j ACCEPT
iptables -A AIPORTAL_IN -j DROP
iptables -C INPUT -i $BRIDGE -j AIPORTAL_IN 2>/dev/null || iptables -I INPUT 1 -i $BRIDGE -j AIPORTAL_IN
# Наружу — в интернет, но не в локальные сети, не на сервер и не на почтовый порт
iptables -N AIPORTAL_FWD 2>/dev/null || iptables -F AIPORTAL_FWD
iptables -A AIPORTAL_FWD -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8 ${PUBLIC_IP:+$PUBLIC_IP/32}; do
  iptables -A AIPORTAL_FWD -d \$net -j DROP
done
iptables -A AIPORTAL_FWD -p tcp --dport 25 -j DROP
iptables -A AIPORTAL_FWD -j RETURN
iptables -C DOCKER-USER -i $BRIDGE -j AIPORTAL_FWD 2>/dev/null || iptables -I DOCKER-USER 1 -i $BRIDGE -j AIPORTAL_FWD
FW
chmod 755 /usr/local/sbin/aiportal-firewall

cat > /etc/systemd/system/aiportal-firewall.service <<'UNIT'
[Unit]
Description=AI portal: firewall rules for user sandboxes
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/aiportal-firewall
ExecStartPost=/usr/local/sbin/aiportal-volume mount-all

[Install]
WantedBy=multi-user.target docker.service
UNIT

log "3/6 Папки пользователей"
mkdir -p "$DATA/images" "$DATA/home"
chmod 711 "$DATA" "$DATA/home"
chmod 700 "$DATA/images"
cat > /usr/local/sbin/aiportal-volume <<'VOL'
#!/usr/bin/env bash
# Диск пользователя портала: файл-образ ext4 фиксированного размера, смонтированный в /srv/aiportal/home/u<ID>.
#   aiportal-volume ensure <userId> [размер_ГБ]   — создать (если нет) и смонтировать
#   aiportal-volume grow <userId> <размер_ГБ>      — увеличить
#   aiportal-volume mount-all                       — смонтировать все (при загрузке)
set -euo pipefail
BASE=/srv/aiportal
SANDBOX_UID=2000
cmd=${1:-}; id=${2:-}; size=${3:-5}
valid_id() { [[ "$id" =~ ^[0-9]{1,9}$ ]] || { echo "bad id" >&2; exit 2; }; }
valid_size() { [[ "$size" =~ ^[0-9]{1,3}$ ]] && [ "$size" -ge 1 ] || { echo "bad size" >&2; exit 2; }; }
mount_one() {
  local img=$1 mnt=$BASE/home/$(basename "$1" .img)
  mkdir -p "$mnt"
  mountpoint -q "$mnt" || mount -o loop,nodev,nosuid "$img" "$mnt"
  chown "$SANDBOX_UID:$SANDBOX_UID" "$mnt"
  chmod 700 "$mnt"
}
case "$cmd" in
  ensure)
    valid_id; valid_size
    img=$BASE/images/u$id.img
    if [ ! -f "$img" ]; then
      truncate -s "${size}G" "$img"
      mkfs.ext4 -q -F -m 0 "$img"
    fi
    mount_one "$img" ;;
  grow)
    valid_id; valid_size
    img=$BASE/images/u$id.img
    [ -f "$img" ] || { echo "no volume" >&2; exit 3; }
    truncate -s "${size}G" "$img"
    mountpoint -q "$BASE/home/u$id" || mount_one "$img"
    resize2fs "$(findmnt -n -o SOURCE "$BASE/home/u$id")" >/dev/null ;;
  mount-all)
    shopt -s nullglob
    for img in "$BASE"/images/u*.img; do mount_one "$img"; done ;;
  *) echo "usage: aiportal-volume ensure|grow <id> [GB] | mount-all" >&2; exit 2 ;;
esac
VOL
chmod 755 /usr/local/sbin/aiportal-volume
echo "$APP_USER ALL=(root) NOPASSWD: /usr/local/sbin/aiportal-volume" > /etc/sudoers.d/aiportal
chmod 440 /etc/sudoers.d/aiportal
visudo -cf /etc/sudoers.d/aiportal >/dev/null

systemctl daemon-reload
systemctl enable aiportal-firewall.service >/dev/null
systemctl restart aiportal-firewall.service

log "4/6 Подкачка 4 ГБ"
cur=$(swapon --show=SIZE --bytes --noheadings /swapfile 2>/dev/null || echo 0)
if [ "${cur:-0}" -lt $((4 * 1024 * 1024 * 1024)) ]; then
  swapoff /swapfile 2>/dev/null || true
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "5/6 nginx: $DOMAIN"
SITE=/etc/nginx/sites-available/aiportal
if [ ! -f "$SITE" ]; then
  cat > "$SITE" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:$GATEWAY_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade_aiportal;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

map \$http_upgrade \$connection_upgrade_aiportal {
    default upgrade;
    ''      close;
}
NGINX
  ln -sf "$SITE" /etc/nginx/sites-enabled/aiportal
fi
nginx -t
systemctl reload nginx
if ! grep -q "ssl_certificate" "$SITE"; then
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos || \
    echo "!!! Сертификат не получен — проверьте, что $DOMAIN указывает на этот сервер, и запустите: certbot --nginx -d $DOMAIN --redirect" >&2
fi

log "6/6 Проверка"
# Встроенный DNS Docker (127.0.0.11) в gVisor не работает — средам даём свой resolv.conf
grep '^nameserver' /run/systemd/resolve/resolv.conf > "$DATA/resolv.conf" 2>/dev/null || true
echo 'nameserver 77.88.8.8' >> "$DATA/resolv.conf"
chmod 644 "$DATA/resolv.conf"
docker run --rm --runtime=runsc --network aiportal -v "$DATA/resolv.conf:/etc/resolv.conf:ro" mirror.gcr.io/library/busybox:latest \
  sh -c 'wget -q -T 5 -O /dev/null http://example.com && echo "  интернет из песочницы: есть" || echo "  !!! интернета из песочницы нет";
         wget -q -T 3 -O /dev/null http://172.30.0.1:3001/api/ 2>/dev/null && echo "  !!! сервер виден из песочницы" || echo "  сервер из песочницы: закрыт"' || true
echo
echo "Готово. Дальше всё ставится от $APP_USER без root."
