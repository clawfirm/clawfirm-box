#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-wave0.com}"
ROOT_DOMAIN="${2:-wave0.com}"
SUBDOMAIN="${3:-hello.wave0.com}"
CLI_BIN="${CLAWFIRM_BIN:-${HOME}/.local/bin/clawfirm}"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/root" "$TMP_ROOT/sub"
printf '<!doctype html><h3>hello %s</h3>\n' "$ROOT_DOMAIN" > "$TMP_ROOT/root/index.html"
printf '<!doctype html><h3>hello %s</h3>\n' "$SUBDOMAIN" > "$TMP_ROOT/sub/index.html"

"$CLI_BIN" mini "$TARGET" doctor api --json >/dev/null
"$CLI_BIN" mini "$TARGET" status --json >/dev/null
"$CLI_BIN" mini "$TARGET" reconcile "$ROOT_DOMAIN" --json >/dev/null
"$CLI_BIN" mini "$TARGET" reconcile "$SUBDOMAIN" --json >/dev/null

"$CLI_BIN" mini "$TARGET" publish "$TMP_ROOT/root" --domain "$ROOT_DOMAIN"
"$CLI_BIN" mini "$TARGET" publish "$TMP_ROOT/sub" --domain "$SUBDOMAIN"
"$CLI_BIN" mini "$TARGET" releases list "$ROOT_DOMAIN"
"$CLI_BIN" mini "$TARGET" releases list "$SUBDOMAIN"

printf 'Smoke flow finished for %s and %s using target %s\n' "$ROOT_DOMAIN" "$SUBDOMAIN" "$TARGET"
