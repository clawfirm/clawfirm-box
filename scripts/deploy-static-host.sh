#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-137.184.33.34}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/clawfirm-box}"
REMOTE_SERVICE_NAME="${REMOTE_SERVICE_NAME:-clawfirm-boxd}"
REMOTE_CADDY_SNIPPET="${REMOTE_CADDY_SNIPPET:-}"
ADAPTER_HOSTNAME="${ADAPTER_HOSTNAME:-box.example.com}"
MANAGE_ADAPTER_CADDY_SNIPPET="${MANAGE_ADAPTER_CADDY_SNIPPET:-0}"
SSH_IDENTITY_FILE="${SSH_IDENTITY_FILE:-$HOME/.ssh/id_ed25519}"
DEFAULT_SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=accept-new"
if [[ -z "${SSH_OPTS:-}" ]]; then
  SSH_OPTS="$DEFAULT_SSH_OPTS"
  if [[ -f "$SSH_IDENTITY_FILE" ]]; then
    SSH_OPTS+=" -i $SSH_IDENTITY_FILE"
  fi
fi
if [[ -z "${REMOTE_SUDO+x}" ]]; then
  if [[ "$REMOTE_USER" == "root" ]]; then
    REMOTE_SUDO=""
  else
    REMOTE_SUDO="sudo"
  fi
fi
SSH_CMD=(ssh)
# shellcheck disable=SC2206
SSH_EXTRA_OPTS=($SSH_OPTS)
SSH_CMD+=("${SSH_EXTRA_OPTS[@]}")

if [[ ! -f "$ROOT_DIR/.env.example" ]]; then
  echo "missing $ROOT_DIR/.env.example" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
STAGE_DIR="$TMP_DIR/clawfirm-box"
mkdir -p "$STAGE_DIR"

rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude '.DS_Store' \
  "$ROOT_DIR/" "$STAGE_DIR/"

cat > "$TMP_DIR/${REMOTE_SERVICE_NAME}.service" <<UNIT
[Unit]
Description=Clawfirm box daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_APP_DIR}
EnvironmentFile=${REMOTE_APP_DIR}/.env
ExecStart=/usr/bin/node ${REMOTE_APP_DIR}/src/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
UNIT

if [[ "$MANAGE_ADAPTER_CADDY_SNIPPET" == "1" ]]; then
cat > "$TMP_DIR/adapter.caddy" <<CADDY
${ADAPTER_HOSTNAME} {
  reverse_proxy 127.0.0.1:8787
}
CADDY
fi

rsync -az -e "${SSH_CMD[*]}" "$STAGE_DIR/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_APP_DIR}/"
rsync -az -e "${SSH_CMD[*]}" "$TMP_DIR/${REMOTE_SERVICE_NAME}.service" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/${REMOTE_SERVICE_NAME}.service"
if [[ "$MANAGE_ADAPTER_CADDY_SNIPPET" == "1" ]]; then
  rsync -az -e "${SSH_CMD[*]}" "$TMP_DIR/adapter.caddy" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/adapter.caddy"
fi

"${SSH_CMD[@]}" "${REMOTE_USER}@${REMOTE_HOST}" bash <<EOF
set -euo pipefail
${REMOTE_SUDO} mkdir -p ${REMOTE_APP_DIR}
if [[ ! -f ${REMOTE_APP_DIR}/.env ]]; then
  ${REMOTE_SUDO} cp ${REMOTE_APP_DIR}/.env.example ${REMOTE_APP_DIR}/.env
fi
${REMOTE_SUDO} mv /tmp/${REMOTE_SERVICE_NAME}.service /etc/systemd/system/${REMOTE_SERVICE_NAME}.service
if [[ "${MANAGE_ADAPTER_CADDY_SNIPPET}" == "1" && -n "${REMOTE_CADDY_SNIPPET}" ]]; then
  ${REMOTE_SUDO} mkdir -p "$(dirname "${REMOTE_CADDY_SNIPPET}")"
  ${REMOTE_SUDO} mv /tmp/adapter.caddy ${REMOTE_CADDY_SNIPPET}
elif [[ -n "${REMOTE_CADDY_SNIPPET}" ]]; then
  ${REMOTE_SUDO} rm -f ${REMOTE_CADDY_SNIPPET}
fi
${REMOTE_SUDO} systemctl daemon-reload
${REMOTE_SUDO} systemctl enable ${REMOTE_SERVICE_NAME}
${REMOTE_SUDO} systemctl restart ${REMOTE_SERVICE_NAME}
if command -v caddy >/dev/null 2>&1; then
  if ! ${REMOTE_SUDO} caddy validate --config /etc/caddy/Caddyfile; then
    echo "Refusing to reload/restart caddy because config validation failed." >&2
    ${REMOTE_SUDO} systemctl status caddy --no-pager || true
    exit 1
  fi
  if ${REMOTE_SUDO} systemctl is-active --quiet caddy; then
    ${REMOTE_SUDO} systemctl reload caddy
  else
    ${REMOTE_SUDO} systemctl start caddy
  fi
fi
${REMOTE_SUDO} systemctl status ${REMOTE_SERVICE_NAME} --no-pager
EOF

echo "Deployed clawfirm-box files and service unit to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_APP_DIR}"
echo "Remember to edit ${REMOTE_APP_DIR}/.env on the remote host with real secrets and DNS settings."
