const baseUrl = (process.env.MIND_ATLAS_STAGING_URL ?? "http://127.0.0.1:8088").replace(/\/+$/, "");
const expectedProviders = ["openai", "anthropic", "glm", "deepseek", "gemini", "qwen", "composer", "kimi", "mimo", "minimax", "grok"];
const jar = new Map();

const anonymous = await requestJson("/api/service/session");
assert(anonymous.publicService === true, "service session should be public service");
assert(anonymous.authenticated === false, "anonymous session should not be authenticated");
assert(anonymous.entitlement?.aiEnabled === false, "anonymous session should not have AI entitlement");

const anonymousAi = await request("/api/ai/text-partner-turn", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "openai", messages: [{ role: "user", content: "anonymous check" }] }),
});
assert(anonymousAi.status === 401, `anonymous AI should return 401, got ${anonymousAi.status}`);
await anonymousAi.text();

const login = await request("/api/auth/google/start?returnTo=/", { redirect: "manual" });
assert(login.status >= 300 && login.status < 400, `mock Google login should redirect, got ${login.status}`);
assert(cookieHeader().includes("ma_session="), "mock Google login should set ma_session");

const loggedIn = await requestJson("/api/service/session");
assert(loggedIn.authenticated === true, "session should be authenticated after mock login");
assert(loggedIn.entitlement?.aiEnabled === false, "AI should still be locked before billing");

const checkout = await requestJson("/api/billing/checkout", { method: "POST" });
assert(typeof checkout.url === "string" && checkout.url.includes("/api/billing/mock-checkout"), "mock checkout URL should point to mock checkout");
const paid = await request(checkout.url, { redirect: "manual" });
assert(paid.status >= 300 && paid.status < 400, `mock checkout should redirect, got ${paid.status}`);

const entitled = await requestJson("/api/service/session");
assert(entitled.subscription?.status === "active", "subscription should be active after mock checkout");
assert(entitled.entitlement?.aiEnabled === true, "AI should be enabled after mock checkout");
assert((entitled.credit?.remainingPercent ?? 0) > 0, `credit should be available after mock checkout, got ${entitled.credit?.remainingPercent}`);

const options = await requestJson("/api/chat/options");
const services = options.services ?? [];
for (const providerId of expectedProviders) {
  assert(services.some((service) => service.id === providerId), `chat options missing ${providerId}`);
}

const chatResults = [];
for (const service of services.filter((item) => expectedProviders.includes(item.id))) {
  const model = service.defaultModel || service.models?.[0]?.model;
  const result = await requestJson("/api/ai/text-partner-turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: service.id,
      model,
      reasoningEffort: service.defaultReasoningEffort ?? "default",
      messages: [{ role: "user", content: `staging check for ${service.id}` }],
      context: createContext(),
      tools: [],
    }),
  });
  assert(result.text?.includes(`[staging:${service.id}]`), `${service.id} did not return staging mock text`);
  assert(result.usage?.creditRemainingPercent < 100, `${service.id} did not debit credit`);
  chatResults.push({ provider: service.id, model: result.model, credit: result.usage.creditRemainingPercent });
}

const webSearch = await requestJson("/api/tools/web-search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "Mind Atlas staging verification" }),
});
assert(webSearch.text?.includes("Mock web search result"), "web search should return mock result");

const audioForm = new FormData();
audioForm.set("audio", new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "audio/webm" }), "dictation.webm");
const transcription = await requestJson("/api/audio/transcriptions", {
  method: "POST",
  body: audioForm,
});
assert(transcription.text?.includes("Mock dictation transcript"), "dictation should return mock transcript");

const realtime = await request("/api/realtime/calls", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=staging\r\nt=0 0\r\n",
    model: "gpt-realtime-2",
    context: createContext(),
    tools: [],
  }),
});
assert(realtime.ok, `Realtime mock should return 200, got ${realtime.status}`);
const realtimeSdp = await realtime.text();
assert(realtimeSdp.includes("Mind Atlas staging mock Realtime"), "Realtime mock SDP missing marker");

const afterAi = await requestJson("/api/service/session");
assert(afterAi.credit?.remainingPercent < 100, "credit should be below 100 after metered AI calls");

console.log("Staging service verification passed");
console.log(JSON.stringify({
  baseUrl,
  user: afterAi.user?.email,
  subscription: afterAi.subscription?.status,
  creditRemainingPercent: afterAi.credit?.remainingPercent,
  providers: chatResults,
}, null, 2));

async function requestJson(pathOrUrl, init = {}) {
  const response = await request(pathOrUrl, init);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${pathOrUrl}, got ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${pathOrUrl}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function request(pathOrUrl, init = {}) {
  const url = String(pathOrUrl).startsWith("http") ? String(pathOrUrl) : `${baseUrl}${pathOrUrl}`;
  const headers = new Headers(init.headers ?? {});
  if (jar.size) headers.set("Cookie", cookieHeader());
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: init.redirect ?? "follow",
  });
  rememberCookies(response);
  return response;
}

function rememberCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : splitSetCookie(response.headers.get("set-cookie"));
  for (const value of values) {
    const first = value.split(";")[0];
    const index = first.indexOf("=");
    if (index < 0) continue;
    const name = first.slice(0, index).trim();
    const cookieValue = first.slice(index + 1).trim();
    if (!name) continue;
    if (!cookieValue) jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function cookieHeader() {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function createContext() {
  return {
    selectedNode: { id: "root", title: "Staging Root", body: "Staging verification context", children: [] },
    path: [],
    siblingNodes: [],
    selectedNodes: [],
    attachments: [],
    stats: { scope: "path-children", estimatedTokens: 42, nodeCount: 1 },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
