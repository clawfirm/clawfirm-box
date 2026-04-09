function parseList(value, fallback = []) {
  if (typeof value !== "string") {
    return [...fallback];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getConfig(env = process.env) {
  return {
    port: Number(env.CLAWFIRM_ADAPTER_PORT || env.PORT || 8787),
    sharedSecret: env.CLAWFIRM_ADAPTER_SHARED_SECRET || env.CLAWFIRM_ADAPTER_TOKEN || "",
    sitesRoot: env.CLAWFIRM_ADAPTER_SITES_ROOT || env.CLAWFIRM_SITES_ROOT || "/srv/nameserve/sites",
    dnsDefaultARecords: parseList(env.CLAWFIRM_DNS_DEFAULT_A, ["137.184.33.34"]),
    dnsDefaultAaaaRecords: parseList(env.CLAWFIRM_DNS_DEFAULT_AAAA),
    dnsMode: env.CLAWFIRM_DNS_MODE || "ssh",
    dnsSshHost: env.CLAWFIRM_DNS_SSH_HOST || "",
    dnsSshUser: env.CLAWFIRM_DNS_SSH_USER || "",
    dnsSshPort: Number(env.CLAWFIRM_DNS_SSH_PORT || 22),
    dnsSshKeyPath: env.CLAWFIRM_DNS_SSH_KEY_PATH || "",
    dnsReadCommand: env.CLAWFIRM_DNS_READ_COMMAND || "/usr/local/bin/clawfirm-dns-read",
    dnsApplyCommand: env.CLAWFIRM_DNS_APPLY_COMMAND || "/usr/local/bin/clawfirm-dns-apply",
    caddyConfigPath: env.CLAWFIRM_CADDY_CONFIG_PATH || "/etc/caddy/Caddyfile",
    caddySitesDir: env.CLAWFIRM_CADDY_SITES_DIR || env.CLAWFIRM_CADDY_SNIPPETS_DIR || "/etc/caddy/sites-enabled",
    caddyReloadCommand: env.CLAWFIRM_CADDY_RELOAD_COMMAND || "systemctl reload caddy",
    caddyManagedHostExclude: parseList(env.CLAWFIRM_CADDY_MANAGED_HOST_EXCLUDE, ["box.example.com"]),
    noWwwHostSuffixes: parseList(env.CLAWFIRM_NO_WWW_HOST_SUFFIXES, ["dev.example.internal"]),
    caddyHttpOnly: String(env.CLAWFIRM_CADDY_HTTP_ONLY || '').trim().toLowerCase() === 'true',
    caddyServiceName: env.CLAWFIRM_CADDY_SERVICE_NAME || 'caddy',
    accessLogPath: env.CLAWFIRM_ACCESS_LOG_PATH || '/var/log/caddy/access.log',
    logPipelineStaleAfterSeconds: Number(env.CLAWFIRM_LOG_PIPELINE_STALE_AFTER_SECONDS || 300),
  };
}
