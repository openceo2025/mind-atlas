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
for (const staticFile of ["404.html", "robots.txt", "sitemap.xml", "og-image.png"]) {
  assert.equal(fs.existsSync(path.join(distDir, staticFile)), true, `hosted public file is missing: ${staticFile}`);
}
const indexHtml = fs.readFileSync(indexPath, "utf8");
assert.ok(indexHtml.includes('rel="canonical" href="https://mind-atlas.org/"'), "hosted index is missing its canonical URL");
assert.ok(indexHtml.includes('property="og:image" content="https://mind-atlas.org/og-image.png"'), "hosted index is missing its Open Graph image");
assert.ok(fs.readFileSync(path.join(distDir, "robots.txt"), "utf8").includes("Sitemap: https://mind-atlas.org/sitemap.xml"), "robots.txt should advertise the sitemap");
const sitemap = fs.readFileSync(path.join(distDir, "sitemap.xml"), "utf8");
assert.ok(sitemap.includes("https://mind-atlas.org/ja/about.html"), "sitemap should include localized introduction pages");
assert.ok(sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'), "sitemap should declare the hreflang namespace");
assert.ok(sitemap.includes('hreflang="x-default" href="https://mind-atlas.org/en/about.html"'), "sitemap should use the English introduction as x-default");
for (const legacyPath of ["about", "privacy", "terms"]) {
  assert.equal(sitemap.includes(`<loc>https://mind-atlas.org/${legacyPath}.html</loc>`), false, `sitemap should exclude redirect-only legacy page: ${legacyPath}.html`);
}
const jsAssets = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
assert.ok(jsAssets.length > 0, "dist/assets has no JavaScript bundle");

for (const locale of ["en", "ja"]) {
  for (const page of ["about", "privacy", "terms"]) {
    const localizedPath = path.join(distDir, locale, `${page}.html`);
    assert.equal(fs.existsSync(localizedPath), true, `localized page is missing: ${locale}/${page}.html`);
    const html = fs.readFileSync(localizedPath, "utf8");
    assert.ok(html.includes(`<html lang="${locale}"`), `localized page has wrong html language: ${locale}/${page}.html`);
    assert.ok(html.includes('hreflang="en"') && html.includes('hreflang="ja"'), `localized page is missing hreflang links: ${locale}/${page}.html`);
    assert.ok(html.includes(`hreflang="x-default" href="https://mind-atlas.org/en/${page}.html"`), `localized page has wrong x-default URL: ${locale}/${page}.html`);
    assert.ok(html.includes(`rel="canonical" href="https://mind-atlas.org/${locale}/${page}.html"`), `localized page is missing canonical URL: ${locale}/${page}.html`);
    assert.ok(html.includes('property="og:image" content="https://mind-atlas.org/og-image.png"'), `localized page is missing Open Graph metadata: ${locale}/${page}.html`);
  }
}
assert.ok(fs.readFileSync(path.join(distDir, "en", "about.html"), "utf8").includes("Don't let what you found with ChatGPT get buried in the conversation."), "English introduction value proposition is missing");
assert.ok(fs.readFileSync(path.join(distDir, "ja", "about.html"), "utf8").includes("ChatGPTで調べたことを、会話のまま埋もれさせない。"), "Japanese introduction value proposition is missing");
assert.ok(fs.readFileSync(path.join(distDir, "es", "about.html"), "utf8").includes("aboutDemo=research&amp;aboutView=atlas&amp;locale=es"), "Spanish introduction does not pass its locale to the embedded demo");
assert.ok(fs.readFileSync(path.join(distDir, "ar", "about.html"), "utf8").includes("aboutDemo=app&amp;aboutView=atlas&amp;locale=ar"), "Arabic introduction does not pass its locale to the embedded demo");

console.log("Hosted public dist verification passed");
