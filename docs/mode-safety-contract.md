# Mind Atlas Mode Safety Contract

Mind Atlas is developed in two modes that must coexist. Every implementation
task must identify its mode impact before editing.

## Mode Categories

- `shared-core`: notebook data, layout, persistence, import/export, tutorial,
  AI Partner log, context assembly, and UI primitives shared by both modes.
- `local-only`: local developer mode run by `npm run dev:all`, including the
  local bridge, Codex, Claude Code, OpenClaw, Local/LM Studio, filesystem-aware
  developer workflows, and local provider usage panels.
- `hosted-only`: public hosted mode run by `server/mind-atlas-service.mjs` and
  deployed to ConoHa, including Google OAuth, Stripe, PostgreSQL credit, hosted
  Chat, Realtime Talk, Dictation, and server-side provider keys.
- `deployment-only`: VPS, nginx, systemd, DNS, HTTPS, Stripe webhook, and
  environment-file changes.
- `dangerous-cross-mode`: any change that touches shared AI UI, service/client
  routing, environment loading, build flags, auth, billing, provider selection,
  or command execution. These changes require both local and hosted checks.

## Hard Rules

- Hosted public mode is selected by `VITE_MIND_ATLAS_PUBLIC_SERVICE=true`.
  It must never expose Codex, Claude Code, OpenClaw, Local/LM Studio, shell
  execution, local filesystem tools, work-root controls, local bridge status,
  or API keys to browser users.
- Local developer mode must not require Google OAuth, Stripe, ConoHa,
  PostgreSQL production data, or hosted-service credentials to open and use the
  normal local bridge workflow.
- Shared code must not assume one mode's environment variables, endpoints, or
  entitlement model when the other mode is active.
- Browser code must never receive provider API keys, Stripe secrets, Google
  OAuth secrets, database URLs, private keys, or VPS-only environment values.
- Public hosted AI requests must be authorized server-side from current
  PostgreSQL subscription and credit state. Stale browser UI state cannot
  authorize usage.
- Local agent features may stay powerful, but they remain local-only surfaces
  unless an explicit hosted security design and verification gate is added.
- Hosted Public Mode may expose bounded, structured board-game records (KIF,
  KI2, CSA, PGN, and SGF) through the shared viewer. This does not unlock
  arbitrary multimedia attachments, local filesystem access, or agent tools.

## Required Checks

- For shared-core and local-only changes:
  `npm run typecheck`, `npm run build`, and `npm run verify:ui`.
- For hosted-only and public UI changes:
  `npm run typecheck`, `npm run build`, `npm run verify:hosted-service`,
  `npm run verify:hosted-public-ui`, and a public build with
  `VITE_MIND_ATLAS_PUBLIC_SERVICE=true`.
- For dangerous-cross-mode changes, run both groups above or document exactly
  why a check could not run.

## AI Assistant Handoff Prompt

Use this prompt when asking Claude, Fable, Codex, or another coding assistant
to edit Mind Atlas:

```text
Before editing, read docs/mode-safety-contract.md and follow it.
Mind Atlas has Local Developer Mode and Hosted Public Mode.
Do not expose Codex, Claude Code, OpenClaw, Local models, shell execution,
filesystem tools, work-root controls, local bridge status, or secrets in Hosted
Public Mode. Do not make Google OAuth, Stripe, ConoHa, PostgreSQL production
data, or hosted credentials required for Local Developer Mode.
Classify the task as shared-core, local-only, hosted-only, deployment-only, or
dangerous-cross-mode before changing files, and preserve both modes.
```
