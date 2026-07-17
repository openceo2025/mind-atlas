import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";

const host = "127.0.0.1";
const providerIds = ["openai", "anthropic", "glm", "deepseek", "gemini", "qwen", "composer", "kimi", "mimo", "minimax", "grok"];
const requestedPaths = [];
let cloudOverwriteCount = 0;
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
  if (url.pathname === "/api/analytics/config") {
    sendJson(response, 200, { enabled: true });
    return;
  }
  if (url.pathname === "/api/analytics/events" && request.method === "POST") {
    collectRequestJson(request).then((body) => {
      if (!Array.isArray(body?.events) || !body.events.length) return sendJson(response, 400, { error: "events missing" });
      sendJson(response, 200, { inserted: body.events.length, duplicates: 0 });
    }).catch(() => sendJson(response, 400, { error: "invalid analytics JSON" }));
    return;
  }
  if (url.pathname === "/api/chat/options") {
    sendJson(response, 200, createMockChatOptions());
    return;
  }
  if (url.pathname === "/api/cloud/notebooks" && request.method === "GET") {
    sendJson(response, 200, {
      directory: "Mind Atlas cloud text storage",
      notebooks: [
        createMockCloudEntry("cld_verify_private", "Verify cloud notebook"),
        createMockCloudEntry("cld_verify_second", "Second cloud notebook"),
      ],
      quota: { usedBytes: 512, limitBytes: 10485760 },
    });
    return;
  }
  if (url.pathname === "/api/cloud/notebooks" && request.method === "POST") {
    sendJson(response, 200, createMockCloudEntry("cld_verify_private", "Verify cloud notebook"));
    return;
  }
  if (url.pathname.startsWith("/api/cloud/notebooks/") && url.pathname.endsWith("/share") && request.method === "POST") {
    sendJson(response, 200, {
      url: "https://mind-atlas.org/#s=verifycloudsharetoken",
      token: "verifycloudsharetoken",
      entry: createMockCloudEntry("cld_verify_private", "Verify cloud notebook", "public"),
      quota: { usedBytes: 512, limitBytes: 10485760 },
    });
    return;
  }
  if (url.pathname.startsWith("/api/cloud/notebooks/") && request.method === "PATCH") {
    cloudOverwriteCount += 1;
    collectRequestJson(request).then((body) => {
      sendJson(response, 200, {
        ...createMockCloudEntry("cld_verify_private", body?.title || "Verify cloud notebook"),
        directory: "Mind Atlas cloud text storage",
        prunedCount: 0,
        quota: { usedBytes: 512, limitBytes: 10485760 },
      });
    }).catch(() => {
      sendJson(response, 400, { error: "invalid mock JSON" });
    });
    return;
  }
  if (url.pathname.startsWith("/api/cloud/notebooks/") && request.method === "DELETE") {
    sendJson(response, 200, {
      ok: true,
      id: decodeURIComponent(url.pathname.slice("/api/cloud/notebooks/".length)),
      quota: { usedBytes: 0, limitBytes: 10485760 },
    });
    return;
  }
  if (url.pathname.startsWith("/api/cloud/notebooks/") && request.method === "GET") {
    const cloudId = decodeURIComponent(url.pathname.slice("/api/cloud/notebooks/".length));
    const title = cloudId === "cld_verify_second" ? "Second cloud notebook" : "Verify cloud notebook";
    sendJson(response, 200, {
      entry: createMockCloudEntry(cloudId, title),
      root: createMockCloudNotebookRoot(title),
    });
    return;
  }
  if (url.pathname === "/api/share/notebooks" && request.method === "POST") {
    sendJson(response, 200, {
      url: "https://mind-atlas.org/#s=verifycloudsharetoken",
      token: "verifycloudsharetoken",
      entry: createMockCloudEntry("cld_verify_public", "Verify shared notebook", "public"),
      quota: { usedBytes: 512, limitBytes: 10485760 },
    });
    return;
  }
  if (url.pathname.startsWith("/api/share/notebooks/") && request.method === "GET") {
    sendJson(response, 200, {
      entry: createMockCloudEntry("cld_verify_public", "Verify shared notebook", "public"),
      root: createMockCloudNotebookRoot(),
    });
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
    if (await page.locator(".analytics-consent").count()) throw new Error("Public mode must not show an analytics consent banner");
    const analyticsStorageKeys = await page.evaluate(() => [
      ...Object.keys(localStorage),
      ...Object.keys(sessionStorage),
    ].filter((key) => key.startsWith("mind-atlas-analytics-")));
    if (analyticsStorageKeys.length) throw new Error(`Analytics identifiers must not be persisted: ${JSON.stringify(analyticsStorageKeys)}`);
    await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).waitFor();
    await page.waitForFunction(() => document.querySelector(".ai-feature-button")?.textContent?.includes("87%"), null, { timeout: 15_000 }).catch(() => {});
    await assertNoForbiddenPublicDeveloperSurface(page, "initial public shell");

    const aiButtonText = cleanText(await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).textContent());
    if (!aiButtonText.includes("87%")) throw new Error(`AI feature button did not show credit percent: ${aiButtonText}; requests=${JSON.stringify(requestedPaths)}`);

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

    await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
    const publicMenu = page.locator(".global-context-menu");
    await publicMenu.getByText("クラウドへ保存").waitFor();
    await publicMenu.getByText("クラウドから読み込み").waitFor();
    const publicMenuOrder = await publicMenu.evaluate((menu) => Array.from(menu.children).map((child) => child.textContent?.replace(/\s+/g, " ").trim() ?? ""));
    if (!publicMenuOrder[0]?.includes("新しく始める") || !publicMenuOrder[0]?.includes("テキストのみエクスポート")) {
      throw new Error(`New start and export should begin the file section: ${JSON.stringify(publicMenuOrder)}`);
    }
    const renderQualityIndex = publicMenuOrder.findIndex((entry) => entry.includes("レンダリング品質"));
    const mobileSettingsIndex = publicMenuOrder.findIndex((entry) => entry.includes("モバイル設定"));
    const aboutIndex = publicMenuOrder.findIndex((entry) => entry.includes("Mind Atlasについて"));
    const sourceIndex = publicMenuOrder.findIndex((entry) => entry.includes("ソースコードと法的情報"));
    if (renderQualityIndex < 0 || mobileSettingsIndex !== renderQualityIndex + 1 || aboutIndex !== mobileSettingsIndex + 1 || sourceIndex !== aboutIndex + 1) {
      throw new Error(`Menu footer order is incorrect: ${JSON.stringify(publicMenuOrder)}`);
    }
    if ((await publicMenu.getByText("Export with files").count()) !== 0) {
      throw new Error("Public hosted mode exposed multimedia package export.");
    }
    await publicMenu.getByText("クラウドへ保存").click();
    const cloudDialog = page.getByRole("dialog", { name: "クラウドファイル" });
    await cloudDialog.waitFor();
    await cloudDialog.getByText("Cloud storage").waitFor();
    await cloudDialog.getByText("Save current as...").waitFor();
    await cloudDialog.getByText("Overwrite").waitFor();
    await cloudDialog.getByText("Rename").waitFor();
    await cloudDialog.getByText("Copy share link").waitFor();
    await cloudDialog.getByText("Delete").waitFor();
    await cloudDialog.getByText("Verify cloud notebook").waitFor();
    const overwriteButton = cloudDialog.getByRole("button", { name: "Overwrite" });
    if (await overwriteButton.isDisabled()) throw new Error("A selected cloud file should allow overwrite even before it is loaded in this tab.");
    page.once("dialog", (dialog) => dialog.accept());
    await overwriteButton.click();
    await page.waitForFunction(() => document.querySelector(".cloud-current-badge")?.textContent?.trim().length > 0);
    const firstOverwriteCount = cloudOverwriteCount;
    page.once("dialog", (dialog) => dialog.accept());
    await overwriteButton.click();
    await waitForCondition(() => cloudOverwriteCount > firstOverwriteCount, 3000);
    if (cloudOverwriteCount <= firstOverwriteCount) throw new Error("Cloud overwrite should save even when the notebook has no unsaved changes.");
    await page.waitForTimeout(180);
    await cloudDialog.locator(".cloud-package-button").first().click();
    await cloudDialog.getByRole("button", { name: "Load", exact: true }).click();
    await cloudDialog.waitFor({ state: "detached" });
    await page.locator(".node-body-input").fill("Unsaved hosted cloud edit");
    const shortcutOverwriteCount = cloudOverwriteCount;
    const cloudSavePrevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    if (!cloudSavePrevented) throw new Error("Ctrl+S did not prevent the browser save-page action in hosted mode.");
    await waitForCondition(() => cloudOverwriteCount > shortcutOverwriteCount, 3000);
    if (cloudOverwriteCount <= shortcutOverwriteCount) throw new Error("Ctrl+S did not overwrite the current hosted cloud notebook.");
    const shortcutSaveToast = page.locator(".context-copy-toast", { hasText: "Verify cloud notebook" });
    await shortcutSaveToast.waitFor();
    await page.locator(".node-body-input").fill("Unsaved hosted cloud edit after shortcut");
    await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
    await publicMenu.getByText("クラウドへ保存").click();
    await cloudDialog.waitFor();
    await cloudDialog.getByText("未保存の変更", { exact: true }).first().waitFor();
    if (await overwriteButton.isDisabled()) throw new Error("The currently open cloud file should allow overwrite.");
    await cloudDialog.getByText("Second cloud notebook", { exact: true }).click();
    if (await overwriteButton.isDisabled()) throw new Error("Any explicitly selected cloud file should allow confirmed overwrite.");
    await cloudDialog.getByRole("button", { name: "Load", exact: true }).click();
    const unsavedDialog = page.getByRole("alertdialog", { name: "別のクラウドファイルを開く前に変更を保存しますか？" });
    await unsavedDialog.waitFor();
    await unsavedDialog.getByRole("button", { name: "保存せず開く" }).click();
    await unsavedDialog.waitFor({ state: "detached" });
    await cloudDialog.waitFor({ state: "detached" });
    if (!requestedPaths.includes("/api/cloud/notebooks/cld_verify_second")) {
      throw new Error(`Discard-and-open did not load the selected cloud file: ${JSON.stringify(requestedPaths)}`);
    }
    await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
    await publicMenu.getByRole("button", { name: "新しく始める" }).click();
    const startSpaceDialog = page.getByRole("dialog", { name: "始め方を選ぶ" });
    await startSpaceDialog.waitFor();
    await startSpaceDialog.getByRole("heading", { name: "テンプレート", exact: true }).waitFor();
    await startSpaceDialog.getByRole("button", { name: /日常メモのスペース/ }).click();
    await startSpaceDialog.waitFor({ state: "detached" });
    await page.getByText("すぐにやること", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
    await publicMenu.getByRole("button", { name: "新しく始める" }).click();
    await startSpaceDialog.waitFor();
    await startSpaceDialog.getByRole("button", { name: /Verify cloud notebook/ }).click();
    await startSpaceDialog.waitFor({ state: "detached" });
    await page.getByText("Verify cloud notebook note", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
    const aboutLink = page.getByRole("link", { name: "Mind Atlas overview and AI plan" });
    await aboutLink.waitFor();
    if (await aboutLink.getAttribute("href") !== "/ja/about.html") {
      throw new Error(`Public app should link to the Japanese introduction page: ${await aboutLink.getAttribute("href")}`);
    }
    // Vite serves the source fallback locally; production follows the checked localized href above.
    await page.goto(`${appUrl}/about.html`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Mind Atlas", exact: true }).waitFor();
    await page.getByRole("heading", { name: "小説を書く", exact: true }).waitFor();
    if ((await page.locator(".demo-window iframe").count()) !== 3) throw new Error("About page should expose three embedded Mind Atlas examples.");
    if ((await page.locator(".view-controls button").count()) !== 4) throw new Error("About page should expose four novel view buttons.");
    await page.getByRole("heading", { name: "使い方を選ぶ" }).waitFor();
    if ((await page.locator(".plan-card").count()) !== 3) throw new Error("About page should expose three plan cards.");
    await page.getByText("テキストのみクラウドへ保存できます").waitFor();
    await page.getByText("推定困難な短い公開リンクで共有できます").waitFor();
    await page.frameLocator("#novel-frame").locator("canvas").waitFor();
    const aboutWheelFocusState = await page.frameLocator("#novel-frame").locator("canvas").evaluate(async (canvas) => {
      const appShell = document.querySelector(".app-shell");
      const before = appShell?.getAttribute("data-focus-panel") ?? "";
      for (let index = 0; index < 6; index += 1) {
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -260, bubbles: true, cancelable: true }));
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 260, bubbles: true, cancelable: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        before,
        after: appShell?.getAttribute("data-focus-panel") ?? "",
      };
    });
    if (aboutWheelFocusState.before !== "closed" || aboutWheelFocusState.after !== "closed") {
      throw new Error(`About embedded wheel should not auto-focus nodes: ${JSON.stringify(aboutWheelFocusState)}`);
    }
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
    const aboutTouchScrollState = await verifyAboutEmbeddedTouchScroll(browser);
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
    await exhaustedPage.getByLabel("Mind Atlasメニューを開く").click();
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
    if (!/read-only|読み取り専用/.test(exhaustedLogText)) {
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
    console.log(JSON.stringify({ aiButtonText, exhaustedButtonText, modeButtonCount, scopeSelectCount, serviceOptions, aboutTouchScrollState, requestedPaths: Array.from(new Set(requestedPaths)) }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  stopChild(vite);
  await closeServer(mockService);
}

async function verifyAboutEmbeddedTouchScroll(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(`${appUrl}/about.html`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "小説を書く", exact: true }).scrollIntoViewIfNeeded();
    await page.frameLocator("#novel-frame").locator("canvas").waitFor();
    const before = await page.evaluate(() => window.scrollY);
    const pointerState = await page.frameLocator("#novel-frame").locator("canvas").evaluate(async (canvas) => {
      const dispatch = (type, y) => {
        const event = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 44,
          pointerType: "touch",
          isPrimary: true,
          clientX: 180,
          clientY: y,
          screenX: 180,
          screenY: y,
        });
        canvas.dispatchEvent(event);
        return event.defaultPrevented;
      };
      dispatch("pointerdown", 520);
      const prevented = [];
      for (const y of [480, 440, 400, 360]) {
        prevented.push(dispatch("pointermove", y));
        await new Promise((resolve) => setTimeout(resolve, 24));
      }
      dispatch("pointerup", 360);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        appShell: document.querySelector(".app-shell")?.getAttribute("data-about-demo") ?? "",
        prevented,
      };
    });
    await page.waitForTimeout(180);
    const after = await page.evaluate(() => window.scrollY);
    if (after <= before + 60) {
      throw new Error(`About embedded touch scroll did not move the parent page enough: ${JSON.stringify({ before, after, pointerState })}`);
    }
    if (!pointerState.prevented.some(Boolean)) {
      throw new Error(`About embedded touch scroll did not prevent iframe gesture defaults: ${JSON.stringify(pointerState)}`);
    }
    return { before, after, delta: after - before, pointerState };
  } finally {
    await context.close();
  }
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

function createMockCloudEntry(id, title, visibility = "private") {
  return {
    id,
    name: `${title}.mindatlas`,
    title,
    size: 512,
    updatedAt: new Date().toISOString(),
    visibility,
    ...(visibility === "public" ? { shareToken: "verifycloudsharetoken" } : {}),
  };
}

function createMockCloudNotebookRoot(title = "Verify cloud notebook") {
  const now = new Date().toISOString();
  const childId = title === "Second cloud notebook" ? "verify-cloud-second-child" : "verify-cloud-child";
  return {
    id: "atlas-root",
    kind: "root",
    nodeType: "note",
    title,
    subtitle: title,
    body: "",
    author: "human",
    status: "waiting",
    color: "#6f8cff",
    texture: "speckled",
    radius: 80,
    summary: "",
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    position: [0, 0, 0],
    children: [{
      id: childId,
      kind: "thread",
      nodeType: "note",
      title: `${title} note`,
      subtitle: `${title} note`,
      body: "Cloud note body",
      author: "human",
      status: "waiting",
      color: "#8df5cf",
      texture: "speckled",
      radius: 28,
      summary: "Cloud note body",
      nextDecision: "",
      tags: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
      children: [],
    }],
  };
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function collectRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
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
    () => chromium.launch({ headless: true, args: ["--lang=ja-JP"] }),
    () => chromium.launch({ channel: "msedge", headless: true, args: ["--lang=ja-JP"] }),
    () => chromium.launch({ channel: "chrome", headless: true, args: ["--lang=ja-JP"] }),
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

async function waitForCondition(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for verification condition.");
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
