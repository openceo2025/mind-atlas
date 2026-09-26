// Local-only galaxy judge for the bridge. Two backends:
//
// - jev: TypeSafe's System One decision API (Jev). The key comes from
//   MIND_ATLAS_TYPESAFE_API_KEY / TYPESAFE_API_KEY, or on Windows from the
//   user environment in the registry, where r10's `setx` puts it. The key
//   never leaves this process except in the request to TypeSafe.
// - llama: a local llama.cpp `llama-server`, judged the way r10 does it: the
//   model never writes. We ask for one token constrained to the option
//   labels, read the label log-probabilities, rotate the label order once to
//   cancel "always pick A" bias, and softmax the averaged scores. Nothing is
//   sent off the machine.
//
// This module must never be imported by server/mind-atlas-service.mjs.
import { spawnSync } from "node:child_process";

const LABELS = "ABCDEFGHJKLMNPQRSTUVWXY";
const TOP_LOGPROBS = 20;
const FLOOR = -20;

export function createGalaxyJudge({ env = process.env } = {}) {
  const jevBaseUrl = (env.MIND_ATLAS_TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1").replace(/\/+$/, "");
  const jevModel = env.MIND_ATLAS_DECISION_MODEL || "jev-latest";
  let cachedKey = null;

  function jevKey() {
    if (cachedKey !== null) return cachedKey;
    cachedKey = (env.MIND_ATLAS_TYPESAFE_API_KEY || env.TYPESAFE_API_KEY || readWindowsUserEnv("TYPESAFE_API_KEY") || "").trim();
    return cachedKey;
  }

  async function status(llamaUrl) {
    const llama = await llamaProps(llamaUrl).then(
      (props) => ({ available: true, model: modelName(props), detail: llamaUrl }),
      (error) => ({ available: false, model: "", detail: String(error?.message ?? error) }),
    );
    return { jev: { configured: Boolean(jevKey()), model: jevModel }, llama };
  }

  async function judge(payload) {
    const questions = payload?.questions && typeof payload.questions === "object" ? payload.questions : null;
    if (!questions || !Object.keys(questions).length) throw withStatus(400, "No questions to judge");
    const state = typeof payload.state === "string" ? payload.state.slice(0, 60_000) : "";
    if (payload.backend === "llama") return await judgeWithLlama(String(payload.llamaUrl || "http://127.0.0.1:8089"), state, questions);
    return await judgeWithJev(state, questions);
  }

  async function judgeWithJev(state, questions) {
    const key = jevKey();
    if (!key) throw withStatus(503, "TYPESAFE_API_KEY is not set for the bridge");
    let upstream;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      upstream = await fetch(`${jevBaseUrl}/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: jevModel, state, questions }),
        signal: AbortSignal.timeout(30_000),
      });
      if (upstream.status !== 429 && upstream.status !== 529) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    const text = await upstream.text();
    let raw = {};
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      throw withStatus(502, `Jev returned malformed JSON (${upstream.status})`);
    }
    if (!upstream.ok) throw withStatus(502, `Jev request failed (${upstream.status}): ${String(raw?.error?.message ?? raw?.error ?? "").slice(0, 200)}`);
    return { answers: raw?.answers && typeof raw.answers === "object" ? raw.answers : {}, model: String(raw?.model || jevModel), usage: raw?.usage };
  }

  async function judgeWithLlama(url, state, questions) {
    const props = await llamaProps(url);
    const model = modelName(props);
    const answers = {};
    for (const [name, question] of Object.entries(questions)) {
      const options = optionsOf(question);
      if (options.length < 2 || options.length > LABELS.length) continue;
      const totals = options.map(() => 0);
      const passes = Math.min(2, options.length);
      for (let pass = 0; pass < passes; pass += 1) {
        const order = options.map((_, index) => (index + pass) % options.length);
        const labels = LABELS.slice(0, options.length).split("");
        const prompt = buildPrompt(state, question, order.map((index) => options[index].text), labels);
        const scores = await scoreLabels(url, prompt, labels);
        order.forEach((optionIndex, position) => {
          totals[optionIndex] += scores[labels[position]];
        });
      }
      const probabilities = softmax(totals.map((value) => value / passes));
      const best = probabilities.indexOf(Math.max(...probabilities));
      if (question.type === "score") {
        const score = probabilities.reduce((sum, p, index) => sum + p * index, 0);
        answers[name] = {
          type: "score",
          score,
          confidence: probabilities[best],
          probabilities: Object.fromEntries(options.map((option, index) => [option.key, probabilities[index]])),
        };
      } else {
        answers[name] = {
          type: "choice",
          choice: options[best].key,
          confidence: probabilities[best],
          probabilities: Object.fromEntries(options.map((option, index) => [option.key, probabilities[index]])),
        };
      }
    }
    return { answers, model: `llama:${model}` };
  }

  async function scoreLabels(url, prompt, labels) {
    const body = {
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 1,
      logprobs: true,
      top_logprobs: TOP_LOGPROBS,
      grammar: `root ::= ${labels.map((label) => `"${label}"`).join(" | ")}`,
    };
    // Thinking models hide the label behind a "think" token unless told not to.
    let found;
    try {
      found = await llamaPost(url, "/v1/chat/completions", { ...body, chat_template_kwargs: { enable_thinking: false } });
    } catch (error) {
      if (error?.status === 0) throw error;
      found = await llamaPost(url, "/v1/chat/completions", body);
    }
    const top = found?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs ?? [];
    const seen = {};
    for (const item of top) {
      const token = String(item?.token ?? "").trim();
      if (labels.includes(token) && !(token in seen)) seen[token] = Number(item.logprob ?? FLOOR);
    }
    return Object.fromEntries(labels.map((label) => [label, seen[label] ?? FLOOR]));
  }

  return { status, judge };
}

function optionsOf(question) {
  const criteria = question?.criteria;
  if (Array.isArray(criteria)) return criteria.map((text, index) => ({ key: String(index), text: String(text) }));
  if (criteria && typeof criteria === "object") return Object.entries(criteria).map(([key, text]) => ({ key, text: String(text ?? key) }));
  return [];
}

function buildPrompt(state, question, texts, labels) {
  return [
    "You are judging a project for its owner. Read the state, then answer with a single letter.",
    "",
    "[State]",
    state || "(no state)",
    "",
    `[Question] ${String(question?.instructions ?? "")}`,
    ...texts.map((text, index) => `${labels[index]}. ${text}`),
    "",
    "Answer with one letter.",
  ].join("\n");
}

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((value) => value / sum);
}

async function llamaProps(url) {
  const base = url.replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${base}/props`, { signal: AbortSignal.timeout(4_000) });
  } catch {
    throw withStatus(503, `llama-server is not reachable at ${base}`);
  }
  if (!response.ok) throw withStatus(503, `llama-server at ${base} answered ${response.status}`);
  return await response.json();
}

async function llamaPost(url, path, body) {
  const base = url.replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    const error = withStatus(503, `llama-server is not reachable at ${base}`);
    error.status = 0;
    throw error;
  }
  const text = await response.text();
  if (!response.ok) throw withStatus(response.status, `llama-server error ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function modelName(props) {
  const path = String(props?.model_path || props?.default_generation_settings?.model || "llama");
  return path.split(/[\\/]/).pop() || "llama";
}

function readWindowsUserEnv(name) {
  if (process.platform !== "win32") return "";
  try {
    const result = spawnSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true, timeout: 3_000 });
    const line = String(result.stdout || "").split(/\r?\n/).find((row) => row.trim().startsWith(name));
    const match = line?.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function withStatus(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
