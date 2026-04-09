# clawfirm-box deployment

## Intended topology

Single-box mode:

- one host runs the box daemon service
- the same host can run Caddy
- the same host can store releases under `/srv/clawfirm-box/sites`
- the same host can optionally run bind9 and local DNS helper wrappers

Split mode is still possible:

- static host runs the box daemon service
- DNS host exposes constrained helper scripts

## Local deploy helper

```bash
./scripts/deploy-static-host.sh
```

## Remote env to set

Edit `/opt/clawfirm-box/.env` and set at minimum:

- `CLAWFIRM_ADAPTER_SHARED_SECRET` or `CLAWFIRM_ADAPTER_TOKEN`
- `CLAWFIRM_DNS_MODE=local` or `ssh`
- `CLAWFIRM_DNS_DEFAULT_A=<public-ip>`

If using SSH DNS mode, also set:

- `CLAWFIRM_DNS_SSH_HOST`
- `CLAWFIRM_DNS_SSH_USER`
- `CLAWFIRM_DNS_SSH_KEY_PATH`

## Smoke test

After the service is live:

```bash
ADAPTER_BASE_URL=https://box.example.com \
ADAPTER_SECRET=replace-me \
ZONE=example.com \
A_RECORD=203.0.113.10 \
./scripts/test-remote-install.sh
```
