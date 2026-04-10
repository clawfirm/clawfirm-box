#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BOX_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

PUBLIC_IP="${CLAWFIRM_BOX_PUBLIC_IP:-}"
DOMAIN="${CLAWFIRM_BOX_DOMAIN:-}"
BOX_HOSTNAME="${CLAWFIRM_BOX_HOSTNAME:-}"
BOX_TOKEN="${CLAWFIRM_BOX_TOKEN:-}"
INSTALL_BIND="${CLAWFIRM_BOX_INSTALL_BIND:-0}"
CONFIGURE_CADDY="${CLAWFIRM_BOX_CONFIGURE_CADDY:-1}"
CADDY_SNIPPETS_DIR="${CLAWFIRM_BOX_CADDY_SNIPPETS_DIR:-/etc/caddy/sites-enabled}"
CADDY_SNIPPET_GLOB="${CLAWFIRM_BOX_CADDY_SNIPPET_GLOB:-$CADDY_SNIPPETS_DIR/*.caddy}"
CADDY_SNIPPET_PATH="${CLAWFIRM_BOX_CADDY_SNIPPET_PATH:-$CADDY_SNIPPETS_DIR/clawfirm-box.caddy}"
SYSTEMD_UNIT_PATH="${CLAWFIRM_BOX_SYSTEMD_UNIT_PATH:-/etc/systemd/system/clawfirm-boxd.service}"

if [[ -z "$PUBLIC_IP" ]]; then
  echo "Missing CLAWFIRM_BOX_PUBLIC_IP" >&2
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  echo "Missing CLAWFIRM_BOX_DOMAIN" >&2
  exit 1
fi

if [[ -z "$BOX_HOSTNAME" ]]; then
  BOX_HOSTNAME="box.$DOMAIN"
fi

if [[ -z "$BOX_TOKEN" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    BOX_TOKEN="$(openssl rand -hex 32)"
  else
    echo "Missing CLAWFIRM_BOX_TOKEN and openssl is unavailable for generation" >&2
    exit 1
  fi
fi

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_caddy_base_config() {
  local caddyfile="/etc/caddy/Caddyfile"
  local import_line="import $CADDY_SNIPPET_GLOB"

  $SUDO mkdir -p "$CADDY_SNIPPETS_DIR"
  if [[ -f "$caddyfile" ]]; then
    $SUDO cp "$caddyfile" "$caddyfile.bak.$(date +%s)"
  fi

  cat <<EOF | $SUDO tee "$caddyfile" >/dev/null
$import_line
EOF
}

wait_for_local_health() {
  local url="http://127.0.0.1:8787/health"
  local attempts="${1:-30}"
  local delay_seconds="${2:-1}"
  local i

  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null; then
      return 0
    fi
    sleep "$delay_seconds"
  done

  echo "Timed out waiting for local health at $url" >&2
  return 1
}

seed_authoritative_zone() {
  local auth_header="Authorization: Bearer $BOX_TOKEN"

  curl -fsS -X POST http://127.0.0.1:8787/dns/apply-records \
    -H "$auth_header" \
    -H 'Content-Type: application/json' \
    -d @- <<EOF >/dev/null
{"zone":"$DOMAIN","requestedBy":"bootstrap-fresh-box","reason":"initial authoritative zone seed","records":[{"type":"A","name":"@","value":"$PUBLIC_IP","ttl":300},{"type":"CNAME","name":"www","value":"$DOMAIN","ttl":300},{"type":"A","name":"box","value":"$PUBLIC_IP","ttl":300},{"type":"A","name":"ns1","value":"$PUBLIC_IP","ttl":300},{"type":"A","name":"ns2","value":"$PUBLIC_IP","ttl":300}]}
EOF
}

printf '==> Installing base packages\n'
$SUDO apt update
$SUDO apt install -y curl git ca-certificates nodejs npm caddy

if [[ "$INSTALL_BIND" == "1" ]]; then
  printf '==> Installing bind9 packages\n'
  $SUDO apt install -y bind9 bind9-utils
fi

printf '==> Installing npm dependencies\n'
cd "$BOX_DIR"
npm install

printf '==> Rendering runtime env\n'
CLAWFIRM_BOX_PUBLIC_IP="$PUBLIC_IP" \
CLAWFIRM_BOX_DOMAIN="$DOMAIN" \
CLAWFIRM_BOX_HOSTNAME="$BOX_HOSTNAME" \
CLAWFIRM_BOX_TOKEN="$BOX_TOKEN" \
"$SCRIPT_DIR/render-box-env.sh"

printf '==> Installing runtime env to %s/.env\n' "$BOX_DIR"
cp "$BOX_DIR/.generated/.env" "$BOX_DIR/.env"

if [[ "$INSTALL_BIND" == "1" ]]; then
  printf '==> Installing local bind backend helpers\n'
  $SUDO "$SCRIPT_DIR/install-bind-backend.sh"
fi

printf '==> Installing systemd unit\n'
$SUDO install -m 0644 "$BOX_DIR/systemd/clawfirm-boxd.service" "$SYSTEMD_UNIT_PATH"
$SUDO systemctl daemon-reload
$SUDO systemctl enable clawfirm-boxd
$SUDO systemctl restart clawfirm-boxd

if [[ "$CONFIGURE_CADDY" == "1" ]]; then
  printf '==> Configuring Caddy for %s\n' "$BOX_HOSTNAME"
  install_caddy_base_config
  cat <<EOF | $SUDO tee "$CADDY_SNIPPET_PATH" >/dev/null
$BOX_HOSTNAME {
  reverse_proxy 127.0.0.1:8787
}
EOF
  $SUDO caddy validate --config /etc/caddy/Caddyfile
  $SUDO systemctl reload caddy
fi

printf '==> Waiting for local health\n'
wait_for_local_health 45 1

if [[ "$INSTALL_BIND" == "1" ]]; then
  printf '==> Seeding initial authoritative DNS zone for %s\n' "$DOMAIN"
  seed_authoritative_zone
fi

printf '\nFresh box bootstrap complete.\n'
printf '  box_hostname=%s\n' "$BOX_HOSTNAME"
printf '  box_token=%s\n' "$BOX_TOKEN"
printf '  local_health=http://127.0.0.1:8787/health\n'
printf '  public_health=https://%s/health\n' "$BOX_HOSTNAME"
printf '\nNext steps:\n'
printf '  1. Ensure DNS for %s points at %s\n' "$BOX_HOSTNAME" "$PUBLIC_IP"
printf '  2. Verify public health: curl https://%s/health\n' "$BOX_HOSTNAME"
printf '  3. Use REST or clawfirm-cli for routine operations\n'
printf '  4. Save the box token somewhere secure\n'
