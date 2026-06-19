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
- `MIND_ATLAS_REALTIME_MODEL`: default Realtime model. Defaults to `gpt-realtime-2`.
- `MIND_ATLAS_REALTIME_VOICE`: default voice.
- `MIND_ATLAS_REALTIME_REASONING_EFFORT`: Realtime 2 reasoning effort (`default`, `low`, `medium`, or `high`). Defaults to `low` and is only sent for `gpt-realtime-2` style models.
- `MIND_ATLAS_REALTIME_TRANSCRIPTION_MODEL`: Realtime session input transcription model. Defaults to `gpt-4o-transcribe`.
- `MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS`: Voice Partner idle timeout for `npm run dev:all` and docs. Defaults to one hour.
- `VITE_MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS`: browser-side Voice Partner idle timeout. Defaults to one hour; set a short value in local verification to exercise idle summary shutdown.
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

- The command dock supports Chat, Code, OpenClaw, and Note modes.
- Chat is the shared non-agent conversation entry. It can target OpenAI, Opus/Anthropic, DeepSeek, or Local from one service/model/effort settings row.
- Code is the shared workspace-aware CLI entry. Its first setting chooses Codex or Claude Code, then shows that backend's compact settings. Codex exposes model, effort, sandbox, work root, and thread controls. Claude Code exposes preset, effort, permission mode, and work root controls.
- A user request is saved as a child notebook node first. The provider result is saved as a child of that request.
- From the root surface, Chat requests are written to the AI Partner log instead of creating notebook nodes. With an active node, Chat creates the same request/result child branch as before.
- OpenAI Chat uses the Responses API by default and passes supported `reasoning.effort` values when selected.
- OpenAI image-generation prompts in Chat are routed through the Image API and saved as image attachments on the result node.
- Opus/Anthropic and DeepSeek Chat use the Anthropic Messages shape through the bridge, including client-side Mind Atlas tool calls routed back through the browser.
- Local Chat uses an OpenAI-compatible `/chat/completions` endpoint such as LM Studio and the model currently loaded there.
- Codex under Code mode runs `codex exec --json` in `workspace-write` sandbox by default. The user-facing answer becomes `Codex final`; run metadata, command logs, and changed-file details are collected into one sibling `Codex details` node.
- OpenClaw mode runs `openclaw agent --local --json --thinking off` through the bridge. The result is saved as a child notebook node, and the OpenClaw session key plus run log path are stored on the request/result branch.
- OpenClaw `Session: auto` resumes an OpenClaw session key found on the active node path. `Session: new` starts a fresh key for that request.
- Claude Code mode pipes the Mind Atlas prompt/context into `claude -p --output-format json` through the bridge. The bridge injects the selected preset, model, base URL, and provider-appropriate auth variables into that child process, saves stdout/stderr/metadata under `server-data/claude-runs`, and stores the log path on the request/result branch.
- The Claude Code settings include presets for Bridge env, Claude Opus 4.8, Claude Fable 5, and DeepSeek V4 Pro, plus `--effort` and `--permission-mode`. Anthropic presets explicitly route to `https://api.anthropic.com`; the DeepSeek preset routes to `https://api.deepseek.com/anthropic`. Direct model and base URL text fields are intentionally hidden; use bridge environment variables or presets. Claude Code permission mode is not equivalent to Codex OS sandboxing.
- Command failures inside a normal Codex run are treated as ordinary diagnostic detail, not Mind Atlas error nodes. Error pulses are reserved for Codex invocation failures or explicit approval/error nodes.
- Codex web search is enabled automatically. The command dock does not show a web-search toggle.
- The bridge decides `--skip-git-repo-check` automatically before each Codex run. If `git rev-parse --is-inside-work-tree` succeeds in the work root, the flag is not used. If the work root is not a Git repository or Git cannot inspect it, the flag is used.
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
- The Voice Partner receives guarded Mind Atlas tools for search, focus, selection, node creation/editing, undo/redo, AI dispatch, notifications, and web search. Destructive operations, bulk edits, notebook import, Codex full-access retry requests, and any browser/OS file-picker action return an approval-required result instead of executing directly. These requests are visible in the AI Partner log with their arguments and remain unexecuted until a human uses the UI deliberately.
- Voice Partner web search is exposed through the bridge and uses the OpenAI Responses API web-search tool server-side. The bridge returns response text, citations, deduplicated sources, and normalized usage metadata when upstream provides it.
- The main menu can save rich `.mindatlaspkg` packages to the bridge server folder and load them back from a server-side package list. This is a prototype shared-data feature and does not include user accounts or access control.

## Rollback

Before this implementation, `backup/pre-ai-integration-20260510` was created at `130e36920bfbe8bfe37a0ab80e395c74c1fff7e4`.
