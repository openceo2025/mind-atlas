# Mind Atlas AI Bridge

Mind Atlas keeps provider API keys out of the browser. The React app talks to a small local bridge, and the bridge talks to OpenAI or OpenAI-compatible providers.

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
- `MIND_ATLAS_OPENAI_INPUT_USD_PER_1M` / `MIND_ATLAS_OPENAI_OUTPUT_USD_PER_1M`: optional cost-rate inputs for UI estimates.
- `MIND_ATLAS_LOCAL_BASE_URL`: LM Studio or another OpenAI-compatible local endpoint. Defaults to `http://127.0.0.1:1234/v1`.
- `MIND_ATLAS_LOCAL_API_KEY`: optional local endpoint key. Defaults to `lm-studio`.
- `MIND_ATLAS_LOCAL_MAX_OUTPUT_TOKENS`: Local `/chat/completions` output cap. Defaults to `MIND_ATLAS_MAX_OUTPUT_TOKENS`.
- `MIND_ATLAS_WEB_SEARCH_MAX_OUTPUT_TOKENS`: web-search response cap. Defaults to `2048`.
- Local mode inspects `${MIND_ATLAS_LOCAL_BASE_URL}/models` and uses the first model currently loaded by LM Studio. `MIND_ATLAS_LOCAL_MODEL` is intentionally ignored to avoid auto-loading a model.
- `MIND_ATLAS_CODEX_BIN`: Codex executable name. Defaults to `codex`.
- `MIND_ATLAS_CODEX_USE_WSL`: set `true` to run `wsl codex ...`.
- `MIND_ATLAS_CODEX_WORKSPACE`: workspace passed to `codex exec --cd`.
- `MIND_ATLAS_CODEX_MODEL`: default Codex model. The UI also reads `codex debug models` through the bridge.
- `MIND_ATLAS_CODEX_REASONING_EFFORT`: default effort (`low`, `medium`, `high`, or `xhigh`).
- `MIND_ATLAS_CODEX_SANDBOX`: default sandbox. Use `workspace-write`; Full access normally requires an approval button in Mind Atlas.
- `MIND_ATLAS_CODEX_MODELS`: optional comma-separated model override when `codex debug models` is unavailable.
- `MIND_ATLAS_CODEX_TIMEOUT_MS`: Codex execution timeout in milliseconds. Defaults to 60 minutes.
- `MIND_ATLAS_OPENCLAW_BIN`: OpenClaw executable. Defaults to `openclaw`; on Windows the bridge also auto-detects the user npm OpenClaw entrypoint.
- `MIND_ATLAS_OPENCLAW_MODEL`: optional OpenClaw model override. Leave blank to use the OpenClaw default, such as the model already configured for LM Studio.
- `MIND_ATLAS_OPENCLAW_AGENT`: optional OpenClaw agent id. Leave blank to use the OpenClaw default agent.
- `MIND_ATLAS_OPENCLAW_WORKSPACE`: optional work root hint passed into the OpenClaw prompt. The bridge does not modify OpenClaw workspace configuration.
- `MIND_ATLAS_OPENCLAW_TIMEOUT_MS`: OpenClaw execution timeout in milliseconds. Defaults to 10 minutes.
- `MIND_ATLAS_CLAUDE_BIN`: Claude Code executable. Defaults to `claude`. On Windows, the WinGet link path is usually `C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\claude.exe`.
- `MIND_ATLAS_CLAUDE_MODEL`: default Claude Code model. The command dock can override this per run with presets for `claude-opus-4-8`, `claude-fable-5`, and `deepseek-v4-pro[1m]`.
- `MIND_ATLAS_CLAUDE_ANTHROPIC_BASE_URL`: optional `ANTHROPIC_BASE_URL` injected only into Claude Code child processes. Use `https://api.anthropic.com` for Anthropic, or `https://api.deepseek.com/anthropic` for DeepSeek.
- `MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY`: optional `ANTHROPIC_API_KEY` for Anthropic API billing in non-interactive Claude Code runs. Keep it on the bridge/server side, not in browser storage.
- `MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN`: optional DeepSeek API key sent as `ANTHROPIC_AUTH_TOKEN` only when the run targets `https://api.deepseek.com/anthropic`.
- `MIND_ATLAS_CLAUDE_ANTHROPIC_AUTH_TOKEN`: optional generic `ANTHROPIC_AUTH_TOKEN` for custom Anthropic-compatible gateways. Prefer `MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN` for DeepSeek when switching between Anthropic and DeepSeek presets.
- `MIND_ATLAS_CLAUDE_DEFAULT_FABLE_MODEL`, `MIND_ATLAS_CLAUDE_DEFAULT_OPUS_MODEL`, `MIND_ATLAS_CLAUDE_DEFAULT_SONNET_MODEL`, `MIND_ATLAS_CLAUDE_DEFAULT_HAIKU_MODEL`, `MIND_ATLAS_CLAUDE_SUBAGENT_MODEL`, `MIND_ATLAS_CLAUDE_EFFORT_LEVEL`: optional Claude Code env overrides. DeepSeek runs automatically fill the recommended V4 Pro / V4 Flash defaults when these are not set.
- `MIND_ATLAS_CLAUDE_WORKSPACE`: default work root for Claude Code runs.
- `MIND_ATLAS_CLAUDE_TIMEOUT_MS`: Claude Code execution timeout in milliseconds. Defaults to 60 minutes.

On Windows, Codex can occasionally fail before command execution with
`windows sandbox: spawn setup refresh`. When this exact sandbox initialization
error occurs, the bridge automatically retries the run without the broken OS
sandbox while preserving the requested `read-only` or `workspace-write` policy
in the Codex instructions. The Codex details node records this as
`Sandbox recovery`.
- `MIND_ATLAS_REALTIME_MODEL`: default Realtime model. Defaults to `gpt-realtime`.
- `MIND_ATLAS_REALTIME_VOICE`: default voice.
- `MIND_ATLAS_REALTIME_TRANSCRIPTION_MODEL`: Realtime session input transcription model. Defaults to `gpt-4o-transcribe`.
- `MIND_ATLAS_CLOUD_DIR`: server-side folder for `クラウドへ保存` / `クラウドから読み込み` notebook packages. Defaults to `server-data/notebooks`.
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

## Current AI Surface

- The command dock supports OpenAI, Local, Codex, OpenClaw, and Claude Code modes.
- A user request is saved as a child notebook node first. The provider result is saved as a child of that request.
- OpenAI uses the Responses API by default.
- OpenAI image-generation prompts are routed through the Image API and saved as image attachments on the result node.
- Local mode uses an OpenAI-compatible `/chat/completions` endpoint such as LM Studio.
- Codex mode runs `codex exec --json` in `workspace-write` sandbox by default. The user-facing answer becomes `Codex final`; run metadata, command logs, and changed-file details are collected into one sibling `Codex details` node.
- OpenClaw mode runs `openclaw agent --local --json --thinking off` through the bridge. The result is saved as a child notebook node, and the OpenClaw session key plus run log path are stored on the request/result branch.
- OpenClaw `Session: auto` resumes an OpenClaw session key found on the active node path. `Session: new` starts a fresh key for that request.
- Claude Code mode pipes the Mind Atlas prompt/context into `claude -p --output-format json` through the bridge. The bridge injects the selected model, base URL, and provider-appropriate auth variables into that child process, saves stdout/stderr/metadata under `server-data/claude-runs`, and stores the log path on the request/result branch.
- The Claude Code settings row includes presets for Bridge env, Claude Opus 4.8, Claude Fable 5, and DeepSeek V4 Pro. Anthropic presets explicitly route to `https://api.anthropic.com`; the DeepSeek preset routes to `https://api.deepseek.com/anthropic`.
- Command failures inside a normal Codex run are treated as ordinary diagnostic detail, not Mind Atlas error nodes. Error pulses are reserved for Codex invocation failures or explicit approval/error nodes.
- The Codex settings row has a `Skip Git` checkbox. It is off by default; when enabled, the bridge passes `--skip-git-repo-check` for first runs in a non-Git or not-yet-trusted work root.
- If Codex appears blocked by permissions, Mind Atlas creates a pulsing approval request node. Its child option nodes have centered buttons for approving or denying a retry with `danger-full-access`.
- Work roots can be selected in the Codex settings row. If left blank, the bridge can infer a work root from context text such as `workspace: c:\path\to\repo` or `作業ルート: c:\path\to\repo`.
- Running, review, and error states pulse around the affected notebook node.
- Completed or failed background work emits a wider notification pulse from the result location.
- Usage metadata is stored on runs and result nodes. Cost estimates appear only when per-token rates are configured.
- When an upstream response appears to hit the configured bridge output cap, Mind Atlas appends a bridge note to the result body and includes `maxOutputTokens`, `finishReason`, and `outputLimitHit` in usage metadata.
- Short-clicking the microphone button records dictation, transcribes it with `gpt-4o-transcribe`, and inserts the transcript into the prompt field.
- Long-pressing the microphone button starts a push-to-talk WebRTC Realtime Voice Partner session through the bridge. The browser receives only a short-lived ephemeral Realtime key.
- While Voice Partner audio is responding, the microphone button becomes a square stop button that cancels the current Realtime response and clears pending playback.
- The main menu can restart Realtime to reset voice context. Manual restart also clears the saved voice-session summary so the next session starts fresh.
- The main menu has Voice settings for the Realtime model id and voice id. Saving applies to the next session; saving and restarting applies immediately.
- Mobile notifications can be enabled from the main menu on mobile-like devices. Notification sound, banner display, and vibration are controlled by browser and OS settings, and some mobile browsers only allow notifications for installed web apps.
- Voice Partner sessions stay warm for one hour after the last interaction. Before idle shutdown, Mind Atlas asks the session for a compact summary and stores it for the next session.
- Voice Partner conversation logs are global text logs, not notebook nodes. Open `Voice log` from the main menu to review or clear them.
- The Voice Partner receives guarded Mind Atlas tools for search, focus, selection, node creation/editing, undo/redo, AI dispatch, notifications, and web search. Destructive operations return an approval-required result instead of executing directly.
- Voice Partner web search is exposed through the bridge and uses the OpenAI Responses API web-search tool server-side.
- The main menu can save rich `.mindatlaspkg` packages to the bridge server folder and load them back from a server-side package list. This is a prototype shared-data feature and does not include user accounts or access control.

## Rollback

Before this implementation, `backup/pre-ai-integration-20260510` was created at `130e36920bfbe8bfe37a0ab80e395c74c1fff7e4`.
