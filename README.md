# Mind Atlas

Mind Atlas is a local 2.5D spatial notebook.

Each celestial object is one editable notebook node. Hold on empty space to birth a planet, drag a planet to move it, and pull it far or fast enough to tear off a child moon. The focus panel edits the selected node text, tags, attachments, and surface style.

Planet color and texture presets live in `src/config/planetTheme.ts`.

## Requirements

- Node.js
- npm

This project is built with Vite, React, and Three.js.

## Install

```powershell
npm install
```

## Start Development Server

```powershell
npm run dev
```

Then open the local URL shown in the terminal.

Usually:

```text
http://localhost:5173/
```

If you want to bind explicitly to localhost:

```powershell
npm run dev -- --host 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5173/
```

## Build

```powershell
npm run build
```

The production files are generated in `dist/`.

## Preview Production Build

```powershell
npm run preview
```

## Type Check

```powershell
npm run typecheck
```

## UI Smoke Test

Start the dev server first:

```powershell
npm run dev -- --host 127.0.0.1
```

In another terminal, run:

```powershell
npm run verify:ui
```

The script checks desktop, mobile portrait, and mobile landscape rendering. Screenshots are saved under `artifacts/screenshots/`.

## Notes

- Notebook data is saved in browser local storage.
- Export and import use a single JSON file.
- Attached file blobs are not exported. Only attachment metadata such as file name, MIME type, size, and path-like name is saved.
- Image, audio, and video previews work for files selected in the current browser session.
