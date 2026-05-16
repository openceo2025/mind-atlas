import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWindows = process.platform === "win32";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: npm run dev:all");
  console.log("");
  console.log("Starts the Mind Atlas bridge and Vite dev server together.");
  console.log("Configuration is read from .env and .env.local when present.");
  process.exit(0);
}

const env = {
  ...readDotEnv(".env"),
  ...readDotEnv(".env.local"),
  ...process.env,
};

env.MIND_ATLAS_BRIDGE_PORT ??= "8787";
env.MIND_ATLAS_LOCAL_BASE_URL ??= "http://127.0.0.1:1234/v1";
env.MIND_ATLAS_LOCAL_API_KEY ??= "lm-studio";
env.MIND_ATLAS_ALLOWED_ORIGIN ??= "http://127.0.0.1:5173,http://localhost:5173";
env.VITE_MIND_ATLAS_BRIDGE_URL ??= `http://127.0.0.1:${env.MIND_ATLAS_BRIDGE_PORT}`;

const children = [
  start("bridge", ["run", "dev:bridge"]),
  start("vite", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]),
];

console.log("");
console.log("Mind Atlas dev stack is starting.");
console.log("App:    http://127.0.0.1:5173/");
console.log(`Bridge: ${env.VITE_MIND_ATLAS_BRIDGE_URL}`);
console.log("Stop both with Ctrl+C.");
console.log("");

let stopping = false;

for (const child of children) {
  child.process.on("exit", (code, signal) => {
    if (stopping) return;
    stopping = true;
    stopChildren();
    if (signal) {
      console.error(`${child.name} stopped with signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

process.on("SIGINT", () => {
  if (stopping) return;
  stopping = true;
  stopChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  stopChildren();
  process.exit(143);
});

function start(name, args) {
  const child = spawn(npmCommand(), args, {
    cwd: repoRoot,
    env,
    shell: isWindows,
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => writePrefixed(name, chunk, false));
  child.stderr.on("data", (chunk) => writePrefixed(name, chunk, true));
  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
  });

  return { name, process: child };
}

function stopChildren() {
  for (const child of children) {
    stopProcessTree(child.process);
  }
}

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;

  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  child.kill("SIGTERM");
}

function npmCommand() {
  return isWindows ? "npm.cmd" : "npm";
}

function writePrefixed(name, chunk, isError) {
  const output = chunk
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${name}] ${line}`)
    .join("\n");

  if (!output) return;
  const stream = isError ? process.stderr : process.stdout;
  stream.write(`${output}\n`);
}

function readDotEnv(fileName) {
  const filePath = resolve(repoRoot, fileName);
  if (!existsSync(filePath)) return {};

  const parsed = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}
