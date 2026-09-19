// MindAtlas β（空間UI）の公開ビルド。VITE_MIND_ATLAS_PUBLIC_SERVICE=true で開発者向け機能を外す。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(rootDir, "dist-spatial");
// 既定は同一オリジン（ベータはアプリと API を同じホストで配信する）
const serviceUrl = (process.env.VITE_MIND_ATLAS_SERVICE_URL || "").replace(/\/+$/, "");
const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run spatial:build"] : ["run", "spatial:build"];

const result = spawnSync(command, args, {
  cwd: rootDir,
  env: { ...process.env, VITE_MIND_ATLAS_PUBLIC_SERVICE: "true", VITE_MIND_ATLAS_SERVICE_URL: serviceUrl },
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

// 共有リンク以外の未知のパスもアプリを返す（サービスは 404 時に 404.html を配信する）
fs.copyFileSync(path.join(outDir, "index.html"), path.join(outDir, "404.html"));
fs.writeFileSync(path.join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
const marker = { app: "mindatlas-spatial", mode: "hosted-public", publicService: true, serviceUrl: serviceUrl || "same-origin", builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(outDir, ".mind-atlas-build.json"), `${JSON.stringify(marker, null, 2)}\n`);
console.log(`Hosted spatial build written to ${path.relative(rootDir, outDir)}`);
