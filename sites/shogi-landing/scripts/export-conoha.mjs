import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.resolve(process.argv[2] ?? path.join(rootDir, "export-conoha"));
const workerPath = path.join(rootDir, "dist", "server", "index.js");
const clientDir = path.join(rootDir, "dist", "client");
const publicDir = path.join(rootDir, "public");
const publicBase = "/shogi";
/**
 * Everything the page loads is WebP. The PNG originals stay in `public/` as the
 * editable source and are never published: at PNG weight these seven images are
 * 6.0 MB, and the landing page is the first thing a visitor on mobile data
 * waits for. `og.png` is the exception - it is fetched by social scrapers, not
 * by the page, and some of them still handle WebP badly.
 */
const assets = [
  "favicon.svg",
  "wars-copy.webp",
  "quest-share.webp",
  "kio-copy-guide-v3.webp",
  "mind-atlas-shogi-board.webp",
  "og.png",
  "kif-import-guide.webp",
  "kif-merge-menu-guide.webp",
  "kif-merge-dialog-guide.webp",
];

/** Assets the page itself downloads, and the ceiling they must stay under. */
const pageWeightBudgetBytes = 600 * 1024;
const socialAssets = new Set(["og.png"]);

if (!fs.existsSync(workerPath)) {
  throw new Error("dist/server/index.js is missing. Run npm run build first.");
}

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("export", `${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request("https://mind-atlas.org/", { headers: { accept: "text/html" } }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);

if (!response.ok) throw new Error(`Landing page render failed: HTTP ${response.status}`);
let html = await response.text();
const cssHref = html.match(/href="(\/_next\/static\/css\/[^"]+\.css)"/)?.[1];
if (!cssHref) throw new Error("Rendered page did not include its generated stylesheet.");
const cssPath = path.join(clientDir, cssHref.replace(/^\//, ""));
if (!fs.existsSync(cssPath)) throw new Error(`Generated stylesheet is missing: ${cssPath}`);

let css = await fsp.readFile(cssPath, "utf8");
css = css.replaceAll("url(/", `url(${publicBase}/`);

html = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<script\b[^>]*\/?\s*>/gi, "")
  .replace(/<link\b[^>]*rel="(?:modulepreload|preload)"[^>]*>/gi, "")
  .replace(new RegExp(`href="${escapeRegExp(cssHref)}"`), `href="${publicBase}/styles.css"`)
  .replaceAll('src="/', `src="${publicBase}/`)
  .replaceAll('href="/favicon.svg"', `href="${publicBase}/favicon.svg"`)
  .replaceAll('content="https://mind-atlas.org/og.png"', `content="https://mind-atlas.org${publicBase}/og.png"`)
  .replace("</head>", `  <link rel="canonical" href="https://mind-atlas.org${publicBase}/" />\n</head>`);

await fsp.mkdir(outputDir, { recursive: true });
/**
 * Published names that no longer belong in the output. The PNG entries are the
 * pre-WebP originals: leaving them behind would keep serving 6 MB of images
 * nothing references.
 */
const staleFiles = [
  "wars-copy.png",
  "quest-share.png",
  "kio-copy-guide-v3.png",
  "mind-atlas-shogi-board.png",
  "kif-import-guide.png",
  "kif-merge-menu-guide.png",
  "kif-merge-dialog-guide.png",
  "kio-copy.webp",
  "kio-copy-v2.webp",
];
await Promise.all(
  staleFiles.map(async (fileName) => {
    await fsp.rm(path.join(outputDir, fileName), { force: true });
  }),
);
await Promise.all([
  fsp.writeFile(path.join(outputDir, "index.html"), html, "utf8"),
  fsp.writeFile(path.join(outputDir, "styles.css"), css, "utf8"),
  ...assets.map(async (asset) => {
    const source = path.join(publicDir, asset);
    if (!fs.existsSync(source)) throw new Error(`Public asset is missing: ${asset}`);
    await fsp.copyFile(source, path.join(outputDir, asset));
  }),
]);

/**
 * The weight gate. Publishing this page used to silently swap hand-made WebP
 * derivatives for their PNG originals and take the referenced images from
 * 0.3 MB to 6.9 MB, which nobody noticed because nothing measured it. Now the
 * export refuses instead.
 */
const weighed = assets
  .filter((asset) => !socialAssets.has(asset))
  .map((asset) => ({ asset, bytes: fs.statSync(path.join(outputDir, asset)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const totalBytes = weighed.reduce((sum, item) => sum + item.bytes, 0);
if (totalBytes > pageWeightBudgetBytes) {
  const breakdown = weighed.map((item) => `  ${(item.bytes / 1024).toFixed(0).padStart(6)} KB  ${item.asset}`).join("\n");
  throw new Error(
    `Page assets are ${(totalBytes / 1024).toFixed(0)} KB, over the ${(pageWeightBudgetBytes / 1024).toFixed(0)} KB budget.\n` +
      `${breakdown}\n` +
      "Export images as WebP (see the asset list in this script) or raise the budget deliberately.",
  );
}

console.log(`page assets: ${(totalBytes / 1024).toFixed(0)} KB of ${(pageWeightBudgetBytes / 1024).toFixed(0)} KB budget`);
console.log(`ConoHa static export written to ${outputDir}`);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
