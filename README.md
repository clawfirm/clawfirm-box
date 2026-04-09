# clawfirm-box

`clawfirm-box` is the self-hosted mini-box runtime for Clawfirm.

It is designed for a box owner and their AI agent to interact with the box directly.

## What this repo contains

- the box adapter HTTP API
- static release publish, rollback, and listing logic
- domain reconcile helpers for Caddy and local site state
- local DNS helper scripts for bind9-backed box setups
- bootstrap and deployment scripts for a single-box install
- tests and TLA+ specs for the runtime contract

## Core model

One machine can run:

- the Clawfirm box adapter
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
./scripts/render-adapter-env.sh
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

See `docs/adapter-api.md` for the current contract.

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
