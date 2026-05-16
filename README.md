# Mind Atlas

![Mind Atlas spatial interface concept](docs/images/mindatlas1.png)

Mind Atlas is a 2.5D spatial notebook for navigating parallel AI-assisted work.

Instead of treating prompts, artifacts, and project states as a flat list of chats or files, Mind Atlas places them in a fixed-orientation semantic space. Each celestial object is an editable notebook node. The user can pan, zoom, focus, inspect attachments, and re-enter a work stream from the same spatial context.

Public site: https://mind-atlas.org

Current version: `0.1.1`

## What This Prototype Does

- Renders a fixed-orientation 2.5D universe view with pan, zoom, focus, and semantic drill-down.
- Treats one celestial object as one local notebook/chat-bubble node.
- Lets the user edit the focused node body in the Focus panel and directly on visible node labels.
- Supports mouse-first creation of child nodes and sibling branch nodes.
- Stores notebook data in browser local storage.
- Exports and imports a single `.mindatlas` JSON file.
- Initializes the local notebook back to the seeded starting state.
- Attaches image, audio, video, or file metadata to a node.
- Previews selected image/audio/video files during the current browser session.
- Extracts shared `#tags` from notebook text for later resonance behavior.
- Provides appearance controls for planet color and texture.
- Sends the focused node context to a local AI bridge and saves each user request plus provider result as child celestial nodes.
- Supports OpenAI, LM Studio/OpenAI-compatible local models, and Codex CLI execution through the local bridge.
- Emits wider notification pulses when AI work completes or fails away from the user's current focus.
- Starts a Realtime voice session from the focused node without exposing the standard provider API key to the browser.

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

Open:

```text
http://127.0.0.1:5173/
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

To test from another device on the same LAN:

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

- Notebook data is saved in browser local storage.
- Export and import use a single `.mindatlas` JSON file.
- Attached file blobs are not exported.
- Attachment metadata such as file name, MIME type, size, and path-like name is saved.
- Image, audio, and video previews work only for files selected in the current browser session.
- Provider API keys belong in the local bridge process, not in browser local storage.

See [docs/ai-bridge.md](docs/ai-bridge.md) for AI bridge setup and Realtime notes.

## Repository Contents

The public repository should include source, configuration, documentation, and the GitHub Pages workflow. It should not include dependency folders, generated builds, logs, or verification screenshots.

See the upload list at the end of this preparation pass for the exact file set.

## License

MIT License. See [LICENSE](./LICENSE).
