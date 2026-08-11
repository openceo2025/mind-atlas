# Local Agent Mothership - Phase 0 Proof Of Concept Results

Status: machine-verified evidence

Recorded: 2026-07-28

Machine: Windows 11 Pro 10.0.26200, Node v24.16.0

This document records what was actually observed on this machine. Nothing here
is copied from provider documentation. `docs/local-agent-mothership-plan.md`
Section 24 must be read together with this file: any capability marked
`pending` in the plan is only implementable if it appears as `PASS` here.

## 1. Installed Runtimes

| Runtime | Version | Path |
| --- | --- | --- |
| Codex CLI | `0.145.0-alpha.18` | `%USERPROFILE%\.vscode\extensions\openai.chatgpt-26.715.31925-win32-x64\bin\windows-x86_64\codex.exe` |
| Claude Code | `2.1.178` | `%LOCALAPPDATA%\Microsoft\WinGet\Links\claude.exe` |

`codex` is not on `PATH`; it is only reachable through the VS Code ChatGPT
extension bundle. The bridge already discovers this path through
`findVsCodeCodexBin()`, and the agent runtime reuses the same resolution.

Claude Code auth status on this machine:

```json
{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro" }
```

## 2. Codex App Server

Schemas were generated from the installed binary with
`codex app-server generate-ts`. The generated protocol is authoritative and is
snapshotted for the adapter under `scripts/agent-runtime/codex-protocol.mjs`
as a small normalized subset, not a full hand-maintained copy.

### 2.1 Verified results

| Capability | Result | Evidence |
| --- | --- | --- |
| Runtime starts over stdio | PASS | `initialize` returned `userAgent mind_atlas_poc/0.145.0-alpha.18`, `codexHome C:\Users\satof\.codex`, `platformOs windows` |
| Dynamic model discovery | PASS | `model/list` returned 7 models; default `gpt-5.6-sol`, `modelContextWindow 258400` |
| Dynamic reasoning effort | PASS | Each model carries `supportedReasoningEfforts` with descriptions and a `defaultReasoningEffort` |
| Permission profile discovery | PASS | `permissionProfile/list` returned `:read-only`, `:workspace`, `:danger-full-access` |
| Skill discovery | PASS | `skills/list` returned a `data` array |
| Thread start | PASS | `thread/start` returned thread id, session id, rollout path, `cliVersion` |
| Live answer streaming | PASS | `item/agentMessage/delta` observed |
| Item timeline | PASS | `item/started` / `item/completed` observed for `agentMessage`, `commandExecution`, `contextCompaction` |
| Command execution detail | PASS | `commandExecution` item carried `command`, `exitCode 0`, `aggregatedOutput`, `status completed` |
| Actual context usage | PASS | `thread/tokenUsage/updated` returned `total`/`last` breakdowns plus `modelContextWindow: 258400` |
| Resume | PASS | `thread/resume` then `turn/start` recalled the first turn's token |
| Fork | PASS | `thread/fork` returned a new thread id with `forkedFromId` set |
| Steer | PASS | `turn/steer` accepted with `expectedTurnId` during an active turn |
| Interrupt | PASS | `turn/interrupt` produced `turn/completed` with `status: "interrupted"` |
| Thread read (reconciliation) | PASS | `thread/read` with `includeTurns` returned 3 turns and `status.type: "idle"` |
| Approval round trip | PASS | see 2.2 |
| Typed local image input | PASS | see 2.3 |
| Compaction | PASS | `thread/compact/start` produced an `item/completed` with item type `contextCompaction` |

### 2.2 Approval round trip

`thread/start` with `sandbox: "read-only"` and `approvalPolicy: "untrusted"`
does **not** produce an approval for ordinary commands - `echo` and
`git status --short` both ran without escalation. A write attempt inside a
read-only sandbox does escalate. Two server-initiated requests were observed:

```text
item/fileChange/requestApproval        { threadId, turnId, itemId, startedAtMs, reason, grantRoot }
item/commandExecution/requestApproval  { threadId, turnId, itemId, startedAtMs, environmentId,
                                         command, cwd, commandActions, proposedExecpolicyAmendment }
```

Important correction discovered here: the v2 response enums are **not**
`"approved"`. The generated schema defines

- `CommandExecutionApprovalDecision = "accept" | "acceptForSession" | { acceptWithExecpolicyAmendment } | { applyNetworkPolicyAmendment } | "decline" | "cancel"`
- `FileChangeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel"`

The PoC replied `"approved"`, and the file was never written, confirming that
an invalid decision is treated as non-approval. The adapter therefore sends
`accept` / `decline` and never invents `acceptForSession` unless the caller
chose it.

### 2.3 Typed image input

`turn/start` with `input: [{ type: "localImage", path: "<abs path>" }, { type: "text", ... }]`
returned an accurate description of `public/og-image.png`
("Mind Atlas promotional graphic featuring a stylized orbiting planet and
tagline"). Local image transport is real, not filename-only.

### 2.4 Protocol facts the adapter must respect

- `turn/completed` carries `turn.items` as an **empty array** on this version.
  The authoritative final message must be collected from `item/completed`
  notifications with `item.type === "agentMessage"`, not from `turn/completed`.
- `item/commandExecution/outputDelta` was not emitted for short commands; the
  complete output arrived on the `item/completed` item as `aggregatedOutput`.
  The adapter handles both.
- Threads created by an external app-server client are recorded with
  `source: "vscode"` when the process environment looks like a VS Code session.
- Notification methods observed in the PoC runs:
  `thread/started`, `thread/status/changed`, `thread/goal/cleared`,
  `thread/tokenUsage/updated`, `turn/started`, `turn/completed`,
  `item/started`, `item/completed`, `item/agentMessage/delta`,
  `mcpServer/startupStatus/updated`, `account/rateLimits/updated`,
  `remoteControl/status/changed`.

### 2.5 Codex native handoff

| Path | Result |
| --- | --- |
| `codex://threads/<id>` deep link | **FAIL - disabled.** `HKCU\SOFTWARE\Classes\codex` declares `URL Protocol` but has no `shell\open\command`. No application on this machine handles `codex://`. |
| Codex desktop app | Not installed. `codex app` exists and would run the installer. |
| `codex resume <thread-id>` in a terminal | **PASS - true same-thread continuity.** |

The decisive test: the thread `019fa8cb-2380-7d90-a71a-071c4f8ee8c6` created by
the Mind Atlas PoC app-server client was continued by the native CLI with

```powershell
codex exec --sandbox read-only resume 019fa8cb-2380-7d90-a71a-071c4f8ee8c6 "What exact token did you reply with in the first turn?"
```

Codex printed `session id: 019fa8cb-2380-7d90-a71a-071c4f8ee8c6` and answered
`MIND_ATLAS_POC_OK`, proving full history recall in the same session.

Conclusion: Mind Atlas offers Codex handoff as an interactive
`codex resume <thread-id>` terminal launched in the run's workspace. The
`codex://` deep link is implemented but stays disabled until a handler is
registered, and it is never labelled as continuity without that handler.

## 3. Claude Code Stream

Command used (subscription route, provider env stripped exactly like
`buildClaudeEnv({ authMode: "subscription" })`):

```powershell
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio
```

### 3.1 Verified results

| Capability | Result | Evidence |
| --- | --- | --- |
| Streaming run | PASS | exit 0, 13 events for a one-line answer |
| Partial message deltas | PASS | `stream_event` wrapping `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` |
| Session id | PASS | `system/init.session_id`, repeated on `result` |
| Runtime capability discovery | PASS | `system/init` carries `tools` (32), `mcp_servers`, `slash_commands`, `skills`, `agents`, `model`, `permissionMode`, `apiKeySource`, `claude_code_version`, `memory_paths`, `output_style` |
| Tool timeline | PASS | `assistant` message with `tool_use` (`Bash`), then `user` message with `tool_result` |
| Usage and cost | PASS | `result.usage` (input/cache_creation/cache_read/output, `service_tier`) and `result.total_cost_usd` |
| Actual context maximum | PASS | `result.modelUsage["claude-sonnet-4-6"].contextWindow = 200000`, `maxOutputTokens = 32000` |
| Account/plan usage | PASS | `rate_limit_event.rate_limit_info` with `status`, `rateLimitType: "five_hour"`, `resetsAt`, `overageStatus` |
| Thinking token estimate | PASS | `system/thinking_tokens` with `estimated_tokens` / `estimated_tokens_delta` |
| Turn summary | PASS | `system/post_turn_summary` with `status_category`, `status_detail`, `needs_action` |
| Permission bridge | PASS | `control_request` / `control_response` over stdio; the Mind Atlas adapter keeps the channel open while an approval is pending |
| Resume + fork | PASS | `--resume <id> --fork-session` recalled `MIND_ATLAS_CLAUDE_POC_OK` and produced a **new** session id |
| Stop | PARTIAL | see 3.2 |

Full observed event shape list:

```text
system/init            system/status              system/thinking_tokens
system/post_turn_summary
assistant              user
stream_event/message_start        stream_event/content_block_start
stream_event/content_block_delta  stream_event/content_block_stop
stream_event/message_delta        stream_event/message_stop
rate_limit_event       result/success
```

### 3.2 Stop behaviour

Killing the child mid-run (`SIGINT` then terminate) ends the process with
`exitCode null` and **no `result` event**. 34 events and one complete assistant
message had already been streamed.

Consequence for the implementation: the runtime must journal streamed partial
output continuously and synthesize its own terminal `interrupted` event when
the process dies without a `result` line. It must not wait for a final result
that will never arrive, and it must record the run as `interrupted`, not
`failed`.

### 3.3 Claude native handoff

`system/init.slash_commands` on Claude Code `2.1.178` is:

```text
mind-atlas-service-report, design-sync, update-config, verify, debug,
code-review, simplify, batch, fewer-permission-prompts, loop, schedule,
claude-api, run, run-skill-generator, clear, compact, context, heapdump,
init, reload-skills, review, security-review, usage-credits, extra-usage,
usage, insights, goal, team-onboarding
```

`desktop` is **not present**. Claude Desktop itself is installed
(`HKCU\SOFTWARE\Classes\claude\shell\open\command` points at
`Claude_1.24012.9.0`), but the installed Claude Code build does not advertise
a `/desktop` command.

Conclusion: Mind Atlas must **not** claim same-session Claude Desktop
continuity. The implemented Claude handoff is an interactive terminal opened in
the run workspace running `claude --resume <session-id>`, which is genuine
same-session continuity inside the CLI. The `/desktop` step is offered only as
an optional extra line of guidance, described as "if your Claude Code build
provides it", and the capability flag `nativeDesktopHandoff` stays `false`
because the probe did not find the command.

API and DeepSeek routes never advertise Desktop continuity at all; they receive
the prepared handoff package.

### 3.4 Mind Atlas approval bridge update (2026-08-11)

The earlier print-mode observation predates the stdio permission bridge. The
installed Claude Code build was probed with
`--input-format stream-json --permission-prompt-tool stdio` and emitted a
`control_request` frame with subtype `can_use_tool`, tool name, input, and a
request id. The adapter now keeps stdin open, converts that frame into the
provider-neutral `approval_requested` event, and sends `control_response` with
the original input for Allow or a user-facing denial message for Deny.

`npm run verify:agent-runtime` covers both allow/resume and deny/resume fake
provider round trips, durable journal events, and export preservation of the
pending approval action. The live probe established the installed protocol
shape; it did not use a real provider write as a routine gate.

On the Atlas side, the approval event creates a notification-bearing
`approval_request` child node. Its node action sends the answer immediately;
the same node is retained and its body records the user's outcome and the
provider decision. Hidden Agent Run listeners keep this path active after the
supervision panel is closed.

## 4. Capability Matrix After Phase 0

| Capability | Codex App Server | Codex exec | Claude subscription stream | Claude API stream | Claude DeepSeek stream |
| --- | --- | --- | --- | --- | --- |
| Runtime starts | PASS | current baseline | PASS | inherits stream path, untested credentials | inherits stream path, untested credentials |
| Dynamic models | PASS (`model/list`) | partial (`codex debug models`) | PASS (`system/init.model`) | same | same |
| Dynamic effort | PASS | partial | env/flag driven | same | same |
| Live text | PASS | coarse | PASS | PASS | PASS |
| Tool timeline | PASS | coarse | PASS | PASS | PASS |
| Diff stream | `turn/diff/updated` available in schema, not exercised | coarse | derived from Edit/Write tool events | same | same |
| Approval round trip | PASS | PASS through `--permission-prompt-tool stdio`; fake-provider regression covers allow and resume | same adapter path; live provider not re-run | same adapter path; live provider not re-run |
| User question | schema present (`item/tool/requestUserInput`), not triggered | no | not observed in print mode | same | same |
| Stop | PASS (`turn/interrupt`) | process fallback | PARTIAL (signal, no result event) | same | same |
| Steer | PASS (`turn/steer`) | no | not available in print mode | no | no |
| Resume | PASS | current | PASS | PASS | PASS |
| Fork | PASS | policy fallback | PASS (`--fork-session`) | PASS | PASS |
| Actual context usage | PASS | limited | PASS (`modelUsage.contextWindow` + `usage`) | PASS | PASS |
| Typed image | PASS (`localImage`) | `-i` flag | not verified | not verified | not verified |
| PDF | not verified | not verified | not verified | not verified | not verified |
| Browser | not present in this app-server session | no | not probed | no | no |
| Same-session native handoff | PASS via `codex resume` terminal; deep link FAIL | PASS via `codex resume` | PASS via `claude --resume` terminal; `/desktop` FAIL | no | no |

## 4.1 Integrated Runtime Results

These were run after implementation, through the real Mind Atlas bridge rather
than a standalone script.

| Check | Result |
| --- | --- |
| Codex run start, SSE stream, durable replay from sequence 0, ACK | PASS |
| Claude run start, SSE stream, durable replay, ACK | PASS |
| `/api/ai/respond` with `useAgentRuntime` returns the legacy shape | PASS - `agentRuntimeRunId` exposed, answer preserved, legacy journal entry still created |
| Live supervision by client run id while `/api/ai/respond` is pending | PASS - 8 (Codex) / 10 (Claude) events observed before the HTTP response |
| Approval round trip through the bridge HTTP surface | PASS - `item/fileChange/requestApproval` surfaced with provider choices `accept / acceptForSession / decline`; answering `accept` caused Codex to actually write the probe file |
| `turn/steer` then `turn/interrupt` through the bridge | PASS - terminal status `interrupted`, not `failed` |
| Handoff plan and ownership transfer | PASS - `same_session_cli`, `codex resume <thread-id>`, `deepLinkAvailable: false`, ownership `transferring` |
| Reclaim and reconciliation | PASS - ownership returns to `mind_atlas`, Codex thread read read-only (`turns: 1`, `idle`), Git before/after compared |
| Typed image evidence to Codex | PASS - reported `attached` via `localImage`; the model described `public/og-image.png` |
| Evidence transport honesty for Claude | PASS - reported `referenced` / `pathReference`, never `attached` |
| Browser capability probe | PASS - the installed Claude Code build exposes `--chrome`, so the subscription route reports `browser: true`; the API route reports `false` with the direct-plan reason; Codex reports `false` with the no-browser-tool reason |
| File change and aggregate diff | PASS - a real one-line Codex edit produced a `file_change` event (`kind: "update"`, `+1 / -1`), a `turn/diff/updated` unified diff, and a populated `changedFiles` list on the final record |
| `codex exec` fallback through the runtime | PASS - with `MIND_ATLAS_CODEX_RUNTIME=exec` the run reported route `codex-exec`, still streamed lifecycle events, returned the correct answer and thread id, and passed the legacy result through unchanged |
| Atlas MCP server over real stdio JSON-RPC | PASS - `initialize`, `tools/list` (6 read-only tools), Japanese exact search hit, `get_node`, honest `scoringMode: "lexical+ngram"` with `degraded: true`, and `delete_node` refused as unknown |
| Workspace policy against the real repository layout | PASS - 11/11 cases: `open_rogue`, `qolony`, `ステイルメイト`, `mind_atlas` allowed; home directory, `.codex`, `.claude`, `%SystemRoot%`, `%ProgramFiles%`, drive root, and a non-existent path refused |
| Two concurrent Codex runs in different repositories | PASS - both listed as active with their own workspace labels, both streamed independently, and each returned only its own answer |

### Known live environment issue

Claude Code `-p` child processes began failing with
`API Error: 401 OAuth access token has been revoked` late in the verification
session, while `claude auth status` still reported `loggedIn: true` with a Pro
subscription. Earlier Claude runs in the same session succeeded, so the code
path is proven; the credential went stale afterwards.

Mind Atlas handled this correctly: the run ended as `failed`, the provider error
was surfaced verbatim, the run was journaled, and nothing crashed.

Recovering it requires a human login, which Mind Atlas cannot and must not do
automatically:

```powershell
claude auth login
```

## 5. Decisions Forced By This Evidence

1. Codex App Server is the primary Codex route. `codex exec` stays as the
   fallback and is never removed in this migration.
2. The Codex final answer comes from `item/completed` agent messages.
3. Codex approvals use `accept` / `decline`.
4. `codex://` deep-link handoff is implemented but disabled by capability
   probe on this machine.
5. Claude stop synthesizes its own terminal event.
6. Claude `/desktop` is not advertised.
7. Provider context maximum comes from `thread/tokenUsage/updated.modelContextWindow`
   for Codex and `result.modelUsage[model].contextWindow` for Claude. Neither is
   ever derived from a character count.
8. Account/plan usage (Claude `rate_limit_event`, Codex
   `account/rateLimits/updated`) is a third, separate metric and is never mixed
   into the context indicator.

## 6. Reproducing These Checks

`npm run verify:agent-runtime` covers the parts that can run without a paid
provider call (event normalization, journal durability, redaction, ownership,
capability reduction) using fake provider processes.

The live checks in this document require the real runtimes and consume real
provider allowance. They are intentionally manual.

## 7. Phase 8 Integration (2026-07-29)

The owner reauthenticated Claude Code and manually confirmed two parallel runs
through the Agent Run Workspace. Phase 8 then added:

- explicit Atlas-branch-to-Git-repository binding before Code can send;
- stable source/worktree repository identity from `--git-common-dir`;
- immutable source checkout, execution directory, branch, HEAD, and dirty-state
  metadata on each run;
- isolated mission worktrees with follow-up reuse;
- explicit checkpoint, confirmed revert, and clean-worktree removal;
- persistent reopening through the Agent runs launcher, recent-run switcher,
  and result-node action;
- grouped Terminal and dedicated subagent views;
- a reusable Capabilities view and capability-gated Steer, Compact, and Claude
  in Chrome controls;
- durable Claude `rate_limit_event.utilization` capture, keeping subscription/
  SDK allowance separate from context usage;
- Selected and All provider usage views.

`npm run verify:agent-runtime` now exercises the full Git worktree lifecycle
against a temporary real repository, repository identity, terminal grouping,
subagent updates, allowance normalization, capability gating source guards,
local-only route guards, and persistent workspace reopening without making a
paid provider call.

Claude allowance remains data-driven: the usage bar is unavailable until a
subscription run emits a utilization event. No synthetic percentage is shown.
