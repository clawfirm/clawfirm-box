# Mini-box setup guide

This guide is for a fresh VPS that should become a self-hosted Clawfirm box.

## Goal

End up with one box that can:

- receive direct publish requests
- serve static releases
- manage domain reconcile state
- optionally manage local authoritative DNS

## Recommended baseline

- Ubuntu 24.04
- 1 vCPU
- 1 GB RAM
- 25 GB disk

## Install base packages

```bash
apt update && apt upgrade -y
apt install -y nodejs npm caddy bind9 bind9-utils curl git
```

## Clone the repo

```bash
git clone <your-clawfirm-box-repo-url> /opt/clawfirm-box
cd /opt/clawfirm-box
npm install
```

## Render the runtime env

```bash
CLAWFIRM_BOX_PUBLIC_IP=203.0.113.10 \
CLAWFIRM_BOX_DOMAIN=example.com \
CLAWFIRM_BOX_ADAPTER_HOSTNAME=box.example.com \
CLAWFIRM_BOX_ADAPTER_TOKEN=replace-me \
./scripts/render-adapter-env.sh
```

Then copy the staged env into place:

```bash
cp .generated/.env /opt/clawfirm-box/.env
```

## Install DNS helpers

```bash
sudo ./scripts/install-bind-backend.sh
```

## Install the systemd unit

```bash
sudo install -m 0644 systemd/clawfirm-adapter.service /etc/systemd/system/clawfirm-adapter.service
sudo systemctl daemon-reload
sudo systemctl enable clawfirm-adapter
sudo systemctl restart clawfirm-adapter
```

## Verify

```bash
curl http://127.0.0.1:8787/health
```

If you front it with Caddy, your agent or `clawfirm-cli` can use the public HTTPS base URL after that.
