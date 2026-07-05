import { execFileSync } from "node:child_process";

const baseUrl = (process.env.MIND_ATLAS_STAGING_URL || "http://127.0.0.1:8088").replace(/\/+$/, "");
const verifyEmail = process.env.MIND_ATLAS_STAGING_VERIFY_EMAIL || "openceo99@gmail.com";
const expectedServices = (process.env.MIND_ATLAS_EXPECTED_STAGING_CHAT_SERVICES || "openai,anthropic,deepseek")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const token = dockerNode(`
  import { createSession, findUserByEmail, pool } from './server/service-db.mjs';
  const user = await findUserByEmail(${JSON.stringify(verifyEmail)});
  if (!user) { console.error('verify user not found'); process.exit(1); }
  const token = await createSession(user.id, 1);
  process.stdout.write(token);
  await pool.end();
`);
const cookie = `ma_session=${encodeURIComponent(token)}`;
const initialSession = await requestJson("/api/service/session");
assert(initialSession.authenticated === true, "session cookie should authenticate the staging user");
assert(initialSession.subscription?.status === "active", `subscription should start active, got ${initialSession.subscription?.status}`);
assert(initialSession.entitlement?.aiEnabled === true, "AI entitlement should start active");
const restoreCreditPercent = Number(initialSession.credit?.remainingPercent ?? 100);

const options = await requestJson("/api/chat/options");
const configuredServices = options.services.filter((service) => service.configured);
const serviceIds = configuredServices.map((service) => service.id);
assert(JSON.stringify(serviceIds) === JSON.stringify(expectedServices), `expected services ${expectedServices.join(",")}, got ${serviceIds.join(",")}`);

const expectedModels = {
  openai: ["gpt-4.1-mini", "gpt-4.1"],
  anthropic: ["claude-haiku-4-5-20251001", "claude-opus-4-8"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

const chatResults = [];
for (const service of configuredServices) {
  const models = service.models.map((model) => model.model);
  for (const expectedModel of expectedModels[service.id] ?? []) {
    assert(models.includes(expectedModel), `${service.id} missing ${expectedModel}: ${models.join(",")}`);
  }
  for (const model of models) {
    const result = await requestJson("/api/ai/text-partner-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: service.id,
        model,
        reasoningEffort: "none",
        messages: [{ role: "user", content: "Reply exactly OK" }],
        context: createContext(),
        tools: [],
      }),
    });
    assert(String(result.text || "").trim().startsWith("OK"), `${service.id}/${model} did not reply OK`);
    assert(result.usage?.creditRemainingPercent < restoreCreditPercent, `${service.id}/${model} did not debit credit`);
    chatResults.push({ provider: service.id, model: result.model, credit: result.usage.creditRemainingPercent });
  }
}

const webSearch = await requestJson("/api/tools/web-search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "Mind Atlas official site" }),
});
assert(typeof webSearch.text === "string" && webSearch.text.length > 0, "web search should return text");
assert((webSearch.usage?.estimatedCostUsd ?? 0) >= 0.015, "web search should apply minimum cost reservation");

const audioForm = new FormData();
audioForm.set("audio", new Blob([createSilentWav()], { type: "audio/wav" }), "dictation.wav");
const transcription = await requestJson("/api/audio/transcriptions", {
  method: "POST",
  body: audioForm,
});
assert(typeof transcription.text === "string", "dictation should return text");

const realtime = await request("/api/realtime/calls", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sdp: createMinimalAudioSdpOffer(),
    model: "gpt-realtime-2",
    context: createContext(),
    tools: [],
  }),
});
assert(realtime.ok, `Realtime reservation should return 200, got ${realtime.status}`);
await realtime.text();

await verifyTemporarySubscriptionStatus("past_due");
await verifyTemporarySubscriptionStatus("canceled");

try {
  dockerNode(`
    import { setCreditPercent, pool } from './server/service-db.mjs';
    await setCreditPercent(${JSON.stringify(verifyEmail)}, 0);
    await pool.end();
  `);
  const exhaustedSession = await requestJson("/api/service/session");
  assert(exhaustedSession.entitlement?.reason === "credit_exhausted", `expected credit_exhausted, got ${exhaustedSession.entitlement?.reason}`);
  const exhaustedAi = await request("/api/ai/text-partner-turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      model: "gpt-4.1-mini",
      reasoningEffort: "none",
      messages: [{ role: "user", content: "should be blocked" }],
      context: createContext(),
      tools: [],
    }),
  });
  const exhaustedBody = await readJsonOrText(exhaustedAi);
  assert(exhaustedAi.status === 402, `exhausted token should return 402, got ${exhaustedAi.status}`);
  assert(!/sk-|Bearer\s+/i.test(JSON.stringify(exhaustedBody)), "402 response should not contain secret-looking text");
} finally {
  dockerNode(`
    import { setCreditPercent, pool } from './server/service-db.mjs';
    await setCreditPercent(${JSON.stringify(verifyEmail)}, ${JSON.stringify(restoreCreditPercent)});
    await pool.end();
  `);
}

const usage = dockerNode(`
  import { listUsageEvents, pool } from './server/service-db.mjs';
  const result = await listUsageEvents(${JSON.stringify(verifyEmail)}, 20);
  process.stdout.write(JSON.stringify(result?.events?.slice(0, 12).map((event) => ({
    provider: event.provider,
    model: event.model,
    input: event.input_tokens,
    output: event.output_tokens,
    spent: Number(event.credit_spent_micro_usd),
  })) ?? []));
  await pool.end();
`);
const usageEvents = JSON.parse(usage);
for (const provider of expectedServices) {
  assert(usageEvents.some((event) => event.provider === provider), `usage missing provider ${provider}`);
}
assert(usageEvents.some((event) => event.provider === "openai" && event.model === "gpt-realtime-2"), "usage missing realtime reservation");
assert(usageEvents.some((event) => event.provider === "openai" && event.model === "gpt-4o-transcribe"), "usage missing dictation");
assert(usageEvents.some((event) => event.provider === "openai" && event.model.includes("gpt-4.1")), "usage missing OpenAI/web search entries");

const finalSession = await requestJson("/api/service/session");
assert(finalSession.subscription?.status === "active", "subscription should be restored active");
assert(finalSession.entitlement?.aiEnabled === true, "AI entitlement should be restored active");

console.log("Live staging end-to-end verification passed");
console.log(JSON.stringify({
  baseUrl,
  user: finalSession.user?.email,
  subscription: finalSession.subscription?.status,
  creditRemainingPercent: finalSession.credit?.remainingPercent,
  services: serviceIds,
  chatResults,
  usageEvents: usageEvents.slice(0, 8),
}, null, 2));

async function verifyTemporarySubscriptionStatus(status) {
  const before = dockerNode(`
    import { findUserByEmail, getUserSubscription, upsertSubscriptionByUserId, pool } from './server/service-db.mjs';
    const user = await findUserByEmail(${JSON.stringify(verifyEmail)});
    const sub = await getUserSubscription(user.id);
    process.stdout.write(JSON.stringify(sub));
    await upsertSubscriptionByUserId(user.id, {
      stripeCustomerId: sub?.stripe_customer_id,
      stripeSubscriptionId: sub?.stripe_subscription_id,
      status: ${JSON.stringify(status)},
      priceId: sub?.price_id,
      currentPeriodStart: sub?.current_period_start,
      currentPeriodEnd: sub?.current_period_end,
      cancelAtPeriodEnd: sub?.cancel_at_period_end === true,
    });
    await pool.end();
  `);
  const sub = JSON.parse(before);
  try {
    const session = await requestJson("/api/service/session");
    assert(session.subscription?.status === status, `session should show ${status}, got ${session.subscription?.status}`);
    assert(session.entitlement?.aiEnabled === false, `${status} should disable AI entitlement`);
  } finally {
    dockerNode(`
      import { findUserByEmail, upsertSubscriptionByUserId, pool } from './server/service-db.mjs';
      const user = await findUserByEmail(${JSON.stringify(verifyEmail)});
      const sub = ${JSON.stringify(sub)};
      await upsertSubscriptionByUserId(user.id, {
        stripeCustomerId: sub?.stripe_customer_id,
        stripeSubscriptionId: sub?.stripe_subscription_id,
        status: sub?.status || 'active',
        priceId: sub?.price_id,
        currentPeriodStart: sub?.current_period_start,
        currentPeriodEnd: sub?.current_period_end,
        cancelAtPeriodEnd: sub?.cancel_at_period_end === true,
      });
      await pool.end();
    `);
  }
}

async function requestJson(pathOrUrl, init = {}) {
  const response = await request(pathOrUrl, init);
  const data = await readJsonOrText(response);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${pathOrUrl}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function request(pathOrUrl, init = {}) {
  const url = String(pathOrUrl).startsWith("http") ? String(pathOrUrl) : `${baseUrl}${pathOrUrl}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Cookie", cookie);
  return await fetch(url, {
    ...init,
    headers,
    redirect: init.redirect ?? "follow",
  });
}

async function readJsonOrText(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function dockerNode(script) {
  return execFileSync("docker", [
    "compose",
    "-f",
    "docker-compose.staging.yml",
    "-f",
    "docker-compose.staging.local.yml",
    "exec",
    "-T",
    "app",
    "node",
    "--input-type=module",
    "-e",
    script,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

function createSilentWav() {
  const sampleRate = 16_000;
  const durationSeconds = 1;
  const sampleCount = sampleRate * durationSeconds;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

function createMinimalAudioSdpOffer() {
  return [
    "v=0",
    "o=- 4611733059109185724 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS stream",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=ice-ufrag:abcd",
    "a=ice-pwd:abcdefghijklmnopqrstuvwxyz",
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
    "a=setup:actpass",
    "a=mid:0",
    "a=sendrecv",
    "a=msid:stream track",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "",
  ].join("\r\n");
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
