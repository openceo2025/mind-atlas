# Changelog

## Unreleased

### Added

- Added a unified context engine (`src/context/contextEngine.ts`) for all
  node-anchored AI requests: the ancestor path is replayed as real
  user/assistant conversation messages, notebook context is sent as compact
  budget-bounded markdown instead of a JSON dump, and multi-selected nodes are
  pinned automatically.
- Added automatic agent session management: Codex/OpenClaw continue only when
  extending the same branch tip, Claude Code gains session support and always
  forks (`--resume --fork-session`) so stored session ids are immutable
  branch-point snapshots, resumed runs send delta-only prompts, and failed
  resumes fall back to a fresh session with full context replay.
- Added a context token-estimate chip with a send-preview dialog to the command
  dock, plus `npm run verify:context-engine`.

### Changed

- Removed the AI context scope selector and per-backend thread/session
  selectors; context assembly and session continuation are now automatic, with
  a one-shot Session=new override.
- Chat requests (bridge and hosted service) now prefer the context engine's
  messages/markdown payloads; legacy context JSON remains supported for older
  clients.

- Changed the project license from MIT to `AGPL-3.0-only`.
- Added a trademark policy, contributor guide, contributor license agreement,
  commercial licensing notice, and documented open-source/commercial boundary.
- Added an automated pull-request CLA check and an in-app source/license link.

## 0.1.1 - 2026-05-04

### Added

- Added an `Initialize` action to the atlas menu.
- The initialize action clears local notebook changes and returns the atlas to the seeded starting state.

## 0.1.0 - 2026-05-04

Initial public prototype release.

### Added

- 2.5D fixed-orientation universe view.
- Local notebook node editing.
- Child node and sibling branch creation.
- Focus panel editing and attachment preview area.
- Planet color and texture controls.
- Local storage persistence.
- `.mindatlas` JSON export and import.
- GitHub Pages deployment workflow.
- Custom domain support for `mind-atlas.org`.

### Out of Scope

- AI execution.
- Remote sync.
- Vendor-specific adapters.
- Embeddings and semantic search.
- Multi-user collaboration.
