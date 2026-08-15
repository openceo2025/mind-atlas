# Mind Atlas AI Bridge

Mind Atlas keeps provider API keys out of the browser. The React app talks to a small local bridge, and the bridge talks to OpenAI or OpenAI-compatible providers.

For public paid hosting, do not expose the local bridge directly. Build with
`VITE_MIND_ATLAS_PUBLIC_SERVICE=true` and run
`server/mind-atlas-service.mjs` instead. The hosted service adds Google OAuth,
Stripe Billing, PostgreSQL user/session/subscription/credit storage, and
server-side Chat/Realtime proxying. See [vps-service.md](vps-service.md).
Run `npm run verify:hosted-service` before deploying to check the hosted
routes, provider catalog, deployment templates, and required environment
entries without using real provider keys.

## Start

Start the app and bridge together:

```powershell
npm run dev:all
```

Open `http://127.0.0.1:5173/`.

Or start them separately:

```powershell
$env:MIND_ATLAS_OPENAI_API_KEY="sk-..."
npm run dev:bridge
```

In another terminal:

```powershell
npm run dev
```

If no API key is configured, text prompts still work through a mock response so the UI flow can be tested.

## Configuration

Copy `.env.example` values into your shell, deployment environment, or local
`.env.local`. The bridge reads `.env` and `.env.local` on startup without
overriding variables already set by the shell.

- `MIND_ATLAS_OPENAI_API_KEY`: server-side OpenAI key. `OPENAI_API_KEY` also works.
- `MIND_ATLAS_OPENAI_MODEL`: default Responses API model.
- `MIND_ATLAS_MAX_OUTPUT_TOKENS`: default text output cap for bridge AI calls. Defaults to `8192`.
- `MIND_ATLAS_OPENAI_MAX_OUTPUT_TOKENS`: OpenAI text output cap. Defaults to `MIND_ATLAS_MAX_OUTPUT_TOKENS`.
- `MIND_ATLAS_OPENAI_IMAGE_MODEL`: image generation model. Defaults to `gpt-image-1`.
- `MIND_ATLAS_OPENAI_IMAGE_SIZE`: image generation size. Defaults to `1024x1024`.
- `MIND_ATLAS_OPENAI_TRANSCRIPTION_MODEL`: dictation transcription model. Defaults to `gpt-4o-transcribe`.
- `MIND_ATLAS_OPENAI_BASE_URL`: defaults to `https://api.openai.com/v1`.
- `MIND_ATLAS_OPENAI_MODE`: `responses` by default.
- `MIND_ATLAS_OPENAI_CHAT_MODELS`: optional comma-separated Chat model list. Defaults include the configured OpenAI model.
- `MIND_ATLAS_OPENAI_INPUT_USD_PER_1M` / `MIND_ATLAS_OPENAI_OUTPUT_USD_PER_1M`: optional cost-rate inputs for UI estimates.
- `MIND_ATLAS_LOCAL_BASE_URL`: LM Studio or another OpenAI-compatible local endpoint. Defaults to `http://127.0.0.1:1234/v1`.
- `MIND_ATLAS_LOCAL_API_KEY`: optional local endpoint key. Defaults to `lm-studio`.
- `MIND_ATLAS_LOCAL_MAX_OUTPUT_TOKENS`: Local `/chat/completions` output cap. Defaults to `MIND_ATLAS_MAX_OUTPUT_TOKENS`.
- `MIND_ATLAS_ANTHROPIC_BASE_URL`: optional Chat Opus/Anthropic Messages API base URL. Defaults to `MIND_ATLAS_CLAUDE_ANTHROPIC_BASE_URL`, `ANTHROPIC_BASE_URL`, or `https://api.anthropic.com`.
- `MIND_ATLAS_ANTHROPIC_API_KEY` / `MIND_ATLAS_ANTHROPIC_AUTH_TOKEN`: optional Chat Opus credentials. Existing `MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY` and `MIND_ATLAS_CLAUDE_ANTHROPIC_AUTH_TOKEN` also work.
- `MIND_ATLAS_ANTHROPIC_MODEL`: default Chat Opus model. Defaults to `MIND_ATLAS_CLAUDE_MODEL` or `claude-opus-4-8`.
- `MIND_ATLAS_ANTHROPIC_MODELS`: optional comma-separated Chat Opus model list.
- `MIND_ATLAS_ANTHROPIC_MAX_OUTPUT_TOKENS`: Chat Opus output cap. Defaults to `MIND_ATLAS_OPENAI_MAX_OUTPUT_TOKENS`.
- `MIND_ATLAS_DEEPSEEK_ANTHROPIC_BASE_URL`: optional DeepSeek Anthropic-compatible base URL. Defaults to `https://api.deepseek.com/anthropic`.
- `MIND_ATLAS_DEEPSEEK_AUTH_TOKEN`: optional DeepSeek Chat key. Existing `MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN` and `DEEPSEEK_API_KEY` also work.
- `MIND_ATLAS_DEEPSEEK_MODEL`: default DeepSeek Chat model. Defaults to `deepseek-v4-pro[1m]`.
- `MIND_ATLAS_DEEPSEEK_MODELS`: optional comma-separated DeepSeek Chat model list.
- `MIND_ATLAS_DEEPSEEK_MAX_OUTPUT_TOKENS`: DeepSeek Chat output cap. Defaults to `MIND_ATLAS_OPENAI_MAX_OUTPUT_TOKENS`.
- `MIND_ATLAS_DEEPSEEK_BALANCE_BASE_URL`: DeepSeek native balance API base URL. Defaults to `https://api.deepseek.com`.
- `MIND_ATLAS_WEB_SEARCH_MAX_OUTPUT_TOKENS`: web-search response cap. Defaults to `2048`.
- Hosted service only:
  - `MIND_ATLAS_SERVICE_JSON_MAX_BYTES`: maximum JSON request body. Defaults to `2097152`.
  - `MIND_ATLAS_SERVICE_FORM_MAX_BYTES`: maximum multipart request body, mainly for Dictation audio. Defaults to `29360128`.
  - `MIND_ATLAS_SERVICE_CHAT_INPUT_MAX_CHARS`: maximum serialized Chat input/context/tool size. Defaults to `300000`.
  - `MIND_ATLAS_SERVICE_CHAT_RESERVE_CHARS_PER_TOKEN`: conservative character-to-token ratio for hosted Chat credit reservations. Defaults to `2`.
  - `MIND_ATLAS_SERVICE_MAX_REQUEST_ESTIMATE_MICRO_USD`: per-request operator safety ceiling for estimated Chat cost. Defaults to `2000000`; set `0` to disable.
  - Hosted AI calls reserve credit before upstream execution and settle to actual recorded usage after success. Upstream failures refund the reservation.
  - `MIND_ATLAS_REALTIME_MODELS`: comma-separated Realtime model allowlist for the hosted service. Defaults to the configured `MIND_ATLAS_REALTIME_MODEL`.
  - `MIND_ATLAS_WEB_SEARCH_MAX_QUERY_CHARS`: maximum web-search query length. Defaults to `1000`.
  - `MIND_ATLAS_STRIPE_WEBHOOK_MAX_BYTES`: maximum Stripe webhook body. Defaults to `1048576`.
  - `MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS`: allowed Stripe webhook signature timestamp age. Defaults to `300`.
- Local mode inspects `${MIND_ATLAS_LOCAL_BASE_URL}/models` and uses the first model currently loaded by LM Studio. `MIND_ATLAS_LOCAL_MODEL` is intentionally ignored to avoid auto-loading a model.
- `MIND_ATLAS_CODEX_BIN`: Codex executable name. Defaults to `codex`.
- `MIND_ATLAS_CODEX_USE_WSL`: set `true` to run `wsl codex ...`.
- `MIND_ATLAS_CODEX_WORKSPACE`: workspace passed to `codex exec --cd`.
- `MIND_ATLAS_CODEX_MODEL`: default Codex model. The UI also reads `codex debug models` through the bridge.
- `MIND_ATLAS_CODEX_REASONING_EFFORT`: default Codex reasoning level. The bridge accepts a safe level reported by the installed CLI, including future values such as `ultra`.
- `MIND_ATLAS_CODEX_REASONING_EFFORTS`: fallback comma-separated Codex levels used only when `codex debug models` is unavailable or a manual model list is configured. Live CLI model metadata takes precedence and is deduplicated before the browser receives it.
- `MIND_ATLAS_CODEX_SANDBOX`: default sandbox. Use `workspace-write`; Full access normally requires an approval button in Mind Atlas.
- `MIND_ATLAS_CODEX_MODELS`: optional comma-separated model override when `codex debug models` is unavailable.
- Code runs started through Codex have no elapsed-time limit in Mind Atlas. They continue until the provider finishes, the user stops them, or the process/bridge exits.
- `MIND_ATLAS_OPENAI_REASONING_EFFORTS`, `MIND_ATLAS_ANTHROPIC_REASONING_EFFORTS`, `MIND_ATLAS_DEEPSEEK_REASONING_EFFORTS`: comma-separated Chat reasoning levels exposed for each local bridge provider. Provider APIs do not expose one common capability-discovery endpoint, so update these lists when a provider changes its supported levels. Values are forwarded only as safe identifiers; `default` does not send an effort override.
- `MIND_ATLAS_OPENCLAW_BIN`: OpenClaw executable. Defaults to `openclaw`; on Windows the bridge also auto-detects the user npm OpenClaw entrypoint.
- `MIND_ATLAS_OPENCLAW_AGENT`: optional OpenClaw agent id. Leave blank to use the OpenClaw default agent.
- `MIND_ATLAS_OPENCLAW_TIMEOUT_MS`: OpenClaw execution timeout in milliseconds. Defaults to 10 minutes.
- `MIND_ATLAS_CLAUDE_BIN`: Claude Code executable. Defaults to `claude`. On Windows, the WinGet link path is usually `C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\claude.exe`.
- `MIND_ATLAS_CLAUDE_MODEL`: default Claude Code model. The command dock can override this per run with presets for `claude-opus-4-8`, `claude-fable-5`, and `deepseek-v4-pro[1m]`.
- `MIND_ATLAS_CLAUDE_ANTHROPIC_BASE_URL`: optional `ANTHROPIC_BASE_URL` injected only into Claude Code child processes. Use `https://api.anthropic.com` for Anthropic, or `https://api.deepseek.com/anthropic` for DeepSeek.
- `MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY`: optional `ANTHROPIC_API_KEY` for Anthropic API billing in non-interactive Claude Code runs. Keep it on the bridge/server side, not in browser storage.
- `MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN`: optional DeepSeek API key sent as `ANTHROPIC_AUTH_TOKEN` only when the run targets `https://api.deepseek.com/anthropic`.
- `MIND_ATLAS_CLAUDE_ANTHROPIC_AUTH_TOKEN`: optional generic `ANTHROPIC_AUTH_TOKEN` for custom Anthropic-compatible gateways. Prefer `MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN` for DeepSeek when switching between Anthropic and DeepSeek presets.
- `MIND_ATLAS_CLAUDE_DEFAULT_FABLE_MODEL`, `MIND_ATLAS_CLAUDE_DEFAULT_OPUS_MODEL`, `MIND_ATLAS_CLAUDE_DEFAULT_SONNET_MODEL`, `MIND_ATLAS_CLAUDE_DEFAULT_HAIKU_MODEL`, `MIND_ATLAS_CLAUDE_SUBAGENT_MODEL`, `MIND_ATLAS_CLAUDE_EFFORT_LEVEL`: optional Claude Code env overrides. DeepSeek runs automatically fill the recommended V4 Pro / V4 Flash defaults when these are not set.
- `MIND_ATLAS_CLAUDE_REASONING_EFFORTS`: comma-separated Claude Code `--effort` choices shown in the local command dock. Update it with the installed Claude Code release when Anthropic changes the supported levels.
- `MIND_ATLAS_CLAUDE_WORKSPACE`: default work root for Claude Code runs.
- Code runs started through Claude Code API, Claude Code Pro, or the DeepSeek Claude-compatible route have no elapsed-time limit in Mind Atlas. Short capability and authentication probes still fail quickly and do not terminate an active agent run.

On Windows, Codex can occasionally fail before command execution with
`windows sandbox: spawn setup refresh`. When this exact sandbox initialization
error occurs, the bridge automatically retries the run without the broken OS
sandbox while preserving the requested `read-only` or `workspace-write` policy
in the Codex instructions. The Codex details node records this as
`Sandbox recovery`.
- `MIND_ATLAS_REALTIME_MODEL`: default Realtime model. Defaults to `gpt-realtime-2`.
- `MIND_ATLAS_REALTIME_VOICE`: default voice.
- `MIND_ATLAS_REALTIME_REASONING_EFFORT`: Realtime 2 reasoning effort (`default`, `low`, `medium`, or `high`). Defaults to `low` and is only sent for `gpt-realtime-2` style models.
- `MIND_ATLAS_REALTIME_TRANSCRIPTION_MODEL`: Realtime session input transcription model. Defaults to `gpt-4o-transcribe`.
- `MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS`: Voice Partner idle timeout for `npm run dev:all` and docs. Defaults to one hour.
- `VITE_MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS`: browser-side Voice Partner idle timeout. Defaults to one hour; set a short value in local verification to exercise idle summary shutdown.
- `MIND_ATLAS_CLOUD_DIR`: server-side folder for `クラウドへ保存` / `クラウドから読み込み` notebook packages. Defaults to `server-data/notebooks`.
- `MIND_ATLAS_AGENT_RUN_INBOX_DIR`: local-only durable journal for Codex, Claude Code, and OpenClaw requests. Defaults to `server-data/agent-run-inbox`.
- `MIND_ATLAS_AGENT_RUN_INBOX_GRACE_MS`: delay before a completed journal entry becomes eligible for recovery. This gives the original browser time to store the normal result and acknowledge the entry. Defaults to 5000 milliseconds.
- `MIND_ATLAS_AGENT_RUN_INBOX_LIMIT`: maximum unacknowledged entries returned by one recovery poll. Defaults to 100.
- `MIND_ATLAS_DEV_HTTPS`: when running `npm run dev:all`, defaults to `true` and generates local HTTPS certificates in `.certs/`.
- `MIND_ATLAS_BRIDGE_HOST`: bridge bind host. Defaults to `127.0.0.1`; `npm run dev:all` overrides it to `0.0.0.0` for LAN use.
- `MIND_ATLAS_BRIDGE_PROTOCOL`: `http` or `https`. `npm run dev:all` sets this to match `MIND_ATLAS_DEV_HTTPS`.
- `MIND_ATLAS_ALLOWED_ORIGIN`: browser origin allowed to call the bridge.
- `VITE_MIND_ATLAS_BRIDGE_URL`: bridge URL used by the React app.

## LAN HTTPS

Mobile browsers usually require HTTPS before allowing microphone access from a LAN IP address. `npm run dev:all` therefore enables HTTPS by default:

1. It generates a local CA and server certificate in `.certs/`.
2. It starts Vite on `https://0.0.0.0:5173`.
3. It starts the bridge on `https://0.0.0.0:8787`.
4. It prints LAN HTTPS URLs and the CA path.

Install `.certs/mind-atlas-dev-ca.crt` as a trusted CA on mobile devices that need microphone access. If you only need desktop testing and want HTTP, set `MIND_ATLAS_DEV_HTTPS=false` before `npm run dev:all`.

## Context Engine And Agent Sessions

Node-anchored AI requests are assembled by one shared context engine
(`src/context/contextEngine.ts`) instead of a user-selected scope:

- The ancestor path of the active node is the branch's conversation. Prior
  `human_prompt` / `ai_reply` nodes are replayed as real user/assistant
  messages (`chatMessages` for Chat, a `# Conversation so far` section for
  agent CLIs). Sibling branches stay out unless multi-selected (pinned).
- Everything that is not conversation is rendered as compact markdown
  (`contextText`): breadcrumb, ancestor document bodies, outline skeleton of
  sibling titles, child summaries, pinned nodes, and attachment metadata.
  Output is deterministic and timestamp-free so provider prompt caching works
  across turns on the same branch.
- A per-provider character budget degrades gracefully: oldest conversation
  turns collapse to one-line summaries, deep bodies truncate first. The command
  dock shows a token-estimate chip; clicking it previews exactly what will be
  sent. There is no scope selector.
- Agent CLI sessions are resolved automatically per run:
  - Codex threads and OpenClaw session keys `continue` only when the branch tip
    is being extended; a diverged or stale (7 days) session starts `new` with a
    full context replay.
  - Claude Code always resumes the nearest ancestor `claudeSessionId` with
    `--resume <id> --fork-session`, so every stored session id remains an
    immutable snapshot of its branch point and sibling branches can never
    contaminate each other. The forked `session_id` is stored on the result
    node.
  - On `continue`/`fork`, only a small delta prompt (position + current node +
    task) is sent because the CLI already holds the history. If the resume
    fails (missing rollout / unknown session), the bridge automatically falls
    back to a fresh session with the full context replay and reports
    `sessionInfo.fellBack` in the response.
  - The Session control in the dock is a one-shot override: `new` forces a
    fresh session for the next run only.
- Older payloads without `contextText` / `chatMessages` / `agentPrompt` still
  work through the legacy context-JSON path.
- Verify with `npm run verify:context-engine` (plus the standard checks).

## Local Agent Runtime (local developer mode only)

Codex and Claude Code runs started from Code mode go through a streaming agent
runtime instead of a single batch process. This surface is `local-only`: the
hosted service does not import `scripts/agent-runtime/`, and the browser
workspace is gated behind `isAgentRuntimeAvailable()`, which is false whenever
`VITE_MIND_ATLAS_PUBLIC_SERVICE=true`.

Machine-verified capability evidence lives in
[local-agent-poc-results.md](local-agent-poc-results.md). Nothing in this
section is claimed from provider documentation alone.

### Routes

| Provider | Rich route | Fallback route |
| --- | --- | --- |
| Codex | `codex app-server` over stdio JSON-RPC | `codex exec --json` |
| Claude Code | `claude -p --output-format stream-json --verbose --include-partial-messages` | `claude -p --output-format json` |

`MIND_ATLAS_CODEX_RUNTIME` / `MIND_ATLAS_CLAUDE_RUNTIME` accept `auto`
(default), the rich route name, or the fallback name. `auto` probes the rich
route and falls back automatically; the reason is emitted as a
`route_fallback` warning event on the run. Unknown values fail closed to
`auto`. No runtime route switch happens in the middle of a provider turn.

### Endpoints

```text
GET  /api/agent-capabilities
GET  /api/agent-workspace/inspect?workspace=<path>
GET  /api/agent-runs
POST /api/agent-runs
GET  /api/agent-runs/by-client/:clientRunId
GET  /api/agent-runs/:runId
GET  /api/agent-runs/:runId/events          Server-Sent Events, Last-Event-ID replay
POST /api/agent-runs/:runId/steer
POST /api/agent-runs/:runId/interrupt
POST /api/agent-runs/:runId/compact
POST /api/agent-runs/:runId/approvals/:requestId
POST /api/agent-runs/:runId/user-input/:requestId
POST /api/agent-runs/:runId/handoff
POST /api/agent-runs/:runId/reclaim
POST /api/agent-runs/:runId/checkpoint
POST /api/agent-runs/:runId/revert-checkpoint
POST /api/agent-runs/:runId/remove-worktree
POST /api/agent-runtime/cleanup
GET  /api/agent-runtime/inbox
POST /api/agent-runtime/ack
```

Mutating routes reject a request whose `Origin` is not in
`MIND_ATLAS_ALLOWED_ORIGIN`. A browser cannot forge `Origin`, so that check plus
the loopback bind is the real boundary against a hostile page.

### Workspace policy

By default an agent run may target **any existing directory**, because running
agents across many local repositories is the point of local developer mode. A
small deny-list still applies as a guardrail against a mistyped or
model-suggested work root:

- a whole drive (`C:\`, `/`);
- your home directory itself (it holds provider credentials);
- `.codex`, `.claude`, `.ssh`, `.aws`, `.gnupg` and similar credential folders;
- system directories (`%SystemRoot%`, `%ProgramFiles%`, `%ProgramData%`,
  `/etc`, `/usr`, `/bin`, `/sbin`, `/System`);
- paths that do not exist.

Setting `MIND_ATLAS_AGENT_WORK_ROOTS` switches to hardened mode: only those
roots, the configured Codex/Claude work roots, the bridge working directory,
and paths inside them are allowed. The deny-list still applies on top.

The rules live in `scripts/agent-runtime/workspace-policy.mjs` and are covered
by `npm run verify:agent-runtime`.

Before a Code request can start, the current Atlas branch must be explicitly
bound to the inspected workspace. A Git workspace is compared by the stable
identity derived from `git rev-parse --git-common-dir`, not a folder name, so a
linked worktree still matches its source repository while an unrelated checkout
is blocked. An existing folder without Git is instead bound by its canonical
real path and can run in **Current folder** mode. This lets a new empty project
start before `git init` without weakening Git repository identity checks. Each
manifest always records the actual execution directory and records repository
identity, branch, HEAD, and initial dirty-file snapshot when Git is available.

The optional **Mission worktree** mode requires a Git repository with a clean source checkout and
creates an isolated branch/worktree below
`server-data/agent-runtime/worktrees/`. Follow-up nodes reuse that worktree.
Once a run is terminal, the user may explicitly checkpoint the run-attributed
files, revert that checkpoint with confirmation, or remove a clean worktree.
There is no implicit stash, reset, commit, revert, or worktree removal.

### Parallel runs

Concurrent runs in different work roots are supported and isolated: each has its
own manifest, event stream, and provider session. Separate mission worktrees
also permit parallel missions in one repository. The Agent Run Workspace shows
a switcher when more than one local run is active, so a second run does not
replace the one you are watching. Shared checkouts and the **same existing
mission worktree** still allow only one writer at a time.

Selecting a run in that switcher focuses its linked request node in the Atlas.
Selecting an Atlas node with a retained durable-run link switches the workspace
to that run without forcing a hidden workspace open. Selecting an unrelated
node does not replace or hide the run currently shown in the workspace.

`POST /api/ai/respond` still drives node-anchored runs. When the browser sends
`useAgentRuntime: true`, the bridge executes the request through the runtime
and returns the same `AiResponseResult` shape plus `agentRuntimeRunId` and
`agentRuntimeRoute`. Result nodes, root AI Partner log routing, the legacy run
journal, recovery, and ACK are unchanged. The browser resolves the live run
through `/api/agent-runs/by-client/:clientRunId` while the request is pending.

### Durable storage

```text
server-data/agent-runtime/
  runs/<run-id>/manifest.json     written before any provider process starts
  runs/<run-id>/events.jsonl      appended before each event is broadcast
  runs/<run-id>/final.json        bounded terminal record
  runs/<run-id>/diagnostics.log   bounded provider diagnostics
  sessions/<provider-session-key>.json
  handoffs/<handoff-id>.json
```

### Acknowledgement and retention

A run is `unread` until it is acknowledged. Opening a finished run in the Agent
Run Workspace acknowledges it, and the workspace also offers a
`Mark N read` action. Acknowledgement matters for more than the badge:
`applyRetention` deletes **only** acknowledged terminal runs, so a run that is
never acknowledged is never reclaimed and `runs/` grows without bound.

Retention runs at bridge startup and removes acknowledged terminal runs older
than `MIND_ATLAS_AGENT_EVENT_RETENTION_DAYS` (30 days), plus the oldest
acknowledged runs when the total exceeds `MIND_ATLAS_AGENT_EVENT_MAX_BYTES`.
Unacknowledged results are never deleted.

`server-data/agent-run-inbox` remains the compatibility recovery path. Closing
the workspace only hides it; the Agent runs launcher, recent-run switcher, and
result-node action reopen the same durable run. On startup a run left
non-terminal by a previous bridge process is marked
`interrupted` with a recoverable final record. Retention removes only
acknowledged terminal runs. Tokens, auth headers, environment values, and
common secret patterns are redacted before anything is journaled or broadcast.

### Capabilities

`GET /api/agent-capabilities` returns runtime-discovered models, reasoning
efforts, permission profiles, sandbox modes, tools, MCP servers, skills, and a
`supports` map. Anything not proven by the runtime is `false` with a reason in
`unavailableReasons`. Codex effort values come from `model/list`, so provider
levels added later (for example `max` or `ultra`) appear without a Mind Atlas
change. The Capabilities tab exposes the runtime-reported models, efforts,
tools, skills, MCP servers, slash commands, subagent definitions, and support
reasons. Steer, Compact, and browser controls stay disabled unless that exact
route reports support.

### Code model preflight

`GET /api/codex/options?refresh=<backend>` uses `codex`, `claude-api`, or
`claude-subscription` as the refresh scope. Each route returns a shared
`ready`/`error` discovery state with its source, detail, and check time.

Code execution is fail-closed. Codex models must be reported by the installed
Codex CLI, Anthropic and DeepSeek models must be present in a successful live
provider response, and Claude Code Pro models must have been recently observed
in the native Claude client state. Configured fallback model names may still be
used by Chat, but they are never presented as confirmed Code models after a
discovery failure. The model field shows the error and send remains disabled;
the bridge repeats the availability check before it starts a run.

Refresh work is backend-specific to avoid polling every provider together:
Codex runs at most every 10 minutes, Claude API and DeepSeek every 30 minutes,
and the lightweight Claude Code Pro cache every 5 minutes and when the browser
regains focus. Concurrent refreshes are coalesced, and an unchanged response
does not update browser state.

### Context accounting

Three separate metrics, never merged:

1. Mind Atlas injection - a script-aware preflight estimate, always labelled an
   estimate. Japanese, Chinese, and code are weighted separately instead of
   using one character divisor.
2. Provider session - `thread/tokenUsage/updated.modelContextWindow` for Codex
   and `result.modelUsage[model].contextWindow` plus `result.usage` for Claude.
   Remaining context is shown only when both used tokens and the window are
   known.
3. Account allowance - Claude `rate_limit_event`. This is not the context
   window and is displayed separately. Its utilization also feeds the
   Claude-selected usage bar after a subscription run reports it. The label is
   deliberately "Claude Code subscription/SDK allowance", because programmatic
   Claude Code usage must not be presented as a guaranteed clone of a consumer
   app's gauge.

### Read-only Atlas tools

When `MIND_ATLAS_ATLAS_MCP` is not `false`, a Claude run receives an additive
`--mcp-config` pointing at `scripts/agent-runtime/atlas-mcp-server.mjs` with a
run-scoped sanitized notebook snapshot. The user's own MCP servers are kept
(`--strict-mcp-config` is deliberately not used). Tools:
`search_nodes`, `semantic_search_nodes`, `get_node`, `get_branch`,
`get_children`, `get_atlas_outline`. All are read-only, and
`semantic_search_nodes` reports `scoringMode: "lexical+ngram"` with
`degraded: true` because no embedding backend is configured - it never claims
to be vector search. The matcher is the same pure implementation used by the
human Ctrl+F search. Codex is not auto-configured with this server because that
would require mutating provider configuration.

### Evidence and multimodal input

Image and PDF attachments on the active node and its ancestors are uploaded to
`POST /api/agent-evidence`, stored content-addressed under
`server-data/agent-runtime/evidence/`, and passed to the run as typed evidence.
`MIND_ATLAS_AGENT_EVIDENCE_MAX_BYTES` caps a single file (20 MB by default) and
oversized files are rejected before the run starts.

Transport is decided from the runtime's reported capabilities and recorded on
the run as an `evidence_transport` event with a per-item status:

- `attached` - Codex receives the bytes as a typed `localImage` input. Verified
  live: the model described the contents of `public/og-image.png`.
- `referenced` - only the local path was sent, plus an explicit prompt block
  stating the file was **not** attached and the model must open it with its own
  file-reading tool. This is what Claude print mode gets today.
- `unsupported` - the selected model or runtime cannot receive the file at all.

Mind Atlas never implies a file was seen when only its path was sent.

### Browser capability

Detection reads the installed CLI's own option list. The verified Claude Code
build exposes `--chrome`, so a direct Claude plan route reports
`supports.browser: true` and a run can opt in with `browser: true`, which adds
`--chrome` to that invocation only. Anthropic API and DeepSeek routes report
`false` with the reason that Claude in Chrome requires direct plan
authentication. Codex reports `false` because this app-server session
advertises no browser tool. Nothing is enabled without that runtime evidence.

### Native handoff and session ownership

Ownership is `mind_atlas -> transferring -> native -> reconciling ->
mind_atlas`. A handoff is refused while a turn is active, the handoff record is
durable before any external process starts, and a failed launch returns
ownership to Mind Atlas. Only an explicit reclaim leaves `native`.

- Codex: `codex resume <thread-id>` in a terminal at the run workspace. This
  was verified to continue an app-server thread with full history. The
  `codex://threads/<id>` deep link is probed at runtime and stays disabled when
  no URL handler is registered.
- Claude subscription: `claude --resume <session-id>` in a terminal. `/desktop`
  is advertised only when the installed build reports that command; on the
  verified build it does not, so Desktop continuity is never claimed.
- Claude API / DeepSeek: no native session continuity. These routes receive the
  handoff package (workspace, branch, HEAD, dirty files, diff, request, answer,
  tests, Atlas nodes, evidence paths) with credentials excluded.

### Verification

```powershell
npm run verify:agent-runtime
```

Covers redaction, run state transitions, journal durability and replay,
idempotency, output budgets, interrupted-run recovery, retention safety,
fake-provider runs, ownership and handoff sanitization, the Atlas tools, the
context estimator including Japanese, and Markdown/link safety. It uses fake
providers only, so it never makes a paid provider call.

The Agent Run Workspace UI is a local-only developer surface and is
intentionally English-only; its strings are recorded in
`i18n/hardcoded-baseline.json` rather than the translated catalog.

## Live Model Discovery

The bridge no longer serves hardcoded model lists. At startup, and then every
`MIND_ATLAS_MODEL_REFRESH_MS` (30 minutes by default), it asks each configured
provider for its real catalogue:

| Service | Endpoint |
| --- | --- |
| OpenAI | `GET {MIND_ATLAS_OPENAI_BASE_URL}/models` |
| Claude (Anthropic) | `GET {MIND_ATLAS_ANTHROPIC_BASE_URL}/v1/models` |
| DeepSeek | `GET {MIND_ATLAS_DEEPSEEK_BALANCE_BASE_URL}/models` |

Rules:

- a provider with no credential is never fetched and keeps its configured list;
- a failed or empty fetch falls back to the configured list;
- `modelSource` is `live` or `configured`, and `modelSourceDetail` carries the
  reason, so the UI never presents a stale list as if it were live;
- configured models stay in the list even when discovery omits them, so a
  pinned model never disappears;
- models are ordered newest version first. A snapshot date only breaks ties
  between the same version, so `claude-opus-5` outranks
  `claude-opus-4-5-20251101`.

The Chat service formerly labelled `Opus` is labelled `Claude`, because it
routes every Anthropic Claude model rather than only Opus.

### Model display names

Version numbers are always shown: `claude-opus-4-8` renders as
`Claude Opus 4.8`, `gpt-5.5-pro-2026-04-23` as `GPT-5.5 Pro (2026-04-23)`, and
`deepseek-v4-pro[1m]` as `DeepSeek V4 Pro [1m]`. Claude Code subscription
aliases carry no version of their own, so they are labelled with the model they
resolve to (`opus` renders as `Claude Opus 4.8`).

### Reasoning effort per model

Effort lists are per model, not per service. A non-reasoning model such as
`gpt-4.1` or `deepseek-chat` offers only `default` instead of a picker full of
levels it would reject. Changing model moves the effort to that model's default
when the current one is not accepted.

Code mode uses the same discovery: the Claude Code API route lists live
Anthropic and DeepSeek models with their base URLs, and the subscription route
lists the account aliases with their resolved versions.

## Branch Sessions And Context Cost

The unit of an agent session is the **branch**, not the node. One node starts a
session explicitly and becomes the origin; every descendant continues that same
session. A per-node cold start pays to rediscover the repository on every run,
which is the dominant cost in a long-running branch - far larger than anything
Mind Atlas injects.

| Situation | Action | Codex | Claude Code |
| --- | --- | --- | --- |
| No session, stale session, or user chose `new` | `new` | `thread/start` | fresh session |
| Extending the tip of the branch that owns the session | `continue` | `thread/resume`, same thread id | `--resume <id>`, same session id |
| A sibling branch already advanced the session | `fork` | `thread/fork`, new thread id with inherited history | `--resume <id> --fork-session` |

Transports that cannot branch degrade honestly: `codex exec` starts a fresh
thread for a fork request and reports `fellBack` with
`codex-exec-cannot-fork-a-diverged-branch`, because reusing the id there would
splice two Atlas branches into one linear transcript. OpenClaw keys are linear,
so divergence always means a new session.

Verified live against the installed Codex app-server: `resume` returned the same
thread id and recalled a token from the origin turn; `fork` returned a new
thread id and still recalled it.

### What is sent

- **New session**: stable prefix (ancestors, outline, pinned nodes), then the
  branch conversation, then the volatile tail (current node id and body), then
  the task.
- **Resumed session**: only the delta - position plus task. Ancestors and the
  conversation are already in the provider session, and re-sending them is pure
  cost.

Payload order is stable-first because provider prompt caching only reuses an
unchanged prefix. Putting the current node id or the task early invalidates the
cache on every run and pays full price for the whole prompt.

### Truncation

`capText` keeps the opening **and** the closing text and states how much was
removed from the middle. Cutting only the tail silently deleted acceptance
criteria; cutting only the head deleted the specification.

### Conversation replay

`verbatimTurnLimit` caps how many recent turns are replayed word for word (two
for agents) independently of the character budget. Older turns become one-line
summaries, so payload size stops growing with branch depth. Measured on a
depth-8 branch: cold start fell 57.6% and a resumed run is 85.9% smaller than a
cold start.

### Settings follow the branch

Settings are committed to a node when a run executes, not on every edit. Editing
without running leaves a draft that is discarded when the node is reselected, and
a node without its own settings inherits the nearest ancestor's - so descendants
follow the model, effort, permission and work root of the node that started the
session.

## Current AI Surface

- The command dock supports Chat, Code, OpenClaw, and Note modes.
- The AI modes include a compact usage panel. The Selected view automatically follows the Code backend being edited; All exposes the browser-local multi-metric selection. OpenAI Codex 5-hour and 7-day remaining percentages come from `codex app-server` `account/rateLimits/read`; DeepSeek balance comes from `GET /user/balance`; Claude subscription/SDK allowance comes from the latest durable Claude Code `rate_limit_event` carrying utilization. Anthropic's Claude Console organization-credit value has no public balance API and remains an explicit unavailable metric.
- Chat is the shared non-agent conversation entry. It can target OpenAI, Opus/Anthropic, DeepSeek, or Local from one service/model/effort settings row.
- Code is the shared workspace-aware CLI entry. Its first setting chooses Codex, Claude Code API, or Claude Code Pro, then shows that backend's compact settings. Codex exposes model, effort, sandbox, work root, and thread controls. Claude Code exposes preset, effort, permission mode, and work root controls.
- Claude Code API uses the bridge's configured Anthropic or DeepSeek API credentials and may incur usage-based API charges. Claude Code Pro runs the same native Windows Claude Code executable, but the bridge removes API keys, provider base URLs, and Bedrock/Vertex/Foundry overrides from the child process. It therefore requires `claude auth login` with a Claude Pro or Max account. If that OAuth login is revoked, Mind Atlas opens one visible PowerShell login window, runs `claude auth login`, keeps the original run pending, and retries it once with the same workspace, model, permission, prompt, session, and evidence settings after login succeeds. Concurrent failures share the same login window. A cancelled or failed login, a second authentication rejection, or a run that already produced assistant output or file changes fails explicitly instead of risking duplicate side effects. When Claude Code emits a machine-readable `rate_limit_event.utilization`, Mind Atlas journals and shows that reported subscription/SDK allowance; before such an event it honestly shows unavailable. It does not infer a value or merge that allowance with context-window usage.
- A user request is saved as a child notebook node first. The provider result is saved as a child of that request.
- Codex, Claude Code, and OpenClaw requests are also written to a local durable run journal before execution. The browser acknowledges a journal entry only after the normal result or error has been stored. On startup, page resume, and a 60-second poll, an unacknowledged result is restored into its still-running request branch. If that branch no longer exists, the request and result are preserved in the AI Partner log with an unread notification. A bridge restart turns an unfinished journal entry into an explicit interrupted result instead of leaving an indefinite running node. Verify this contract with `npm run verify:agent-recovery`.
- From the root surface, Chat requests are written to the AI Partner log instead of creating notebook nodes. With an active node, Chat creates the same request/result child branch as before.
- OpenAI Chat uses the Responses API by default and passes supported `reasoning.effort` values when selected.
- OpenAI image-generation prompts in Chat are routed through the Image API and saved as image attachments on the result node.
- Opus/Anthropic and DeepSeek Chat use the Anthropic Messages shape through the bridge, including client-side Mind Atlas tool calls routed back through the browser.
- Local Chat uses an OpenAI-compatible `/chat/completions` endpoint such as LM Studio and the model currently loaded there.
- Codex under Code mode runs `codex exec --json` in `workspace-write` sandbox by default. The user-facing answer becomes `Codex final`; run metadata, command logs, and changed-file details are collected into one sibling `Codex details` node.
- Code mode exposes editable Codex and Claude Code session ID fields. Pasting the session id copied from Codex's navigator, or obtained by asking Claude Code in natural language, writes it to the selected node and feeds the existing resume/fork policy on the next run; clearing it selects a new session. Claude API and Claude Pro remain separate authentication routes, so switching between them intentionally starts a fresh session.
- Agent completion notifications never replace a Code prompt or settings draft that is being edited. The completed run and notification remain durable, and the Agent runs launcher can open the result afterward. A work-root binding is inherited from the nearest explicit ancestor binding across Codex, Claude Code API, and Claude Code Pro. Editing the visible path marks the current node as needing a rebind; pressing Bind records that path as the new inheritance point for descendants without their own binding.
- OpenClaw mode reads available configured models from `openclaw models list --json` and runs `openclaw agent --local --json --thinking off --model <selected-model>` through the bridge. Mind Atlas does not pass a work root, so OpenClaw uses its configured workspace behavior. From the root surface, OpenClaw replies are written to the AI Partner log and raise an unread notification instead of creating notebook nodes. With a non-root node selected, the result is saved as a child notebook node, and the OpenClaw session key plus run log path are stored on the request/result branch.
- OpenClaw `Session: auto` resumes an OpenClaw session key found on the active node path. `Session: new` starts a fresh key for that request.
- Claude Code mode pipes the Mind Atlas prompt/context into `claude -p --output-format json` through the bridge. The bridge injects the selected preset, model, base URL, and provider-appropriate auth variables into that child process, saves stdout/stderr/metadata under `server-data/claude-runs`, and stores the log path on the request/result branch.
- Claude Code API settings include presets for Bridge env, Claude Opus 4.8, Claude Fable 5, and DeepSeek V4 Pro. Claude Code Pro instead exposes Claude account default, Opus, Fable, and Sonnet aliases and passes the selected alias through `--model`. Switching between API and Pro forces a fresh agent session so a session created under one billing route is not resumed under the other. Direct model and base URL text fields are intentionally hidden; use bridge environment variables or presets. Claude Code permission mode is not equivalent to Codex OS sandboxing.
- Command failures inside a normal Codex run are treated as ordinary diagnostic detail, not Mind Atlas error nodes. Error pulses are reserved for Codex invocation failures or explicit approval/error nodes.
- Codex web search is enabled automatically and fixed to live mode for both
  app-server and exec fallback runs, including resumed sessions. The command
  dock does not show a web-search toggle.
- Claude Code API and Claude Code Pro always receive the read-only `WebSearch`
  and `WebFetch` tools through `--allowedTools`. This is independent of the
  Permission selector and Claude in Chrome: file/shell permissions still follow
  the selected permission mode, while Chrome control remains a separate
  capability-gated per-run option.
- The bridge decides `--skip-git-repo-check` automatically before each Codex run. If `git rev-parse --is-inside-work-tree` succeeds in the work root, the flag is not used. If the work root is not a Git repository or Git cannot inspect it, the flag is used.
- If Codex appears blocked by permissions, Mind Atlas creates a pulsing approval request node. Its child option nodes have centered buttons for approving or denying a retry with `danger-full-access`.
- Work roots can be selected in the Codex settings row. If left blank, the bridge can infer a work root from context text such as `workspace: c:\path\to\repo` or `作業ルート: c:\path\to\repo`.
- The Code work root is shared by Codex and Claude Code. If its input is cleared while the selected Atlas branch still has a saved repository binding, `Restore bound work root` restores the path in one click and reruns repository verification before showing `Bound`.
- Running, review, and error states pulse around the affected notebook node.
- Completed or failed background work emits a wider notification pulse from the result location.
- Usage metadata is stored on runs and result nodes. Cost estimates appear only when per-token rates are configured.
- `GET /api/provider-usage` returns the normalized provider metrics used by the command dock. Add `?refresh=1` to bypass the 45-second bridge cache.
- When an upstream response appears to hit the configured bridge output cap, Mind Atlas appends a bridge note to the result body and includes `maxOutputTokens`, `finishReason`, and `outputLimitHit` in usage metadata.
- Short-clicking the microphone button records dictation, transcribes it with `gpt-4o-transcribe`, and inserts the transcript into the prompt field.
- Long-pressing the microphone button starts a push-to-talk WebRTC Realtime Voice Partner session through the bridge. The browser receives only a short-lived ephemeral Realtime key.
- While Voice Partner audio is responding, the microphone button becomes a square stop button that cancels the current Realtime response and clears pending playback.
- The main menu can restart Realtime to reset voice context. Manual restart also clears the saved voice-session summary so the next session starts fresh.
- The main menu has Voice settings for the Realtime model id and voice id. Saving applies to the next session; saving and restarting applies immediately.
- Mobile notifications can be enabled from the main menu on mobile-like devices. Notification sound, banner display, and vibration are controlled by browser and OS settings, and some mobile browsers only allow notifications for installed web apps.
- Voice Partner sessions stay warm for one hour after the last interaction. Before idle shutdown, Mind Atlas asks the session for a compact summary and stores it for the next session.
- Voice Partner conversation logs are global text logs, not notebook nodes. Open `Voice log` from the main menu to review or clear them.
- The Voice Partner receives guarded Mind Atlas tools for search, focus, selection, node creation/editing, undo/redo, AI dispatch, notifications, and web search. Destructive operations, bulk edits, notebook import, Codex full-access retry requests, and any browser/OS file-picker action return an approval-required result instead of executing directly. These requests are visible in the AI Partner log with their arguments and remain unexecuted until a human uses the UI deliberately.
- Voice Partner web search is exposed through the bridge and uses the OpenAI Responses API web-search tool server-side. The bridge returns response text, citations, deduplicated sources, and normalized usage metadata when upstream provides it.
- The main menu can save rich `.mindatlaspkg` packages to the bridge server folder and load them back from a server-side package list. This is a prototype shared-data feature and does not include user accounts or access control.

## Rollback

Before this implementation, `backup/pre-ai-integration-20260510` was created at `130e36920bfbe8bfe37a0ab80e395c74c1fff7e4`.
