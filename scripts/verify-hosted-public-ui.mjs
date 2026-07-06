import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";

const host = "127.0.0.1";
const providerIds = ["openai", "anthropic", "glm", "deepseek", "gemini", "qwen", "composer", "kimi", "mimo", "minimax", "grok"];
const requestedPaths = [];
let mockSessionMode = "active";
const forbiddenPublicDeveloperTerms = [
  "Codex",
  "Claude Code",
  "OpenClaw",
  "Local",
  "Code settings",
  "OpenClaw settings",
  "AI context scope",
  "Codex Work root",
];

const mockService = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}`);
  requestedPaths.push(url.pathname);
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "mock-mind-atlas-service" });
    return;
  }
  if (url.pathname === "/api/service/session") {
    sendJson(response, 200, createMockSession());
    return;
  }
  if (url.pathname === "/api/chat/options") {
    sendJson(response, 200, createMockChatOptions());
    return;
  }
  sendJson(response, 404, { error: "mock route not found" });
});

const mockPort = await listenOnRandomPort(mockService);
const vitePort = await getFreePort();
const serviceUrl = `http://${host}:${mockPort}`;
const appUrl = `http://${host}:${vitePort}`;
const viteCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const viteArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", `npm run dev -- --host ${host} --port ${vitePort} --strictPort`]
  : ["run", "dev", "--", "--host", host, "--port", String(vitePort), "--strictPort"];
const vite = spawn(viteCommand, viteArgs, {
  cwd: process.cwd(),
  env: cleanEnv({
    ...process.env,
    VITE_MIND_ATLAS_PUBLIC_SERVICE: "true",
    VITE_MIND_ATLAS_SERVICE_URL: serviceUrl,
  }),
  stdio: ["ignore", "pipe", "pipe"],
});

let viteOutput = "";
vite.stdout.on("data", (chunk) => {
  viteOutput += chunk.toString();
});
vite.stderr.on("data", (chunk) => {
  viteOutput += chunk.toString();
});

try {
  await waitForHttp(appUrl, 20_000);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
    await seedCompletedOnboarding(page);
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).waitFor();
    await assertNoForbiddenPublicDeveloperSurface(page, "initial public shell");

    const aiButtonText = cleanText(await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).textContent());
    if (!aiButtonText.includes("87%")) throw new Error(`AI feature button did not show credit percent: ${aiButtonText}`);

    await page.locator(".ai-panel-role").getByText("AI").waitFor();
    const modeButtonCount = await page.locator(".mode-switch button").count();
    if (modeButtonCount !== 0) throw new Error(`Public mode should hide Chat/Code/OpenClaw mode buttons: ${modeButtonCount}`);
    const scopeSelectCount = await page.locator(".scope-select").count();
    if (scopeSelectCount !== 0) throw new Error(`Public mode should hide AI context scope selector: ${scopeSelectCount}`);

    const serviceSelect = page.locator(".chat-options-row select").first();
    await serviceSelect.waitFor();
    const serviceOptions = await serviceSelect.locator("option").evaluateAll((options) => options.map((option) => option.value));
    for (const providerId of providerIds) {
      if (!serviceOptions.includes(providerId)) throw new Error(`Chat service selector is missing ${providerId}: ${JSON.stringify(serviceOptions)}`);
    }

    await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).click();
    await page.locator(".ai-feature-dialog").waitFor();
    await page.locator(".ai-usage-guide-card").waitFor();
    await page.locator(".ai-credit-card > div:first-child span").waitFor();
    await page.locator(".ai-credit-card strong", { hasText: "87%" }).waitFor();
    await page.locator(".ai-credit-renewal", { hasText: "次回更新日:" }).waitFor();
    await assertNoForbiddenPublicDeveloperSurface(page, "active public AI dialog");
    const oldCapabilityCopyCount = await page.getByText(/Chat \/ web search \/ Dictation \/ Realtime Talk/).count();
    if (oldCapabilityCopyCount !== 0) throw new Error("Public AI dialog exposed old capability-list copy.");

    await page.getByRole("button", { name: "Open atlas menu" }).click();
    await page.getByRole("link", { name: "Mind Atlas overview and AI plan" }).waitFor();
    await page.getByRole("link", { name: "Mind Atlas overview and AI plan" }).click();
    await page.waitForURL(/\/about\.html$/);
    await page.getByRole("heading", { name: "Mind Atlas", exact: true }).waitFor();
    await page.getByRole("heading", { name: "小説を書く", exact: true }).waitFor();
    if ((await page.locator(".demo-window iframe").count()) !== 3) throw new Error("About page should expose three embedded Mind Atlas examples.");
    if ((await page.locator(".view-controls button").count()) !== 4) throw new Error("About page should expose four novel view buttons.");
    await page.frameLocator("#novel-frame").locator("canvas").waitFor();
    await page.getByRole("button", { name: /MindMap/ }).click();
    await page.frameLocator("#novel-frame").locator(".app-shell.is-about-demo-view-mind-map").waitFor();
    await page.getByRole("button", { name: /Tree/ }).click();
    await page.frameLocator("#novel-frame").locator(".app-shell.is-about-demo-view-tree").waitFor();
    await page.getByRole("button", { name: /Editor/ }).click();
    await page.frameLocator("#novel-frame").locator(".outline-editor-shell").waitFor();
    await page.getByRole("heading", { name: /旅行計画を立てる/ }).scrollIntoViewIfNeeded();
    const travelFrame = page.frameLocator('iframe[title="Mind Atlas travel planning example"]');
    await travelFrame.locator("canvas").waitFor();
    await travelFrame.locator(".unread-notification-link").first().waitFor();
    await travelFrame.locator(".unread-notification-link").first().click();
    await travelFrame.locator(".attachment-preview img[alt='travel-pass-qr.svg']").waitFor();
    await page.getByRole("heading", { name: /アプリ開発のメモ/ }).scrollIntoViewIfNeeded();
    const appFrame = page.frameLocator('iframe[title="Mind Atlas app development AI example"]');
    await appFrame.locator(".command-dock").waitFor();
    const appDemoCommandPointerEvents = await appFrame.locator(".command-dock").evaluate((element) => getComputedStyle(element).pointerEvents);
    if (appDemoCommandPointerEvents !== "auto") throw new Error(`About AI demo command dock should allow demo selectors: ${appDemoCommandPointerEvents}`);
    const appDemoSendPointerEvents = await appFrame.locator(".send-button").evaluate((element) => getComputedStyle(element).pointerEvents);
    if (appDemoSendPointerEvents !== "none") throw new Error(`About AI demo send button should be inert: ${appDemoSendPointerEvents}`);
    await appFrame.locator(".provider-usage-panel", { hasText: "AIトークン残高" }).waitFor();
    const aboutServiceOptions = await appFrame.locator(".chat-options-row select").first().locator("option").evaluateAll((options) => options.map((option) => option.textContent?.trim() ?? ""));
    for (const expectedProvider of ["OpenAI", "Claude", "DeepSeek", "GLM", "Gemini", "Grok"]) {
      if (!aboutServiceOptions.some((option) => option.includes(expectedProvider))) {
        throw new Error(`About AI demo missing provider ${expectedProvider}: ${JSON.stringify(aboutServiceOptions)}`);
      }
    }
    const aboutLoginControlCount = await page.locator('a[href*="/api/auth"], button:has-text("Login"), button:has-text("Sign in")').count();
    if (aboutLoginControlCount !== 0) throw new Error(`About page should not expose login/sign-in controls: ${aboutLoginControlCount}`);
    await page.getByRole("link", { name: /MindAtlasに飛び込もう|Mind Atlasを使ってみる/ }).first().click();
    await page.waitForURL((nextUrl) => !nextUrl.pathname.endsWith("/about.html"));
    /*
    await page.getByRole("heading", { name: /考えを、動かせる宇宙にする/ }).waitFor();
    if ((await page.locator(".sample-tab").count()) !== 3) throw new Error("About page should expose three touchable examples.");
    if ((await page.locator(".view-button").count()) !== 4) throw new Error("About page should expose four novel view buttons.");
    await page.getByRole("button", { name: /Mind map/ }).click();
    await page.getByRole("button", { name: /Tree/ }).click();
    await page.getByRole("button", { name: /Editor/ }).click();
    await page.locator(".editor-view.is-visible").waitFor();
    await page.getByRole("tab", { name: /旅行の計画/ }).click();
    await page.locator(".notification-card.is-visible").waitFor();
    await page.getByRole("button", { name: /通知ノードを見る/ }).click();
    const aboutTravelSelection = cleanText(await page.locator("#foot-title").textContent());
    if (!aboutTravelSelection.includes("新幹線")) throw new Error(`Travel example notification did not focus train node: ${aboutTravelSelection}`);
    await page.getByRole("tab", { name: /アプリ開発/ }).click();
    await page.locator(".ai-dock.is-visible").waitFor();
    if (!(await page.locator(".ai-input input").isDisabled())) throw new Error("About AI demo input must be disabled.");
    if (!(await page.locator(".ai-input button").isDisabled())) throw new Error("About AI demo send button must be disabled.");
    const aboutText = cleanText(await page.locator("body").textContent());
    if (/ログイン|サインイン|sign in|login/i.test(aboutText)) throw new Error("About page should not expose login/sign-in copy.");
    await page.getByRole("link", { name: /Mind Atlasを使ってみる/ }).first().click();
    await page.waitForURL((nextUrl) => !nextUrl.pathname.endsWith("/about.html"));

    */
    mockSessionMode = "exhausted";
    const exhaustedPage = await browser.newPage({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
    await seedCompletedOnboarding(exhaustedPage);
    await seedVoiceLog(exhaustedPage);
    await exhaustedPage.goto(appUrl, { waitUntil: "networkidle" });
    await exhaustedPage.waitForSelector("canvas");
    await exhaustedPage.getByRole("button", { name: /AI\u6a5f\u80fd/ }).waitFor();
    await assertNoForbiddenPublicDeveloperSurface(exhaustedPage, "exhausted public shell");
    const exhaustedButtonText = cleanText(await exhaustedPage.getByRole("button", { name: /AI\u6a5f\u80fd/ }).textContent());
    if (!exhaustedButtonText.includes("0%")) throw new Error(`Exhausted AI feature button did not show 0%: ${exhaustedButtonText}`);
    await exhaustedPage.getByLabel("Open atlas menu").click();
    const exhaustedMenu = exhaustedPage.locator(".global-context-menu");
    await exhaustedMenu.getByText("AI Partner log").waitFor();
    if ((await exhaustedMenu.getByText("Voice settings").count()) !== 0) throw new Error("Exhausted public mode exposed Voice settings.");
    if ((await exhaustedMenu.getByText("Restart Realtime").count()) !== 0) throw new Error("Exhausted public mode exposed Realtime restart.");
    await exhaustedMenu.getByText("AI Partner log").click();
    await exhaustedPage.getByRole("dialog", { name: "AI Partner log" }).waitFor();
    const headerTitleBox = await exhaustedPage.locator(".voice-log-header h2").boundingBox();
    const closeButtonBox = await exhaustedPage.getByLabel("Close AI Partner log").boundingBox();
    if (!headerTitleBox || headerTitleBox.width < 120) {
      throw new Error(`Exhausted public mode AI Partner log header is cramped: ${JSON.stringify(headerTitleBox)}`);
    }
    if (!closeButtonBox || closeButtonBox.x < headerTitleBox.x + headerTitleBox.width) {
      throw new Error(`Exhausted public mode close button overlaps the title: ${JSON.stringify({ headerTitleBox, closeButtonBox })}`);
    }
    const exhaustedLogText = await exhaustedPage.getByRole("dialog", { name: "AI Partner log" }).innerText();
    if (!exhaustedLogText.includes("Fable5 reply after depletion")) {
      throw new Error(`Exhausted public mode did not show saved AI Partner log: ${exhaustedLogText}`);
    }
    if (!exhaustedLogText.includes("read-only")) {
      throw new Error(`Exhausted public mode AI Partner log should be read-only: ${exhaustedLogText}`);
    }
    if ((await exhaustedPage.getByLabel("Clear AI Partner log").count()) !== 0) {
      throw new Error("Exhausted public mode exposed the AI Partner log clear button.");
    }
    await exhaustedPage.close();

    if (requestedPaths.includes("/api/codex/options")) throw new Error("Public mode requested Codex options.");
    if (requestedPaths.includes("/api/openclaw/options")) throw new Error("Public mode requested OpenClaw options.");
    if (requestedPaths.some((path) => /^\/api\/(?:codex|openclaw)\//.test(path))) {
      throw new Error(`Public mode requested local developer API routes: ${JSON.stringify(requestedPaths)}`);
    }

    console.log("Hosted public UI verification passed");
    console.log(JSON.stringify({ aiButtonText, exhaustedButtonText, modeButtonCount, scopeSelectCount, serviceOptions, requestedPaths: Array.from(new Set(requestedPaths)) }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  stopChild(vite);
  await closeServer(mockService);
}

function createMockSession() {
  const exhausted = mockSessionMode === "exhausted";
  return {
    publicService: true,
    authenticated: true,
    user: {
      id: "usr_verify",
      email: "verify@example.com",
      name: "Verify User",
      pictureUrl: "",
      role: "user",
    },
    subscription: {
      status: "active",
      currentPeriodStart: "2026-06-30T00:00:00.000Z",
      currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    },
    credit: {
      periodKey: "2026-06-30",
      remainingPercent: exhausted ? 0 : 87,
      limitPercent: 100,
      exhausted,
      updatedAt: new Date().toISOString(),
    },
    entitlement: {
      aiEnabled: !exhausted,
      reason: exhausted ? "credit_exhausted" : "active",
    },
    chatOptions: createMockChatOptions(),
  };
}

function createMockChatOptions() {
  return {
    defaultService: "openai",
    services: providerIds.map((id) => ({
      id,
      label: providerLabel(id),
      configured: true,
      defaultModel: `${id}-verify-model`,
      defaultReasoningEffort: "default",
      supportedReasoningEfforts: ["default", "low", "medium", "high"],
      models: [{
        model: `${id}-verify-model`,
        displayName: `${providerLabel(id)} verify`,
        defaultReasoningEffort: "default",
        supportedReasoningEfforts: ["default", "low", "medium", "high"],
      }],
    })),
  };
}

function providerLabel(id) {
  return {
    openai: "OpenAI",
    anthropic: "Anthropic",
    glm: "GLM",
    deepseek: "DeepSeek",
    gemini: "Gemini",
    qwen: "Qwen",
    composer: "Composer",
    kimi: "Kimi",
    mimo: "Mimo",
    minimax: "MiniMax",
    grok: "Grok",
  }[id] ?? id;
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function assertNoForbiddenPublicDeveloperSurface(page, label) {
  const surface = await page.evaluate(() => {
    const selectors = [
      "button",
      "select",
      "option",
      "label",
      "input",
      "textarea",
      "[aria-label]",
      "[title]",
      ".mode-switch",
      ".code-options-row",
      ".openclaw-options-row",
      ".scope-select",
    ];
    return [...document.querySelectorAll(selectors.join(","))]
      .map((element) => [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("placeholder"),
        element.getAttribute("value"),
      ].filter(Boolean).join(" "))
      .join("\n");
  });
  const leaked = forbiddenPublicDeveloperTerms.filter((term) => surface.includes(term));
  if (leaked.length) {
    throw new Error(`Public mode exposed local developer surface during ${label}: ${leaked.join(", ")}`);
  }
}

async function seedCompletedOnboarding(page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "mind-atlas-onboarding-v1",
      JSON.stringify({
        version: 1,
        firstRun: false,
        rootNodeCreated: true,
        pan: true,
        zoom: true,
        nodeDrag: true,
        childNodeCreated: true,
        spaceBasicsCompleted: true,
        basicCompleted: true,
        aiUnlocked: true,
        titlePromptApplied: true,
        startedAt: now,
        completedAt: now,
      }),
    );
  });
}

async function seedVoiceLog(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mind-atlas-voice-log-v1",
      JSON.stringify([
        {
          id: "voice-log-fable5-verify",
          role: "assistant",
          title: "AI Partner (Claude Fable 5)",
          text: "Fable5 reply after depletion",
          status: "done",
          createdAt: new Date().toISOString(),
          metadata: {
            provider: "anthropic",
            model: "claude-fable-5",
          },
        },
      ]),
    );
    window.localStorage.setItem("mind-atlas-voice-log-last-seen-v1", "2000-01-01T00:00:00.000Z");
  });
}

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ headless: true }),
    () => chromium.launch({ channel: "msedge", headless: true }),
    () => chromium.launch({ channel: "chrome", headless: true }),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function listenOnRandomPort(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate mock service port");
  return address.port;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  await closeServer(server);
  if (!address || typeof address === "string") throw new Error("Could not allocate Vite port");
  return address.port;
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite exited before startup with ${vite.exitCode}\n${viteOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}\n${viteOutput}`);
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanEnv(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key && !key.includes("=") && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}
