import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceUrl = (process.env.VITE_MIND_ATLAS_SERVICE_URL || "https://mind-atlas.org").replace(/\/+$/, "");
const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];

const result = spawnSync(command, args, {
  cwd: rootDir,
  env: {
    ...process.env,
    VITE_MIND_ATLAS_PUBLIC_SERVICE: "true",
    VITE_MIND_ATLAS_SERVICE_URL: serviceUrl,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const marker = {
  app: "mind-atlas",
  mode: "hosted-public",
  publicService: true,
  serviceUrl,
  builtAt: new Date().toISOString(),
};

const markerPath = path.join(rootDir, "dist", ".mind-atlas-build.json");
fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
console.log(`Hosted public build marker written: ${path.relative(rootDir, markerPath)}`);
