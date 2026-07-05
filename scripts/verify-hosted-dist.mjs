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

console.log("Hosted public dist verification passed");
