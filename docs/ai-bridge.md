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
- `MIND_ATLAS_OPENAI_BASE_URL`: defaults to `https://api.openai.com/v1`.
- `MIND_ATLAS_OPENAI_MODE`: `responses` by default.
- `MIND_ATLAS_OPENAI_INPUT_USD_PER_1M` / `MIND_ATLAS_OPENAI_OUTPUT_USD_PER_1M`: optional cost-rate inputs for UI estimates.
- `MIND_ATLAS_LOCAL_BASE_URL`: LM Studio or another OpenAI-compatible local endpoint. Defaults to `http://127.0.0.1:1234/v1`.
- `MIND_ATLAS_LOCAL_MODEL`: local model id passed to the OpenAI-compatible endpoint.
- `MIND_ATLAS_LOCAL_API_KEY`: optional local endpoint key. Defaults to `lm-studio`.
- `MIND_ATLAS_CODEX_BIN`: Codex executable name. Defaults to `codex`.
- `MIND_ATLAS_CODEX_USE_WSL`: set `true` to run `wsl codex ...`.
- `MIND_ATLAS_CODEX_WORKSPACE`: workspace passed to `codex exec --cd`.
- `MIND_ATLAS_CODEX_TIMEOUT_MS`: Codex execution timeout.
- `MIND_ATLAS_REALTIME_MODEL`: default Realtime model.
- `MIND_ATLAS_REALTIME_VOICE`: default voice.
- `MIND_ATLAS_ALLOWED_ORIGIN`: browser origin allowed to call the bridge.
- `VITE_MIND_ATLAS_BRIDGE_URL`: bridge URL used by the React app.

## Current AI Surface

- The command dock supports OpenAI, Local, and Codex modes.
- A user request is saved as a child celestial node first. The provider result is saved as a child of that request.
- OpenAI uses the Responses API by default.
- Local mode uses an OpenAI-compatible `/chat/completions` endpoint such as LM Studio.
- Codex mode runs `codex exec` in read-only sandbox mode and stores the final output as a tool-result node.
- Running, review, and error states pulse around the affected celestial body.
- Completed or failed background work emits a wider notification pulse from the result location.
- Usage metadata is stored on runs and result nodes. Cost estimates appear only when per-token rates are configured.
- The microphone button starts a WebRTC Realtime session through the bridge. The bridge initializes the session with the selected node context and keeps the standard provider key server-side.

## Rollback

Before this implementation, `backup/pre-ai-integration-20260510` was created at `130e36920bfbe8bfe37a0ab80e395c74c1fff7e4`.
