# Fresh box bring-up

This guide is the canonical path for turning a fresh Ubuntu VPS into a working Clawfirm box.

It is written for the exact workflow we want an owner or AI agent to follow:

1. use SSH once to bootstrap the machine
2. expose the box daemon at `https://box.<domain>`
3. switch to normal operation through the box HTTP API or `clawfirm-cli`
4. avoid SSH for routine publish / reconcile / release work

For the narrower post-bootstrap client contract, see:

- `docs/box-api-contract.md`

## Outcome

At the end of this guide you should have:

- a running `clawfirm-boxd` systemd service
- a local runtime env at `/opt/clawfirm-box/.env`
- the box daemon reachable at `https://box.<domain>`
- a box token for authenticated API access
- optional local authoritative DNS support through bind9 helper wrappers

## Inputs you need before starting

True required inputs:

- `BOX_PUBLIC_IP`, for example `203.0.113.10`
- `BOX_DOMAIN`, for example `example.com`

Derived defaults:

- box daemon hostname: `box.<domain>`
- nameservers: `ns1.<domain>` and `ns2.<domain>`

You also need:

- Ubuntu 24.04 VPS
- root access or a sudo-capable user
- a domain you control if you want public HTTPS and DNS on the box
- registrar access for that domain
- ports `80` and `443` open
- ports `53/tcp` and `53/udp` open too if this box will be authoritative for DNS

## Registrar and DNS prep

If this box will be authoritative for the domain:

1. create glue / host records:
   - `ns1.<domain> -> <BOX_PUBLIC_IP>`
   - `ns2.<domain> -> <BOX_PUBLIC_IP>`
2. delegate the domain to:
   - `ns1.<domain>`
   - `ns2.<domain>`
3. make sure apex hosting will point at the box:
   - `@ -> <BOX_PUBLIC_IP>`
4. usually also point `www` to apex

If you only want the box daemon reachable at `box.<domain>` and do not want local authoritative DNS yet, you can skip the bind9 path for now and just create:

- `box.<domain> -> <BOX_PUBLIC_IP>`

## 1. SSH into the fresh machine and install packages

If you already cloned the repo onto the fresh box and want the shortest path, you can use the one-command helper instead of following each manual step below:

```bash
CLAWFIRM_BOX_PUBLIC_IP=203.0.113.10 \
CLAWFIRM_BOX_DOMAIN=example.com \
CLAWFIRM_BOX_TOKEN="$BOX_TOKEN" \
./scripts/bootstrap-fresh-box.sh
```

Optional flags:

- `CLAWFIRM_BOX_INSTALL_BIND=1` to install bind9, install local DNS helpers, and seed the initial authoritative zone for `<domain>`
- `CLAWFIRM_BOX_CONFIGURE_CADDY=0` to skip automatic Caddy snippet setup

When both defaults are used, the helper now leaves the box in a directly usable state for the base domain:
- `box.<domain>` reverse-proxied through Caddy
- initial authoritative zone created for `<domain>`
- `A` records for `@`, `box`, `ns1`, and `ns2`
- `www -> <domain>` alias

The rest of this guide describes the same flow step by step.

```bash
apt update && apt upgrade -y
apt install -y curl git ca-certificates nodejs npm caddy
```

If this box will also run local authoritative DNS:

```bash
apt install -y bind9 bind9-utils
```

Important implementation note:
- the box must not stop at "bind9 installed"
- the initial zone and starter records must actually be written before Caddy can obtain TLS for `box.<domain>`
- the fresh bootstrap helper now performs that initial zone seed automatically when `CLAWFIRM_BOX_INSTALL_BIND=1`

## 2. Clone the repo onto the box

```bash
git clone <your-clawfirm-box-repo-url> /opt/clawfirm-box
cd /opt/clawfirm-box
npm install
```

## 3. Generate a real box token

Use a strong random token and save it somewhere safe.

```bash
openssl rand -hex 32
```

Example result:

```bash
BOX_TOKEN=replace-with-real-random-token
```

## 4. Render the runtime env

The render helper can derive the default box hostname from `BOX_DOMAIN`.

```bash
CLAWFIRM_BOX_PUBLIC_IP=203.0.113.10 \
CLAWFIRM_BOX_DOMAIN=example.com \
CLAWFIRM_BOX_TOKEN="$BOX_TOKEN" \
./scripts/render-box-env.sh
```

Then install the rendered env:

```bash
cp .generated/.env /opt/clawfirm-box/.env
```

If you want to override the default daemon hostname, set `CLAWFIRM_BOX_HOSTNAME` explicitly before rendering.

## 5. Optional: install local DNS helpers for bind9

Run this only if the box should manage authoritative DNS locally.

```bash
sudo ./scripts/install-bind-backend.sh
```

That installs local helper wrappers such as:

- `/usr/local/bin/clawfirm-dns-read`
- `/usr/local/bin/clawfirm-dns-apply`

## 6. Install and start the systemd service

```bash
sudo install -m 0644 systemd/clawfirm-boxd.service /etc/systemd/system/clawfirm-boxd.service
sudo systemctl daemon-reload
sudo systemctl enable clawfirm-boxd
sudo systemctl restart clawfirm-boxd
sudo systemctl status clawfirm-boxd --no-pager
```

## 7. Verify local health first

```bash
curl http://127.0.0.1:8787/health
```

That should return a healthy JSON response before you move on.

## 8. Expose the daemon through Caddy

The box daemon should be reachable at `https://box.<domain>` so that `clawfirm-cli` and other agents can talk to it over HTTPS.

Create a simple Caddy snippet like this:

```caddy
box.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

If your Caddyfile imports `/etc/caddy/sites-enabled/*.caddy`, write it there and reload Caddy.

Example:

```bash
sudo mkdir -p /etc/caddy/sites-enabled
cat <<'EOF' | sudo tee /etc/caddy/sites-enabled/clawfirm-box.caddy >/dev/null
box.example.com {
  reverse_proxy 127.0.0.1:8787
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Now verify public health:

```bash
curl https://box.example.com/health
```

## 9. Switch to REST-only operation

After the box daemon is live behind HTTPS, normal operation should go through the box API, not SSH.

Use the box base URL:

- `https://box.<domain>`

Use the box token as bearer auth:

- `Authorization: Bearer <BOX_TOKEN>`

Example direct API call:

```bash
curl -X POST https://box.example.com/domains/reconcile \
  -H "Authorization: Bearer $BOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","requestedBy":"bootstrap","reason":"initial reconcile"}'
```

## 10. Validate routine remote operation

The repo includes a smoke helper for this phase.

```bash
BOX_BASE_URL=https://box.example.com \
BOX_SECRET="$BOX_TOKEN" \
ZONE=example.com \
A_RECORD=203.0.113.10 \
./scripts/test-remote-install.sh
```

That verifies:

- service health
- zone ensure flow
- record apply flow
- zone read flow

## 11. Use clawfirm-cli instead of SSH for normal work

After bootstrap, the expected control path is:

- `clawfirm-cli` -> box daemon REST API
- not `clawfirm-cli` -> SSH

Typical flows should be things like:

- box status
- domain reconcile
- publish static site
- list releases
- rollback release

The smoke script `scripts/e2e-box-smoke.sh` shows the intended CLI shape.

Example command shapes:

```bash
clawfirm mini box.example.com doctor api --json
clawfirm mini box.example.com status --json
clawfirm mini box.example.com reconcile example.com --json
clawfirm mini box.example.com publish ./site --domain example.com
clawfirm mini box.example.com releases list example.com
```

If you want a single sanity pass after bootstrap, use:

```bash
./scripts/e2e-box-smoke.sh box.example.com example.com hello.example.com
```

That script demonstrates the intended control model:

- `clawfirm-cli` talks to the box daemon over HTTPS
- routine box operations do not require SSH

## 12. Common routine API operations

These examples are useful when an agent wants to talk directly to the box daemon without using `clawfirm-cli`.

Reconcile a domain:

```bash
curl -X POST https://box.example.com/domains/reconcile \
  -H "Authorization: Bearer $BOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","requestedBy":"agent","reason":"ensure runtime is ready"}'
```

List releases:

```bash
curl -X POST https://box.example.com/releases \
  -H "Authorization: Bearer $BOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com"}'
```

Rollback to a release:

```bash
curl -X POST https://box.example.com/rollback \
  -H "Authorization: Bearer $BOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","releaseId":"r123"}'
```

## Operational note

SSH is still useful for:

- OS upgrades
- package install
- service recovery
- Caddy changes
- bind9 recovery

But routine content and domain operations should happen through the box daemon API once setup is complete.
