import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWindows = process.platform === "win32";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: npm run dev:all");
  console.log("");
  console.log("Starts the Mind Atlas bridge and Vite dev server together over LAN HTTPS by default.");
  console.log("Configuration is read from .env and .env.local when present.");
  console.log("Set MIND_ATLAS_DEV_HTTPS=false to use HTTP.");
  process.exit(0);
}

const env = {
  ...readDotEnv(".env"),
  ...readDotEnv(".env.local"),
  ...process.env,
};

const useHttps = (process.env.MIND_ATLAS_DEV_HTTPS ?? env.MIND_ATLAS_DEV_HTTPS ?? "true") !== "false";
env.MIND_ATLAS_BRIDGE_PORT ??= "8787";
env.MIND_ATLAS_BRIDGE_HOST = "0.0.0.0";
env.MIND_ATLAS_LOCAL_BASE_URL ??= "http://127.0.0.1:1234/v1";
env.MIND_ATLAS_LOCAL_API_KEY ??= "lm-studio";
env.MIND_ATLAS_ALLOWED_ORIGIN = process.env.MIND_ATLAS_ALLOWED_ORIGIN ?? "*";
if (useHttps) {
  ensureDevCertificate();
  env.MIND_ATLAS_HTTPS_KEY ??= resolve(repoRoot, ".certs", "mind-atlas-dev-server.key");
  env.MIND_ATLAS_HTTPS_CERT ??= resolve(repoRoot, ".certs", "mind-atlas-dev-server.crt");
  env.MIND_ATLAS_HTTPS_CA ??= resolve(repoRoot, ".certs", "mind-atlas-dev-ca.crt");
}
const protocol = useHttps ? "https" : "http";
env.MIND_ATLAS_BRIDGE_PROTOCOL = protocol;
if (!process.env.VITE_MIND_ATLAS_BRIDGE_URL && (!env.VITE_MIND_ATLAS_BRIDGE_URL || isLoopbackUrl(env.VITE_MIND_ATLAS_BRIDGE_URL))) {
  env.VITE_MIND_ATLAS_BRIDGE_URL = `${protocol}://127.0.0.1:${env.MIND_ATLAS_BRIDGE_PORT}`;
}
env.VITE_MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS ??= env.MIND_ATLAS_VOICE_IDLE_TIMEOUT_MS ?? "3600000";

const appPort = Number(env.MIND_ATLAS_APP_PORT ?? "5173");
const bridgePort = Number(env.MIND_ATLAS_BRIDGE_PORT);
await assertPortsAvailable([
  { name: "Mind Atlas bridge", host: env.MIND_ATLAS_BRIDGE_HOST, port: bridgePort },
  { name: "Vite dev server", host: "0.0.0.0", port: appPort },
]);

const children = [
  start("bridge", ["scripts/mind-atlas-bridge.mjs"]),
  start("vite", ["node_modules/vite/bin/vite.js", "--configLoader", "runner", "--host", "0.0.0.0", "--port", String(appPort), "--strictPort"]),
];

console.log("");
console.log("Mind Atlas dev stack is starting.");
console.log(`App:    ${protocol}://127.0.0.1:${appPort}/`);
console.log(`Bridge: ${env.VITE_MIND_ATLAS_BRIDGE_URL}`);
const lanUrls = getLanUrls(appPort);
if (lanUrls.length) {
  console.log("LAN:");
  for (const url of lanUrls) console.log(`        ${url}`);
}
if (useHttps) {
  console.log(`CA:     ${env.MIND_ATLAS_HTTPS_CA}`);
  console.log("        Install this CA on mobile devices to trust LAN HTTPS.");
}
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
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    shell: false,
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

function ensureDevCertificate() {
  const result = spawnSync(process.execPath, ["scripts/ensure-dev-cert.mjs"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function assertPortsAvailable(targets) {
  const failures = [];
  for (const target of targets) {
    try {
      await checkPortAvailable(target.host, target.port);
    } catch (error) {
      failures.push({ ...target, error });
    }
  }

  if (!failures.length) return;

  console.error("Mind Atlas dev stack cannot start because required port(s) are already in use.");
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.host}:${failure.port}`);
  }
  console.error("");
  console.error("Stop the existing dev server, then run `npm run dev:all` again.");
  if (isWindows) {
    console.error("PowerShell check:");
    console.error(`  Get-NetTCPConnection -LocalPort ${failures.map((failure) => failure.port).join(",")} | Select-Object LocalAddress,LocalPort,State,OwningProcess`);
    console.error("Then stop the owning process with:");
    console.error("  Stop-Process -Id <OwningProcess> -Force");
  }
  process.exit(1);
}

function checkPortAvailable(host, port) {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.once("listening", () => {
      server.close(() => resolvePort());
    });
    server.listen(port, host);
  });
}

function getLanUrls(port) {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => `${protocol}://${item.address}:${port}/`);
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
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
