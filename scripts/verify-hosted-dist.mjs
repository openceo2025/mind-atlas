import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const markerPath = path.join(distDir, ".mind-atlas-build.json");
const indexPath = path.join(distDir, "index.html");
const assetsDir = path.join(distDir, "assets");

assert.equal(fs.existsSync(indexPath), true, "dist/index.html is missing. Run npm run build:hosted first.");
assert.equal(
  fs.existsSync(markerPath),
  true,
  "hosted public build marker is missing. Do not deploy this dist to ConoHa; run npm run build:hosted.",
);

const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
assert.equal(marker.app, "mind-atlas", "unexpected build marker app");
assert.equal(marker.mode, "hosted-public", "dist was not built in hosted-public mode");
assert.equal(marker.publicService, true, "dist public service flag is not true");

const serviceUrl = typeof marker.serviceUrl === "string" ? marker.serviceUrl : "";
assert.ok(serviceUrl.startsWith("https://mind-atlas.org"), `unexpected hosted service URL: ${serviceUrl}`);

assert.equal(fs.existsSync(assetsDir), true, "dist/assets is missing");
const jsAssets = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
assert.ok(jsAssets.length > 0, "dist/assets has no JavaScript bundle");

for (const locale of ["en", "ja"]) {
  for (const page of ["about", "privacy", "terms"]) {
    const localizedPath = path.join(distDir, locale, `${page}.html`);
    assert.equal(fs.existsSync(localizedPath), true, `localized page is missing: ${locale}/${page}.html`);
    const html = fs.readFileSync(localizedPath, "utf8");
    assert.ok(html.includes(`<html lang="${locale}"`), `localized page has wrong html language: ${locale}/${page}.html`);
    assert.ok(html.includes('hreflang="en"') && html.includes('hreflang="ja"'), `localized page is missing hreflang links: ${locale}/${page}.html`);
  }
}
assert.ok(fs.readFileSync(path.join(distDir, "en", "about.html"), "utf8").includes("Write a novel"), "English introduction copy is missing");
assert.ok(fs.readFileSync(path.join(distDir, "ja", "about.html"), "utf8").includes("小説を書く"), "Japanese introduction copy is missing");
assert.ok(fs.readFileSync(path.join(distDir, "es", "about.html"), "utf8").includes("aboutDemo=novel&amp;aboutView=atlas&amp;locale=es"), "Spanish introduction does not pass its locale to the embedded demo");
assert.ok(fs.readFileSync(path.join(distDir, "ar", "about.html"), "utf8").includes("aboutDemo=app&amp;aboutView=atlas&amp;locale=ar"), "Arabic introduction does not pass its locale to the embedded demo");

console.log("Hosted public dist verification passed");
