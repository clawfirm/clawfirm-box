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

## Prerequisites before cloning

Have these ready first:

- a fresh Ubuntu 24.04 VPS
- root access or a sudo-capable user
- at least one public IPv4 address
- a domain you control, if you want public HTTPS and DNS on the box
- ability to edit registrar DNS settings for that domain
- ports `80` and `443` open, plus `53/tcp` and `53/udp` if the box will run authoritative DNS
- enough disk for release history under `/srv/clawfirm-box/sites`

Record these values before setup:

- `BOX_PUBLIC_IP`, the public IPv4 address of the box
- `BOX_DOMAIN`, the domain the box should manage, for example `example.com`
- `BOX_DAEMON_HOSTNAME`, usually something like `box.example.com`
- `BOX_NAMESERVER_1` and `BOX_NAMESERVER_2`, for example `ns1.example.com` and `ns2.example.com`, if the box will be authoritative
- the glue/host records for those nameservers when they are in-bailiwick
- the apex routing plan for `@` and `www`

DNS / registrar requirements:

- if the box will be authoritative, create registrar host records for `ns1.<domain>` and `ns2.<domain>` pointing to the box IP
- delegate the domain to those nameservers
- if the box will not be authoritative, keep your external DNS provider and point the required records at the box manually
- for apex hosting, prepare `A` (and optional `AAAA`) records for `@`
- for the usual web alias, prepare `www` as a CNAME to the apex unless you intentionally want no `www`

Recommended prep:

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates
```

If this box will run the full single-box stack, install the runtime packages too:

```bash
apt install -y nodejs npm caddy bind9 bind9-utils
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
./scripts/render-box-env.sh
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
sudo install -m 0644 systemd/clawfirm-boxd.service /etc/systemd/system/clawfirm-boxd.service
sudo systemctl daemon-reload
sudo systemctl enable clawfirm-boxd
sudo systemctl restart clawfirm-boxd
```

## Verify

```bash
curl http://127.0.0.1:8787/health
```

If you front it with Caddy, your agent or `clawfirm-cli` can use the public HTTPS base URL after that.
