# Shogi Landing Page (`sites/shogi-landing`)

Source for the static landing page served at <https://mind-atlas.org/shogi/>.

This project previously lived outside the repository as a standalone
`mind_atlas_shogi_site` checkout with its own remote. It was merged into Mind
Atlas on 2026-08-19 so that the page source, the generated output, and the
service that serves it share one history.

## Shape

- `app/page.tsx` — the entire landing page (single route).
- `app/globals.css` — Tailwind entry. The export inlines the generated
  stylesheet as `styles.css`.
- `public/` — image assets referenced by the page.
- `scripts/export-conoha.mjs` — renders the route to a static `index.html` and
  `styles.css`, rewrites asset URLs onto the `/shogi` base, strips client
  scripts and preloads, adds the canonical link, and copies the assets listed
  in its `assets` array.
- `tests/rendered-html.test.mjs` — server-render smoke test.
- `worker/`, `db/`, `drizzle/`, `examples/`, `.openai/` — untouched
  `vinext-starter` template scaffolding. The landing page uses neither the
  database nor the worker bindings; the static export never runs them.

Node `>=22.13.0`. Dependencies install into `sites/shogi-landing/node_modules`.
The repository root does not use npm workspaces, so this folder is installed
separately (`npm install` from inside it).

## Commands

From the repository root:

```powershell
npm run site:shogi:dev      # local dev server
npm run site:shogi:build    # build only
npm run site:shogi:export   # build, then export to sites/shogi-landing/export-conoha
npm run site:shogi:publish  # build, then export into public/shogi (changes the live page)
```

`site:shogi:export` writes to a gitignored folder and never touches the
deployed page. Use it to inspect what the current source would produce.

## How the page reaches production

```
sites/shogi-landing --export--> public/shogi/ --npm run build--> dist/shogi/ --deploy--> https://mind-atlas.org/shogi/
```

`public/shogi/` is committed generated output. The VPS service serves `dist/`
(`MIND_ATLAS_DIST_DIR=dist`), and the root Vite build copies `public/` into
`dist/`, so whatever is committed under `public/shogi/` is what the site
serves.

## Current drift — read before publishing

As of 2026-08-19 the deployed page is **not** the output of this source at
HEAD. The live URL was fetched and compared: it is byte-identical to the
committed `public/shogi/index.html`, and both differ from a fresh export.

| | deployed (`public/shogi/`) | fresh export from this source |
| --- | --- | --- |
| guide/board images | hand-made `*.webp` derivatives | `*.png` originals |
| walkthrough images | none | three `kif-*-guide.png` |
| hero and header copy | 2026-08-16 wording | revised 2026-08-17 wording |
| referenced image bytes | 1.67 MB (315 KB inline + `og.png`) | 6.9 MB (6.2 MB inline + `og.png`) |

Roughly 100 lines of markup differ. `npm run site:shogi:publish` replaces the
reviewed live page with that newer draft and deletes the `*.webp` files (see
`staleFiles` in `scripts/export-conoha.mjs`). Review an export before
committing one:

```powershell
npm run site:shogi:export
```

Then compare `sites/shogi-landing/export-conoha/index.html` against
`public/shogi/index.html`.

## Rule for future changes

Commit the source change and the regenerated `public/shogi/` output in the
same commit, and say in the commit message what the page change was. The
inconsistent state this merge cleaned up was caused by exporting by hand and
committing only part of the result.

## Asset privacy

`public/` holds screenshots used by the import guide.

- Third-party app screenshots (将棋ウォーズ / 将棋クエスト / 棋桜) are cropped so
  that account names, ratings, avatars, and profile identifiers are not
  visible.
- The `*.webp` files under `public/shogi/` are privacy-safe derivatives of the
  same screenshots.
- Mind Atlas UI screenshots (`kif-*-guide.png`) were captured in a signed-out
  session.
- Original mail attachments are intentionally not tracked.
- These are documentation assets only. They are not UI fixtures and should not
  be used to infer provider APIs.
