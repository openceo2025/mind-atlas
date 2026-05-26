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

Copy `.env.example` values into your shell or deployment environment.

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
- `MIND_ATLAS_CODEX_SANDBOX`: default sandbox. Use `workspace-write`; Full access is only used after an approval button is clicked in Mind Atlas.
- `MIND_ATLAS_CODEX_MODELS`: optional comma-separated model override when `codex debug models` is unavailable.
- `MIND_ATLAS_CODEX_TIMEOUT_MS`: Codex execution timeout in milliseconds. Defaults to 60 minutes.
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

- The command dock supports OpenAI, Local, and Codex modes.
- A user request is saved as a child notebook node first. The provider result is saved as a child of that request.
- OpenAI uses the Responses API by default.
- OpenAI image-generation prompts are routed through the Image API and saved as image attachments on the result node.
- Local mode uses an OpenAI-compatible `/chat/completions` endpoint such as LM Studio.
- Codex mode runs `codex exec --json` in `workspace-write` sandbox by default. The user-facing answer becomes `Codex final`; run metadata, command logs, and changed-file details are collected into one sibling `Codex details` node.
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
