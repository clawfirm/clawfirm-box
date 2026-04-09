# Mini-box product shape

`clawfirm-box` is the owner-controlled runtime surface for direct agent interaction.

## Product boundary

The box owns:

- local runtime API
- release storage and activation
- reconcile / repair behavior
- local Caddy integration
- local or SSH-backed DNS helper execution

The box does not require:

- cloud control-plane services
- billing integration
- multi-tenant hosted workflows

## Primary interface

The canonical interface is a direct HTTP API secured by a box secret.

Clients may include:

- `clawfirm-cli`
- the owner's AI agent
- local automation

## First deployment target

The first-class deployment target is one Ubuntu VPS running:

- Caddy
- the Clawfirm box adapter
- release storage
- optional bind9
