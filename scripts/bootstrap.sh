#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BOX_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${CLAWFIRM_BOX_OUT_DIR:-$BOX_DIR/.generated}"
ENV_OUT="$OUT_DIR/.env"
SYSTEMD_OUT_DIR="$OUT_DIR/systemd"
SYSTEMD_TEMPLATE="$BOX_DIR/systemd/clawfirm-adapter.service"
RUNTIME_DIR="${CLAWFIRM_BOX_RUNTIME_DIR:-$BOX_DIR}"
RUNTIME_ENV_PATH="$RUNTIME_DIR/.env"

TEMPLATE_PROFILE="${CLAWFIRM_TEMPLATE_PROFILE:-ubuntu-24.04-root}"
FIREWALL_PROFILE="${CLAWFIRM_FIREWALL_PROFILE:-public-web}"
SWAP_STRATEGY="${CLAWFIRM_SWAP_STRATEGY:-auto}"

mkdir -p "$OUT_DIR" "$SYSTEMD_OUT_DIR"
"$SCRIPT_DIR/render-adapter-env.sh"

if [[ -f "$SYSTEMD_TEMPLATE" ]]; then
  cp "$SYSTEMD_TEMPLATE" "$SYSTEMD_OUT_DIR/clawfirm-adapter.service"
fi

if [[ -d "$RUNTIME_DIR" ]]; then
  cp "$ENV_OUT" "$RUNTIME_ENV_PATH"
fi

cat > "$OUT_DIR/BOOTSTRAP_NOTES.txt" <<EOF
Clawfirm box bootstrap scaffold

template_profile=$TEMPLATE_PROFILE
firewall_profile=$FIREWALL_PROFILE
swap_strategy=$SWAP_STRATEGY
env_path=$ENV_OUT
runtime_env_path=$RUNTIME_ENV_PATH
generated_unit_path=$SYSTEMD_OUT_DIR/clawfirm-adapter.service

Next steps:
1. review the rendered runtime env
2. install dns helper scripts
3. install bind backend / DNS setup if using local DNS
4. install or update systemd units
5. point your agent or clawfirm-cli at the box base URL
6. validate with /health and a publish/reconcile smoke flow
EOF

printf 'Generated %s\n' "$ENV_OUT"
if [[ -f "$SYSTEMD_OUT_DIR/clawfirm-adapter.service" ]]; then
  printf 'Generated %s\n' "$SYSTEMD_OUT_DIR/clawfirm-adapter.service"
fi
printf 'Generated %s\n' "$OUT_DIR/BOOTSTRAP_NOTES.txt"
printf 'Template profile: %s\n' "$TEMPLATE_PROFILE"
printf 'Firewall profile: %s\n' "$FIREWALL_PROFILE"
printf 'Swap strategy: %s\n' "$SWAP_STRATEGY"
printf '  1. Review %s\n' "$ENV_OUT"
printf '  2. Install dns helper scripts and backend if needed\n'
printf '  3. Install/update systemd units\n'
printf '  4. Point your agent or clawfirm-cli at this box\n'
printf '  5. Validate with /health and a publish/reconcile smoke flow\n'
