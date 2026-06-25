# Mind Atlas

![Mind Atlas spatial interface concept](docs/images/mindatlas1.png)

Mind Atlas is a 2.5D spatial notebook for navigating parallel AI-assisted work.

Instead of treating prompts, artifacts, and project states as a flat list of chats or files, Mind Atlas places them in a fixed-orientation semantic space. Each visible object is an editable notebook node. The user can pan, zoom, focus, inspect attachments, and re-enter a work stream from the same spatial context.

Public site: https://mind-atlas.org

Current version: `0.1.1`

## What This Prototype Does

- Renders a fixed-orientation 2.5D universe view with pan, zoom, focus, and semantic drill-down.
- Treats one visible object as one local notebook/chat-bubble node.
- Lets the user edit the focused node body in the Focus panel and directly on visible node labels.
- Supports mouse-first creation of child nodes and sibling branch nodes.
- Stores notebook data in IndexedDB with retained local snapshots and restore history.
- Exports and imports a single `.mindatlas` JSON file.
- Initializes the local notebook back to the seeded starting state.
- Attaches image, audio, video, or file metadata to a node.
- Previews selected image/audio/video files during the current browser session.
- Extracts shared `#tags` from notebook text for later resonance behavior.
- Provides appearance controls for node color and texture.
- Sends the focused node context to a local AI bridge and saves each user request plus provider result as child notebook nodes.
- Saves OpenAI-generated images as attachments on the provider result node.
- Groups OpenAI, Opus/Anthropic, DeepSeek, and LM Studio/OpenAI-compatible local models under one Chat entry for non-agent conversation.
- Groups Codex CLI and Claude Code under one Code entry, while OpenClaw remains a separate model-selectable agent-style bridge mode.
- Shows selectable OpenAI Codex rate-limit windows and DeepSeek balance bars inside the AI command dock.
- Saves and loads rich `.mindatlaspkg` notebook packages through the local bridge's server-side notebook folder.
- Expands Codex runs into spatial child nodes for summaries, commands, changed files, approval prompts, and final output.
- Sends OpenClaw requests through the local bridge and stores the OpenClaw result, session key, and log path on the request branch.
- Sends Claude Code requests through the local bridge and stores the Claude Code result and log path on the request branch.
- Emits wider notification pulses when AI work completes or fails away from the user's current focus.
- Uses the microphone button for short-click dictation with `gpt-4o-transcribe`.
- Uses long-press push-to-talk for a Realtime Voice Partner that can inspect and operate the atlas through guarded tools.
- Shows a square stop button while Voice Partner audio is responding, so the current reply can be canceled before the next push-to-talk turn.
- Provides main-menu controls for Voice Partner restart, Realtime model/voice settings, and mobile-only notification alerts.
- Keeps Voice Partner conversation logs in a global text log view from the main menu.
- Defaults Voice Partner to `gpt-realtime-2`; set `MIND_ATLAS_REALTIME_MODEL` and `VITE_MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS` when testing another model or a shorter idle-summary cycle.

Embeddings, summarization automation, sync, and remote storage are intentionally out of scope for `0.1.x`.

![Mind Atlas turns scattered AI work into a navigable semantic space](docs/images/mindatlas2.png)

## Technology

- Vite
- React
- Three.js / React Three Fiber
- Zustand
- TypeScript

## Local Development

Install dependencies:

```powershell
npm install
```

Start the app and local AI bridge together:

```powershell
npm run dev:all
```

Open locally:

```text
http://127.0.0.1:5173/
```

`npm run dev:all` also publishes the dev app and bridge on the LAN. Open the LAN URL printed in the terminal from another device, for example:

```text
https://192.168.0.14:5173/
```

For mobile microphone access, `dev:all` starts the app and bridge over HTTPS by default and writes local development certificates into `.certs/`. Install `.certs/mind-atlas-dev-ca.crt` as a trusted CA on the mobile device, then open the printed LAN HTTPS URL.

On Android, copy `.certs/mind-atlas-dev-ca.crt` to the phone and install it from the system security settings as a CA certificate. The exact menu name depends on the device, but it is usually under `Settings > Security > Encryption & credentials > Install a certificate > CA certificate`. Restart the browser after installing it.

To temporarily go back to HTTP:

```powershell
$env:MIND_ATLAS_DEV_HTTPS="false"
npm run dev:all
```

Start only the development server:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173/
```

Or start the optional local AI bridge in a second terminal:

```powershell
$env:MIND_ATLAS_OPENAI_API_KEY="sk-..."
npm run dev:bridge
```

Without an API key, the bridge returns mock AI responses so the UI flow remains testable.

For Chat mode, the command dock can switch the service between OpenAI, Opus,
DeepSeek, and Local, then choose a model and any supported effort level. Chat
requests use the same Mind Atlas context and tool definitions as the previous
OpenAI/Local entry. With an active node, the reply is saved as a child request
branch. From the root surface, the request and reply go to the AI Partner log.

For OpenClaw mode, start the local bridge and use the OpenClaw settings row for
agent, session, and timeout controls. Mind Atlas does not override the OpenClaw
model or work root; it uses the defaults configured in OpenClaw. From the root
surface, OpenClaw replies are written to the AI Partner log. With a non-root
node selected, OpenClaw creates the same request/result branch as other
node-anchored AI runs.

For Code mode on Windows, choose either Codex or Claude Code from the Code
settings row. To use Claude Code, install Claude Code and point the bridge at
the Windows executable:

```powershell
npm run dev:bridge
```

Put local Claude values in `.env.local`, which is read by both `npm run
dev:bridge` and `npm run dev:all`:

```ini
MIND_ATLAS_CLAUDE_BIN=C:\Users\<you>\AppData\Local\Microsoft\WinGet\Links\claude.exe
MIND_ATLAS_CLAUDE_ANTHROPIC_API_KEY=sk-ant-...
MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN=sk-...
```

Anthropic does not expose the Claude Console organization-credit balance
through a public API, so Mind Atlas does not display or request a manually
entered Anthropic balance.

To start only Vite for LAN testing without the AI bridge:

```powershell
npm run dev -- --host 0.0.0.0
```

Then open the LAN URL shown by Vite, for example:

```text
http://192.168.0.14:5173/
```

## Build

```powershell
npm run build
```

The production app is generated in `dist/`.

Preview the production build:

```powershell
npm run preview
```

## Verification

Type check:

```powershell
npm run typecheck
```

UI smoke test:

```powershell
npm run dev -- --host 127.0.0.1
npm run verify:ui
```

The UI smoke test checks desktop, mobile portrait, and mobile landscape rendering. Generated screenshots are local artifacts and are not part of the public repository.

## GitHub Pages Deployment

This repository includes `.github/workflows/deploy-pages.yml`.

To publish with GitHub Pages:

1. Create the GitHub repository and push the source files.
2. In the repository settings, open `Settings > Pages`.
3. Set `Build and deployment` to `GitHub Actions`.
4. Push to the `main` branch, or run the workflow manually.
5. Configure DNS for `mind-atlas.org` at your domain provider.
6. In GitHub Pages custom domain settings, use:

```text
mind-atlas.org
```

The file `public/CNAME` is included so the built site keeps the custom domain when deployed.

Recommended DNS:

```text
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
CNAME www   <your-github-username>.github.io
```

Replace `<your-github-username>` with the GitHub account or organization that owns the repository.

## Data Notes

- Notebook data is saved in browser IndexedDB with retained local snapshots and a restore UI. The legacy `mind-atlas-notebook-v2` localStorage payload is still kept as a migration/recovery source.
- Light export and import use a single `.mindatlas` JSON file.
- Rich export and import use `.mindatlaspkg` packages and include available attachment blobs.
- Markdown (`.md`, `.markdown`), OPML (`.opml`), and FreeMind (`.mm`) files can be imported from the main menu or by drag and drop. The "Import text outline" action applies pasted Markdown to the active node by replacing its body, replacing its subtree, appending children, or previewing a node-by-node merge.
- `クラウドへ保存` writes the same rich package to the bridge server's notebook folder. `クラウドから読み込み` lists that folder and imports the selected package.
- Attachment metadata such as file name, MIME type, size, and path-like name is saved.
- Attachment blobs are included only when the current browser session still has access to them; otherwise metadata is kept.
- The default server-side notebook folder is `server-data/notebooks/`, or `MIND_ATLAS_CLOUD_DIR` when configured.
- Provider API keys belong in the local bridge process, not in browser local storage.

See [docs/ai-bridge.md](docs/ai-bridge.md) for AI bridge setup and Realtime notes.

## Repository Contents

The public repository should include source, configuration, documentation, and the GitHub Pages workflow. It should not include dependency folders, generated builds, logs, or verification screenshots.

See the upload list at the end of this preparation pass for the exact file set.

## License

MIT License. See [LICENSE](./LICENSE).
