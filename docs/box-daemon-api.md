# Clawfirm box daemon API

HTTP API for the self-hosted Clawfirm mini-box runtime.

This API is meant to be called directly by the box owner, `clawfirm-cli`, or an owner-controlled AI agent.

## Auth

Mutation endpoints require:

- `Authorization: Bearer <CLAWFIRM_ADAPTER_SHARED_SECRET>`

The runtime also accepts the shorter compatibility alias `CLAWFIRM_ADAPTER_TOKEN`.

## Health

### `GET /health`

Returns basic liveness.

## Release endpoints

### `POST /publish`

Input:

- `domain`
- either:
  - `archiveBase64`
  - `archiveBytes` (optional but should match the uploaded archive)
  - `archiveSha256` (optional integrity check)
- or:
  - `html`
  - `files`
  - `archiveBytes`
  - `archiveSha256`
- `title` (optional)
- `activate` (optional)

Behavior:

- supports ZIP-archive publish and direct file-bundle publish
- validates and normalizes both ingress modes into the same release tree
- writes release assets into the domain release directory

Output:

- `releaseId`
- `livePath`
- `liveUrl`
- `artifactSha256`

### `POST /releases`

Input:

- `domain`

Output:

- `releases: [{ releaseId, current }]`

### `POST /rollback`

Input:

- `domain`
- `releaseId`

### `POST /delete-release`

Input:

- `domain`
- `releaseId`

## Domain readiness

### `POST /domains/reconcile`

Input:

- `domain`
- `requestedBy` (optional)
- `reason` (optional)

Behavior:

- ensures the DNS zone exists
- ensures the static site root exists
- ensures the box has a managed Caddy host config
- reloads Caddy after runtime changes
- probes domain readiness

Output includes:

- `dnsReady`
- `siteRootReady`
- `servingReady`
- `tlsReady`
- `runtimeReady`
- `actions[]`

## DNS endpoints

### `POST /dns/get-zone`
- input: `zone`

### `POST /dns/ensure-zone`
- input: `zone`, `requestedBy`, `reason`

### `POST /dns/apply-records`
- input: `zone`, `records`, `requestedBy`, `reason`

## Admin / stats endpoints

These are internal box endpoints protected by the same shared-secret auth:

- `POST /admin/system-health`
- `POST /admin/service-health`
- `POST /admin/storage-health`
- `POST /admin/log-pipeline-health`
- `POST /stats/release-summary`
- `POST /stats/release-top-paths`

## Deployment note

For the one-box path, run this service on the same machine that owns static hosting and local DNS helper access. A common pattern is to expose it at a hostname like `box.example.com`.
