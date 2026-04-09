# clawfirm-box

`clawfirm-box` is the self-hosted mini-box runtime for Clawfirm.

It is designed for a box owner and their AI agent to interact with the box directly.

## What this repo contains

- the box daemon HTTP API
- static release publish, rollback, and listing logic
- domain reconcile helpers for Caddy and local site state
- local DNS helper scripts for bind9-backed box setups
- bootstrap and deployment scripts for a single-box install
- tests and TLA+ specs for the runtime contract

## Core model

One machine can run:

- the Clawfirm box daemon
- Caddy
- local release storage under `/srv/clawfirm-box/sites`
- local DNS helper commands
- optional bind9 for authoritative DNS on the same machine

That gives the owner a direct box-native API that `clawfirm-cli` or another agent client can talk to.

## Repo layout

- `src/` runtime server and domain/release logic
- `scripts/` bootstrap, deploy, DNS, and smoke helpers
- `systemd/` starter unit files
- `env/` box-oriented env templates
- `docs/` public docs for setup and API shape
- `test/` handler and runtime tests
- `spec/` TLA+ models

## Prerequisites before cloning

- Ubuntu 24.04 VPS
- root access or a sudo-capable user
- at least one public IPv4 address for the box
- a domain you control if you want public HTTPS and DNS on the box
- ability to change registrar DNS settings for that domain
- ports `80` and `443` open, plus `53/tcp` and `53/udp` if this box will run authoritative DNS
- enough disk for release history under `/srv/clawfirm-box/sites`

Have these values ready before setup:

- `BOX_PUBLIC_IP`, the public IPv4 that will serve the sites and daemon
- `BOX_DOMAIN`, the main domain you want the box to manage, for example `example.com`

The box can derive these conventions from `BOX_DOMAIN`:

- daemon hostname: `box.<domain>`
- nameservers: `ns1.<domain>` and `ns2.<domain>`

Registrar / DNS requirements:

- set registrar host/glue records for `ns1.<domain>` and `ns2.<domain>` to the box IP when the box will be authoritative
- set the domain nameservers at the registrar to `ns1.<domain>` and `ns2.<domain>`
- for normal apex hosting, `@ -> <BOX_PUBLIC_IP>` should exist
- for the default web alias, `www -> @` or `www -> <BOX_DOMAIN>` should exist unless you intentionally want apex-only behavior

Recommended prep:

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates
```

If this box will run the full stack locally:

```bash
apt install -y nodejs npm caddy bind9 bind9-utils
```

## Quick start

```bash
npm install
cp .env.example .env
npm start
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Box bootstrap flow

Render a box env scaffold:

```bash
CLAWFIRM_BOX_PUBLIC_IP=203.0.113.10 \
CLAWFIRM_BOX_DOMAIN=example.com \
CLAWFIRM_BOX_ADAPTER_HOSTNAME=box.example.com \
CLAWFIRM_BOX_ADAPTER_TOKEN=replace-me \
./scripts/render-box-env.sh
```

Stage bootstrap assets:

```bash
./scripts/bootstrap.sh
```

Install local DNS helper wrappers for a bind9-backed box:

```bash
sudo ./scripts/install-bind-backend.sh
```

## Runtime API

Important endpoints:

- `GET /health`
- `POST /publish`
- `POST /releases`
- `POST /rollback`
- `POST /delete-release`
- `POST /domains/reconcile`
- `POST /dns/get-zone`
- `POST /dns/ensure-zone`
- `POST /dns/apply-records`

See `docs/box-daemon-api.md` for the current contract.

## Tests

```bash
npm test
```

Handler-only tests:

```bash
npm run test:handlers
```

TLA+ checks:

```bash
npm run test:tla
```

## Status

This repo is the public starting point for the mini-box path. It already contains working runtime code and bootstrap scaffolding, but it is still being polished into a smoother owner-facing install story.
