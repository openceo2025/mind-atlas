// 空間UI のローカル開発：開発ブリッジ（AI・埋め込み・エージェント）と Vite を一緒に起動する。
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readDotEnv = (name) => {
  const file = resolve(repoRoot, name);
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
};

const env = { ...readDotEnv(".env"), ...readDotEnv(".env.local"), ...process.env };
env.MIND_ATLAS_BRIDGE_PORT ??= "8787";
env.MIND_ATLAS_ALLOWED_ORIGIN ??= "*";
env.VITE_MIND_ATLAS_BRIDGE_URL ??= `http://127.0.0.1:${env.MIND_ATLAS_BRIDGE_PORT}`;

const children = [
  spawn(process.execPath, ["scripts/mind-atlas-bridge.mjs"], { cwd: repoRoot, env, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "spatial/vite.config.ts", "--configLoader", "runner"], { cwd: repoRoot, env, stdio: "inherit" }),
];
console.log("MindAtlas spatial dev: http://127.0.0.1:5180/  (bridge " + env.VITE_MIND_ATLAS_BRIDGE_URL + ")");
const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => code && process.exit(code));
