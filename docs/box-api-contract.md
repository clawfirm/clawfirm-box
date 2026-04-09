# Clawfirm box API contract

This document defines the intended contract between:

- `clawfirm-box`, the self-hosted box daemon
- `clawfirm-cli`, or any owner-controlled AI agent client

It is narrower and more operational than `docs/box-daemon-api.md`.

## Contract goal

After initial SSH bootstrap, clients should operate the box through HTTPS and bearer-authenticated JSON requests.

Expected control path:

- `clawfirm-cli` -> `https://box.<domain>` -> box daemon REST API
- not `clawfirm-cli` -> SSH for routine publish / reconcile / release work

## Base URL

Clients should target:

- `https://box.<domain>`

Examples:

- `https://box.example.com`
- `https://box.acme.net`

## Authentication

Mutation and admin endpoints require bearer auth.

Preferred runtime env names on the box:

- `CLAWFIRM_BOX_SHARED_SECRET`
- `CLAWFIRM_BOX_TOKEN`

Request header shape:

```http
Authorization: Bearer <box-token>
```

Compatibility:

- older adapter-named env aliases may still exist on the server side
- new clients should use box-named settings and docs

## Content type

For JSON endpoints, clients should send:

```http
Content-Type: application/json
```

## Core client operations

The minimum contract expected by `clawfirm-cli` style clients is:

### Health

- `GET /health`

Used for:

- liveness checks
- connectivity checks
- initial target verification

### Domain reconcile

- `POST /domains/reconcile`

Request body:

```json
{
  "domain": "example.com",
  "requestedBy": "cli-or-agent",
  "reason": "ensure runtime is ready"
}
```

Expected response shape includes:

```json
{
  "dnsReady": true,
  "siteRootReady": true,
  "servingReady": true,
  "tlsReady": true,
  "runtimeReady": true,
  "actions": []
}
```

Client expectation:

- this endpoint is the main idempotent "make the domain ready" action
- clients may call it repeatedly

### Publish

- `POST /publish`

Request body supports either archive publish or direct file-bundle publish.

Expected response shape includes:

```json
{
  "releaseId": "r123",
  "livePath": "/srv/clawfirm-box/sites/example.com/current",
  "liveUrl": "https://example.com",
  "artifactSha256": "..."
}
```

Client expectation:

- successful publish returns a stable `releaseId`
- client can use that release id for listing, rollback, and later bookkeeping

### List releases

- `POST /releases`

Request body:

```json
{
  "domain": "example.com"
}
```

Expected response shape:

```json
{
  "releases": [
    { "releaseId": "r123", "current": true },
    { "releaseId": "r122", "current": false }
  ]
}
```

Client expectation:

- exactly one release should be considered current for a domain at a time
- clients should not infer current release from filesystem details

### Rollback

- `POST /rollback`

Request body:

```json
{
  "domain": "example.com",
  "releaseId": "r122"
}
```

Client expectation:

- rollback targets a prior release id already known to the box
- success should make that release the current one for the domain

### Delete release

- `POST /delete-release`

Request body:

```json
{
  "domain": "example.com",
  "releaseId": "r121"
}
```

Client expectation:

- clients should treat deletion as a maintenance action, not a normal publish flow step
- clients should prefer rollback before deletion if the target release might still be needed

## DNS operations

These endpoints are part of the box contract when the box manages DNS:

- `POST /dns/get-zone`
- `POST /dns/ensure-zone`
- `POST /dns/apply-records`

Client expectation:

- `ensure-zone` is idempotent zone creation / readiness
- `apply-records` is the intended mutation endpoint for record changes
- `get-zone` is a read/verification endpoint

## Error expectations

Clients should expect standard HTTP failure handling:

- `2xx` for success
- `4xx` for caller errors, auth failures, or invalid requests
- `5xx` for box-side failures

Client guidance:

- do not parse human-readable error text as the primary contract
- use status code first
- log body text/json for debugging only

## Idempotency expectations

The box runtime and specs are being shaped around agent-safe, repeated operations.

Client guidance:

- treat `domains/reconcile` as safe to retry
- treat `releases` as read-only
- treat `publish` as potentially non-idempotent unless the client supplies its own higher-level dedupe logic
- treat `rollback` as safe when targeting a known release id

## SSH boundary

SSH is for:

- first-time machine bootstrap
- OS/package/service repair
- Caddy or bind9 recovery
- emergency debugging

SSH is not the intended interface for normal content operations after setup.

## Reference examples

CLI-oriented smoke flow:

- `scripts/e2e-box-smoke.sh`

Bootstrap and switch-to-REST guide:

- `docs/fresh-box-bring-up.md`

Endpoint reference:

- `docs/box-daemon-api.md`
