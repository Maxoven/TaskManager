# Среда пользователя портала: OpenCode + облачный браузер (Chromium на виртуальном экране, виден через noVNC)
# + инструменты для скриптов. Запускается шлюзом в песочнице gVisor (runtime runsc), по контейнеру на человека.
# Файл opencode (бинарник OpenCode 2.x) кладёт рядом deploy.sh, предварительно сверив SHA256.
FROM mirror.gcr.io/library/node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    TZ=Europe/Moscow \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update -q && apt-get install -y -q --no-install-recommends \
      ca-certificates curl wget git openssh-client jq unzip zip xz-utils ripgrep fd-find less nano procps tini \
      python3 python3-pip python3-venv sqlite3 build-essential \
      chromium xvfb x11vnc novnc websockify openbox \
      fonts-dejavu-core fonts-liberation2 fonts-noto-core fonts-noto-color-emoji \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# Библиотеки для документов: помощник читает и готовит Word, Excel, PDF, PowerPoint
RUN pip3 install --no-cache-dir --break-system-packages python-docx openpyxl pypdf python-pptx reportlab

# MCP для управления облачным браузером (подключается к уже открытому Chromium по CDP)
RUN npm install -g @playwright/mcp@0.0.86 && npm cache clean --force

COPY opencode /usr/local/bin/opencode
COPY opencode-config/ /etc/opencode/
COPY entrypoint.sh /usr/local/bin/aiportal-entrypoint
COPY openbox-rc.xml /etc/xdg/openbox/rc.xml
RUN chmod 755 /usr/local/bin/opencode /usr/local/bin/aiportal-entrypoint \
    && groupadd -g 2000 user && useradd -u 2000 -g 2000 -d /home/user -s /bin/bash user \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

USER user
WORKDIR /home/user
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aiportal-entrypoint"]
