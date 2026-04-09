#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ADAPTER_ROOT="${CLAWFIRM_BOX_ROOT:-/opt/clawfirm-box}"
BIN_DIR="${CLAWFIRM_ALL_IN_ONE_DNS_HELPER_BIN_DIR:-/usr/local/bin}"
NAMED_CONF="${CLAWFIRM_ALL_IN_ONE_DNS_NAMED_CONF:-/etc/bind/named.conf.local}"
ZONE_DIR="${CLAWFIRM_ALL_IN_ONE_DNS_ZONE_DIR:-/etc/bind/clawfirm-zones}"
RELOAD_COMMAND="${CLAWFIRM_ALL_IN_ONE_DNS_RELOAD_COMMAND:-rndc}"
RELOAD_ARGS="${CLAWFIRM_ALL_IN_ONE_DNS_RELOAD_ARGS:-reload}"
DOMAIN="${CLAWFIRM_BOX_DOMAIN:-}"
if [[ -n "$DOMAIN" ]]; then
  DERIVED_DEFAULT_NS="ns1.$DOMAIN,ns2.$DOMAIN"
  DERIVED_SOA_MAILBOX="hostmaster.$DOMAIN"
else
  DERIVED_DEFAULT_NS="ns1.example.com,ns2.example.com"
  DERIVED_SOA_MAILBOX="hostmaster.example.com"
fi
DEFAULT_NS="${CLAWFIRM_ALL_IN_ONE_DNS_DEFAULT_NS:-$DERIVED_DEFAULT_NS}"
SOA_PRIMARY="${CLAWFIRM_ALL_IN_ONE_DNS_SOA_PRIMARY:-}"
SOA_MAILBOX="${CLAWFIRM_ALL_IN_ONE_DNS_SOA_MAILBOX:-$DERIVED_SOA_MAILBOX}"

mkdir -p "$BIN_DIR" "$ZONE_DIR"

READ_TARGET="$ADAPTER_ROOT/scripts/clawfirm-dns-read.mjs"
WRITE_TARGET="$ADAPTER_ROOT/scripts/clawfirm-dns-apply.mjs"

if [[ ! -f "$READ_TARGET" || ! -f "$WRITE_TARGET" ]]; then
  echo "Expected DNS scripts under $ADAPTER_ROOT/scripts" >&2
  exit 1
fi

cat >"$BIN_DIR/clawfirm-dns-read" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export CLAWFIRM_DNS_NAMED_CONF=${NAMED_CONF@Q}
export CLAWFIRM_DNS_ZONE_DIR=${ZONE_DIR@Q}
exec node ${READ_TARGET@Q}
EOF

cat >"$BIN_DIR/clawfirm-dns-apply" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export CLAWFIRM_DNS_NAMED_CONF=${NAMED_CONF@Q}
export CLAWFIRM_DNS_ZONE_DIR=${ZONE_DIR@Q}
export CLAWFIRM_DNS_RELOAD_COMMAND=${RELOAD_COMMAND@Q}
export CLAWFIRM_DNS_RELOAD_ARGS=${RELOAD_ARGS@Q}
export CLAWFIRM_DNS_DEFAULT_NS=${DEFAULT_NS@Q}
export CLAWFIRM_DNS_SOA_PRIMARY=${SOA_PRIMARY@Q}
export CLAWFIRM_DNS_SOA_MAILBOX=${SOA_MAILBOX@Q}
exec node ${WRITE_TARGET@Q}
EOF

chmod +x "$BIN_DIR/clawfirm-dns-read" "$BIN_DIR/clawfirm-dns-apply"

echo "Installed DNS helper wrappers:"
echo "  $BIN_DIR/clawfirm-dns-read"
echo "  $BIN_DIR/clawfirm-dns-apply"
echo "Using named.conf: $NAMED_CONF"
echo "Using zone dir:    $ZONE_DIR"
