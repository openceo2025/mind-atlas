/**
 * Shogi engine bridge.
 *
 * Wraps one long-lived USI engine process (YaneuraOu + Suisho5) behind a small
 * localhost HTTP service. The engine is a single shared CPU resource, so every
 * request is serialized through one queue: the public service already limits
 * each account to one in-flight analysis, and this queue is the second line of
 * defence that keeps the web service responsive on a 4 vCPU host.
 */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { getEnv, readIntEnv } from "./service-config.mjs";

const host = getEnv("MIND_ATLAS_SHOGI_ENGINE_HOST", "127.0.0.1");
const port = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_PORT", 8787);
const enginePath = getEnv("MIND_ATLAS_SHOGI_ENGINE_PATH", "/opt/shogi/bin/yaneuraou");
const evalDir = getEnv("MIND_ATLAS_SHOGI_EVAL_DIR", "/opt/shogi/eval");
const engineThreads = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_THREADS", 2);
const engineHashMb = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_HASH_MB", 128);
const engineFvScale = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_FV_SCALE", 24);
const defaultMovetimeMs = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_MOVETIME_MS", 5000);
const maxMovetimeMs = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_MAX_MOVETIME_MS", 15000);
const readyTimeoutMs = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_READY_TIMEOUT_MS", 60000);
const searchGraceMs = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_SEARCH_GRACE_MS", 10000);
const queueMaxLength = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_QUEUE_MAX", 12);
const requestMaxBytes = readIntEnv("MIND_ATLAS_SHOGI_ENGINE_MAX_BYTES", 8 * 1024);
const engineLabel = getEnv("MIND_ATLAS_SHOGI_ENGINE_LABEL", "やねうら王 + 水匠5");

/**
 * SFEN reaches the engine as a raw USI command line. Anything outside this
 * character set - a newline above all - would let a caller inject extra USI
 * commands into the engine standard input, so the charset is the real border.
 */
const SFEN_PATTERN = /^[1-9a-zA-Z+*/ -]{1,160}$/;
const USI_MOVE_PATTERN = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBRK]\*[1-9][a-i])$/;

let engine = null;
let engineStartPromise = null;
let engineGeneration = 0;
const queue = [];
let busy = false;
const stats = { started: 0, completed: 0, failed: 0, restarts: 0 };

function log(message, extra = {}) {
  const detail = Object.entries(extra)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  console.log(`[shogi-engine] ${message}${detail ? ` ${detail}` : ""}`);
}

function write(state, command) {
  state.child.stdin.write(`${command}\n`);
}

function startEngine() {
  if (engine?.ready) return Promise.resolve(engine);
  if (engineStartPromise) return engineStartPromise;
  engineStartPromise = new Promise((resolve, reject) => {
    const generation = ++engineGeneration;
    let child;
    try {
      child = spawn(enginePath, [], { cwd: path.dirname(enginePath), stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      engineStartPromise = null;
      reject(new Error(`Failed to start the shogi engine: ${error?.message ?? error}`));
      return;
    }

    const state = { generation, child, ready: false, name: "", buffer: "", onLine: null };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      state.buffer += chunk;
      let index = state.buffer.indexOf("\n");
      while (index >= 0) {
        const line = state.buffer.slice(0, index).replace(/\r$/, "");
        state.buffer = state.buffer.slice(index + 1);
        if (line) state.onLine?.(line);
        index = state.buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => log("engine stderr", { chunk: String(chunk).trim().slice(0, 400) }));
    child.on("exit", (code, signal) => {
      state.ready = false;
      if (engine === state) engine = null;
      log("engine exited", { code, signal });
    });
    child.on("error", (error) => log("engine process error", { message: String(error?.message ?? error) }));

    const timer = setTimeout(() => {
      state.onLine = null;
      child.kill("SIGKILL");
      engineStartPromise = null;
      reject(new Error("The shogi engine did not become ready in time"));
    }, readyTimeoutMs);

    let phase = "usi";
    state.onLine = (line) => {
      if (line.startsWith("id name ")) state.name = line.slice("id name ".length).trim();
      if (phase === "usi" && line === "usiok") {
        phase = "isready";
        write(state, `setoption name Threads value ${engineThreads}`);
        write(state, `setoption name USI_Hash value ${engineHashMb}`);
        write(state, `setoption name EvalDir value ${evalDir}`);
        write(state, `setoption name FV_SCALE value ${engineFvScale}`);
        write(state, "setoption name MultiPV value 1");
        write(state, "setoption name NetworkDelay value 0");
        write(state, "setoption name NetworkDelay2 value 0");
        write(state, "setoption name MinimumThinkingTime value 0");
        write(state, "setoption name USI_Ponder value false");
        // An opening book answers instantly with no evaluation and no reading,
        // which is the opposite of what an analysis request asked for.
        write(state, "setoption name BookFile value no_book");
        write(state, "isready");
        return;
      }
      if (phase === "isready" && line === "readyok") {
        clearTimeout(timer);
        state.ready = true;
        state.onLine = null;
        engine = state;
        engineStartPromise = null;
        log("engine ready", { name: state.name, threads: engineThreads, hashMb: engineHashMb });
        resolve(state);
      }
    };

    write(state, "usi");
  });
  return engineStartPromise;
}

function parseScore(tokens, index) {
  const type = tokens[index + 1];
  const raw = Number(tokens[index + 2]);
  if (!Number.isFinite(raw)) return null;
  if (type === "cp") return { kind: "cp", value: Math.trunc(raw) };
  if (type === "mate") return { kind: "mate", value: Math.trunc(raw) };
  return null;
}

/** Runs one search on the shared engine and resolves with its final line. */
function analyzePosition({ sfen, movetimeMs }) {
  return new Promise((resolve, reject) => {
    startEngine().then((state) => {
      let best = null;
      // A fail-high/fail-low line carries an inexact score and usually a
      // truncated principal variation, so it is only used when the search
      // produced nothing better.
      let bestBounded = null;
      let depth = 0;
      let seldepth = 0;
      let nodes = 0;
      let nps = 0;
      let settled = false;
      const startedAt = Date.now();

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        state.onLine = null;
        if (error) reject(error);
        else resolve(value);
      };

      const timer = setTimeout(() => {
        write(state, "stop");
        setTimeout(() => {
          if (settled) return;
          log("search timed out, restarting engine");
          stats.restarts += 1;
          try {
            state.child.kill("SIGKILL");
          } catch {
            // The process is already gone; the exit handler clears the slot.
          }
          finish(new Error("The shogi engine did not answer in time"));
        }, 2000);
      }, movetimeMs + searchGraceMs);

      state.onLine = (line) => {
        const tokens = line.split(/\s+/);
        if (tokens[0] === "info") {
          const scoreIndex = tokens.indexOf("score");
          const pvIndex = tokens.indexOf("pv");
          const depthIndex = tokens.indexOf("depth");
          const seldepthIndex = tokens.indexOf("seldepth");
          const nodesIndex = tokens.indexOf("nodes");
          const npsIndex = tokens.indexOf("nps");
          if (depthIndex >= 0) depth = Number(tokens[depthIndex + 1]) || depth;
          if (seldepthIndex >= 0) seldepth = Number(tokens[seldepthIndex + 1]) || seldepth;
          if (nodesIndex >= 0) nodes = Number(tokens[nodesIndex + 1]) || nodes;
          if (npsIndex >= 0) nps = Number(tokens[npsIndex + 1]) || nps;
          if (scoreIndex >= 0 && pvIndex >= 0) {
            const score = parseScore(tokens, scoreIndex);
            const pv = tokens.slice(pvIndex + 1).filter((move) => USI_MOVE_PATTERN.test(move));
            const bounded = tokens.includes("lowerbound") || tokens.includes("upperbound");
            if (score && pv.length) {
              if (bounded) bestBounded = { score, pv, depth, seldepth };
              else best = { score, pv, depth, seldepth };
            }
          }
          return;
        }
        if (tokens[0] === "bestmove") {
          const bestMove = tokens[1] ?? "";
          const final = best ?? bestBounded;
          finish(null, {
            bestMove,
            terminal: bestMove === "resign" || bestMove === "win" || !bestMove,
            score: final?.score ?? null,
            pv: final?.pv ?? [],
            depth: final?.depth ?? depth,
            seldepth: final?.seldepth ?? seldepth,
            nodes,
            nps,
            elapsedMs: Date.now() - startedAt,
            engineName: state.name || engineLabel,
          });
        }
      };

      write(state, "usinewgame");
      write(state, `position sfen ${sfen}`);
      write(state, `go movetime ${movetimeMs}`);
    }, reject);
  });
}

function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  stats.started += 1;
  analyzePosition(job.request)
    .then((result) => {
      stats.completed += 1;
      job.resolve(result);
    })
    .catch((error) => {
      stats.failed += 1;
      job.reject(error);
    })
    .finally(() => {
      busy = false;
      pump();
    });
}

function enqueue(request) {
  if (queue.length >= queueMaxLength) {
    return Promise.reject(Object.assign(new Error("The shogi engine queue is full"), { status: 503 }));
  }
  return new Promise((resolve, reject) => {
    queue.push({ request, resolve, reject });
    pump();
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > requestMaxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Request body must be JSON"), { status: 400 });
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "mind-atlas-shogi-engine",
        ready: Boolean(engine?.ready),
        engineName: engine?.name ?? "",
        label: engineLabel,
        queued: queue.length,
        busy,
        stats,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/analyze") {
      const payload = await readJsonBody(request);
      const sfen = String(payload?.sfen ?? "").trim();
      if (!SFEN_PATTERN.test(sfen)) throw Object.assign(new Error("A valid SFEN position is required"), { status: 400 });
      const requestedMovetime = Number(payload?.movetimeMs);
      const movetimeMs = Number.isFinite(requestedMovetime)
        ? Math.min(maxMovetimeMs, Math.max(100, Math.trunc(requestedMovetime)))
        : defaultMovetimeMs;
      const result = await enqueue({ sfen, movetimeMs });
      sendJson(response, 200, { ...result, label: engineLabel, movetimeMs });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) log("request failed", { message: String(error?.message ?? error) });
    sendJson(response, status, { error: String(error?.message ?? error) });
  }
});

server.listen(port, host, () => {
  log("listening", { host, port, enginePath, evalDir });
  startEngine().catch((error) => log("engine warmup failed", { message: String(error?.message ?? error) }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log("shutting down", { signal });
    try {
      engine?.child.kill("SIGTERM");
    } catch {
      // Nothing to clean up when the engine never started.
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
