#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BOX_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
EXAMPLE_ENV="$BOX_DIR/.env.example"
OUT_DIR="${CLAWFIRM_BOX_OUT_DIR:-$BOX_DIR/.generated}"
OUT_PATH="$OUT_DIR/.env"

PUBLIC_IP="${CLAWFIRM_BOX_PUBLIC_IP:-127.0.0.1}"
DOMAIN="${CLAWFIRM_BOX_DOMAIN:-example.com}"
ADAPTER_HOSTNAME="${CLAWFIRM_BOX_ADAPTER_HOSTNAME:-box.$DOMAIN}"
API_KEY="${CLAWFIRM_BOX_ADAPTER_TOKEN:-${CLAWFIRM_BOX_API_KEY:-dev-box-token}}"
TEMPLATE_PROFILE="${CLAWFIRM_TEMPLATE_PROFILE:-ubuntu-24.04-root}"
FIREWALL_PROFILE="${CLAWFIRM_FIREWALL_PROFILE:-public-web}"
SWAP_STRATEGY="${CLAWFIRM_SWAP_STRATEGY:-auto}"

mkdir -p "$OUT_DIR"
cp "$EXAMPLE_ENV" "$OUT_PATH"

python3 - <<'PY' "$OUT_PATH" "$PUBLIC_IP" "$ADAPTER_HOSTNAME" "$API_KEY" "$TEMPLATE_PROFILE" "$FIREWALL_PROFILE" "$SWAP_STRATEGY"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
public_ip, adapter_hostname, api_key, template_profile, firewall_profile, swap_strategy = sys.argv[2:8]
text = path.read_text()
replacements = {
    'CLAWFIRM_DNS_DEFAULT_A=127.0.0.1': f'CLAWFIRM_DNS_DEFAULT_A={public_ip}',
    'CLAWFIRM_AUTH_DOMAIN=box.example.com': f'CLAWFIRM_AUTH_DOMAIN={adapter_hostname}',
    'CLAWFIRM_CADDY_MANAGED_HOST_EXCLUDE=box.example.com': f'CLAWFIRM_CADDY_MANAGED_HOST_EXCLUDE={adapter_hostname}',
    'CLAWFIRM_ADAPTER_TOKEN=replace-with-strong-random-secret': f'CLAWFIRM_ADAPTER_TOKEN={api_key}',
    'CLAWFIRM_TEMPLATE_PROFILE=ubuntu-24.04-root': f'CLAWFIRM_TEMPLATE_PROFILE={template_profile}',
    'CLAWFIRM_FIREWALL_PROFILE=public-web': f'CLAWFIRM_FIREWALL_PROFILE={firewall_profile}',
    'CLAWFIRM_SWAP_STRATEGY=auto': f'CLAWFIRM_SWAP_STRATEGY={swap_strategy}',
}
for old, new in replacements.items():
    text = text.replace(old, new)
path.write_text(text)
PY

printf 'Wrote %s\n' "$OUT_PATH"
printf '  public_ip=%s\n' "$PUBLIC_IP"
printf '  domain=%s\n' "$DOMAIN"
printf '  adapter_hostname=%s\n' "$ADAPTER_HOSTNAME"
printf '  template_profile=%s\n' "$TEMPLATE_PROFILE"
printf '  firewall_profile=%s\n' "$FIREWALL_PROFILE"
printf '  swap_strategy=%s\n' "$SWAP_STRATEGY"
