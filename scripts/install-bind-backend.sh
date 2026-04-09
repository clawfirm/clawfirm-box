#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ZONE_DIR="${CLAWFIRM_ALL_IN_ONE_DNS_ZONE_DIR:-/etc/bind/clawfirm-zones}"
NAMED_CONF="${CLAWFIRM_ALL_IN_ONE_DNS_NAMED_CONF:-/etc/bind/named.conf.local}"

export DEBIAN_FRONTEND=noninteractive
apt update
apt install -y bind9 bind9-utils

mkdir -p "$ZONE_DIR"
if [[ ! -f "$NAMED_CONF" ]]; then
  touch "$NAMED_CONF"
fi

"$SCRIPT_DIR/install-dns-helpers.sh"

if ! grep -q "clawfirm-zones" /etc/bind/named.conf.options 2>/dev/null; then
  :
fi

echo
echo "bind9 backend prepared."
echo "  named conf: $NAMED_CONF"
echo "  zone dir:   $ZONE_DIR"
echo
echo "Next steps:"
echo "  1. Verify rndc works: rndc status"
echo "  2. Ensure port 53/tcp and 53/udp are open when ready"
echo "  3. Test: echo '{\"zone\":\"example.com\"}' | /usr/local/bin/clawfirm-dns-read"
