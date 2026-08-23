import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const hardTimeoutMs = Number(process.env.MIND_ATLAS_HOSTED_UI_TIMEOUT_MS || 180_000);
const host = "127.0.0.1";
const providerIds = ["openai", "anthropic", "glm", "deepseek", "gemini", "qwen", "composer", "kimi", "mimo", "minimax", "grok"];
const requestedPaths = [];
const shogiAnalysisRequests = [];
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
  if (url.pathname === "/api/board-records/shogi/analyze" && request.method === "POST") {
    collectRequestJson(request).then((body) => {
      const sfen = String(body?.sfen ?? "");
      if (!sfen) return sendJson(response, 400, { error: "sfen missing" });
      shogiAnalysisRequests.push(sfen);
      sendJson(response, 200, createMockShogiAnalysis(sfen));
    }).catch(() => sendJson(response, 400, { error: "invalid analysis JSON" }));
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
const require = createRequire(import.meta.url);
const vitePackageDirectory = path.dirname(require.resolve("vite/package.json"));
const viteEntryPath = path.join(vitePackageDirectory, "bin", "vite.js");
const vite = spawn(process.execPath, [
  viteEntryPath,
  "--configLoader",
  "runner",
  "--host",
  host,
  "--port",
  String(vitePort),
  "--strictPort",
], {
  cwd: process.cwd(),
  env: cleanEnv({
    ...process.env,
    VITE_MIND_ATLAS_PUBLIC_SERVICE: "true",
    VITE_MIND_ATLAS_SERVICE_URL: serviceUrl,
  }),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const hardTimeout = setTimeout(() => {
  console.error(`Hosted public UI verification exceeded ${hardTimeoutMs}ms and was terminated.`);
  terminateChildNow(vite);
  process.exit(1);
}, hardTimeoutMs);
hardTimeout.unref();

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
    mockSessionMode = "signed-out";
    const signedOutPage = await browser.newPage({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
    await seedCompletedOnboarding(signedOutPage);
    await signedOutPage.goto(appUrl, { waitUntil: "networkidle" });
    await signedOutPage.waitForSelector("canvas");
    const signedOutButton = signedOutPage.locator(".ai-feature-button");
    await signedOutButton.waitFor();
    const signedOutButtonText = cleanText(await signedOutButton.textContent());
    const signedOutFeatureLabel = cleanText(await signedOutButton.locator("span").textContent());
    if (!signedOutButtonText.includes("クラウド保存・共有")) {
      throw new Error(`Signed-out public button should describe cloud save and sharing: ${signedOutButtonText}`);
    }
    await signedOutButton.click();
    const signedOutDialog = signedOutPage.locator(".ai-feature-dialog");
    await signedOutDialog.waitFor();
    const signedOutDialogText = cleanText(await signedOutDialog.textContent());
    for (const forbidden of ["Mind Atlas Pro", "US$10", "/ month", "月額登録"]) {
      if (signedOutDialogText.includes(forbidden)) {
        throw new Error(`Signed-out Google login dialog exposed paid-plan copy (${forbidden}): ${signedOutDialogText}`);
      }
    }
    for (const required of ["データをクラウドへ保存する", "共有リンクを作成する", "課金が始まることはありません"]) {
      if (!signedOutDialogText.includes(required)) {
        throw new Error(`Signed-out Google login dialog is missing ${required}: ${signedOutDialogText}`);
      }
    }
    await signedOutPage.close();

    const sharedSignedOutPage = await browser.newPage({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
    await seedCompletedOnboarding(sharedSignedOutPage);
    await sharedSignedOutPage.goto(`${appUrl}/#s=verifycloudsharetoken`, { waitUntil: "networkidle" });
    await sharedSignedOutPage.waitForSelector("canvas");
    await sharedSignedOutPage.locator(".dataset-title-input").waitFor();
    try {
      await sharedSignedOutPage.waitForFunction(
        () => document.querySelector(".dataset-title-input")?.value.includes("Verify cloud notebook"),
        undefined,
        { timeout: 15_000 },
      );
    } catch (error) {
      console.error("Shared-link debug", {
        title: await sharedSignedOutPage.locator(".dataset-title-input").inputValue(),
        dialogCount: await sharedSignedOutPage.locator(".shared-notebook-dialog").count(),
        body: (await sharedSignedOutPage.locator("body").innerText()).slice(0, 500),
        requests: requestedPaths.slice(-10),
        storedRootTitle: await sharedSignedOutPage.evaluate(() => {
          try { return JSON.parse(localStorage.getItem("mind-atlas-notebook-v2") || "null")?.title ?? null; } catch { return null; }
        }),
      });
      throw error;
    }
    const sharedTitle = await sharedSignedOutPage.locator(".dataset-title-input").inputValue();
    if (!sharedTitle.includes("Verify cloud notebook")) {
      throw new Error(`Signed-out shared link did not import directly: ${sharedTitle}`);
    }
    if (await sharedSignedOutPage.locator(".shared-notebook-dialog").count() !== 0) {
      throw new Error("Signed-out shared link should not show the import confirmation dialog.");
    }
    await sharedSignedOutPage.close();

    const signedOutMobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
      isMobile: true,
      hasTouch: true,
    });
    await seedCompletedOnboarding(signedOutMobilePage);
    await seedHostedMobileEditorNotebook(signedOutMobilePage);
    await signedOutMobilePage.goto(appUrl, { waitUntil: "networkidle" });
    await signedOutMobilePage.waitForSelector("canvas");
    const mobileHeaderState = await signedOutMobilePage.evaluate(() => {
      const title = document.querySelector(".dataset-title-input");
      const menu = document.querySelector(".global-menu");
      const accountButton = document.querySelector(".top-account-feature-button");
      if (!(title instanceof HTMLElement) || !(menu instanceof HTMLElement) || !(accountButton instanceof HTMLElement)) {
        return { ok: false, reason: "missing mobile header elements" };
      }
      const titleRect = title.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const overlaps = titleRect.left < menuRect.right && titleRect.right > menuRect.left && titleRect.top < menuRect.bottom && titleRect.bottom > menuRect.top;
      return {
        ok: window.getComputedStyle(accountButton).display === "none" && !overlaps,
        accountDisplay: window.getComputedStyle(accountButton).display,
        titleRect: { left: titleRect.left, right: titleRect.right, top: titleRect.top, bottom: titleRect.bottom },
        menuRect: { left: menuRect.left, right: menuRect.right, top: menuRect.top, bottom: menuRect.bottom },
      };
    });
    if (!mobileHeaderState.ok) throw new Error(`Mobile hosted header still overlaps: ${JSON.stringify(mobileHeaderState)}`);

    await signedOutMobilePage.locator(".global-menu > .icon-button").last().click();
    const mobileAccountMenuButton = signedOutMobilePage.locator(".global-context-menu > .mobile-menu-account-feature");
    await mobileAccountMenuButton.waitFor({ state: "visible" });
    const mobileAccountMenuText = cleanText(await mobileAccountMenuButton.textContent());
    if (!mobileAccountMenuText.includes(signedOutFeatureLabel)) {
      throw new Error(`Mobile account entry is missing from the top of the submenu: ${mobileAccountMenuText}`);
    }
    const mobileMenuFirstClass = await signedOutMobilePage.locator(".global-context-menu > :first-child").getAttribute("class");
    if (!mobileMenuFirstClass?.includes("mobile-menu-account-feature")) {
      throw new Error(`Mobile account entry is not first in the submenu: ${mobileMenuFirstClass}`);
    }
    await mobileAccountMenuButton.click();
    await signedOutMobilePage.locator(".ai-feature-dialog").waitFor();
    await signedOutMobilePage.locator(".ai-feature-dialog .icon-button").click();

    await signedOutMobilePage.waitForSelector('.space-title-preview[data-node-id="hosted-mobile-child"]', { state: "visible" });
    await signedOutMobilePage.tap('.space-title-preview[data-node-id="hosted-mobile-child"]');
    await signedOutMobilePage.waitForSelector(".mobile-workspace-panel.is-single-editor");
    await signedOutMobilePage.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    const mobileEditorState = await signedOutMobilePage.evaluate(() => {
      const panel = document.querySelector(".mobile-workspace-panel.is-single-editor");
      const focusPanel = panel?.querySelector(".focus-panel.is-text-only");
      const title = focusPanel?.querySelector(".node-title-input");
      const body = focusPanel?.querySelector(".node-body-input");
      if (!(panel instanceof HTMLElement) || !(focusPanel instanceof HTMLElement) || !(title instanceof HTMLTextAreaElement) || !(body instanceof HTMLTextAreaElement)) {
        return { ok: false, reason: "missing compact hosted editor" };
      }
      const panelRect = panel.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const tabCount = panel.querySelectorAll(".mobile-workspace-tabs").length;
      const previewCount = focusPanel.querySelectorAll(".panel-preview-area").length;
      return {
        ok:
          tabCount === 0 &&
          previewCount === 0 &&
          panelRect.height <= 190 &&
          title.rows === 1 &&
          titleRect.height <= 38 &&
          bodyRect.height >= 50 &&
          bodyRect.height <= 64 &&
          body.scrollHeight > body.clientHeight,
        tabCount,
        previewCount,
        panelHeight: panelRect.height,
        titleHeight: titleRect.height,
        bodyHeight: bodyRect.height,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
      };
    });
    if (!mobileEditorState.ok) throw new Error(`Hosted mobile editor is not compact: ${JSON.stringify(mobileEditorState)}`);
    await signedOutMobilePage.close();

    // Engine analysis is a signed-in feature, so the board checks run against
    // an authenticated session rather than the signed-out shell above.
    mockSessionMode = "active";
    await verifyHostedBoardImport(browser);
    await verifyDirectShogiLaunch(browser);

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
    const publicMenuOrder = await publicMenu.evaluate((menu) =>
      Array.from(menu.children)
        .filter((child) => child instanceof HTMLElement && window.getComputedStyle(child).display !== "none")
        .map((child) => child.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    );
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
    await page.waitForFunction(() => {
      const dialog = document.querySelector(".cloud-load-dialog");
      const button = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent?.trim() === "Overwrite");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
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
    await startSpaceDialog.getByRole("heading", { name: "何を始めますか？", exact: true }).waitFor();
    if (await startSpaceDialog.getByRole("button").filter({ has: page.locator(".start-space-mode-icon") }).count() !== 4) {
      throw new Error("New space should expose four notebook mode choices before templates.");
    }
    for (const mode of ["standard", "shogi", "go", "chess"]) {
      if (await startSpaceDialog.locator(`.start-space-mode-icon.is-${mode}`).count() !== 1) {
        throw new Error(`New space is missing its dedicated ${mode} icon.`);
      }
    }
    await startSpaceDialog.getByRole("button", { name: /空白のスペース/ }).click();
    await startSpaceDialog.getByRole("heading", { name: "テンプレート", exact: true }).waitFor();
    await startSpaceDialog.getByRole("button", { name: /日常メモのスペース/ }).click();
    await startSpaceDialog.waitFor({ state: "detached" });
    await page.getByText("すぐにやること", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
    await publicMenu.getByRole("button", { name: "新しく始める" }).click();
    await startSpaceDialog.waitFor();
    await startSpaceDialog.getByRole("heading", { name: "何を始めますか？", exact: true }).waitFor();
    await startSpaceDialog.getByRole("button", { name: /空白のスペース/ }).click();
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
    await page.getByRole("heading", { name: "ChatGPTで調べたことを、会話のまま埋もれさせない。", exact: true }).waitFor();
    await page.getByRole("heading", { name: "調べたことを整理する", exact: true }).waitFor();
    if ((await page.locator(".demo-window iframe").count()) !== 3) throw new Error("About page should expose three embedded Mind Atlas examples.");
    if ((await page.locator(".view-controls button").count()) !== 4) throw new Error("About page should expose four research view buttons.");
    await page.getByRole("heading", { name: "使い方を選ぶ" }).waitFor();
    if ((await page.locator(".plan-card").count()) !== 3) throw new Error("About page should expose three plan cards.");
    await page.getByText("テキストのみクラウドへ保存できます").waitFor();
    await page.getByText("推定困難な短い公開リンクで共有できます").waitFor();
    await page.frameLocator("#research-frame").locator("canvas").waitFor();
    const aboutWheelFocusState = await page.frameLocator("#research-frame").locator("canvas").evaluate(async (canvas) => {
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
    await page.frameLocator("#research-frame").locator(".app-shell.is-about-demo-view-mind-map").waitFor();
    await page.getByRole("button", { name: /Tree/ }).click();
    await page.frameLocator("#research-frame").locator(".app-shell.is-about-demo-view-tree").waitFor();
    await page.getByRole("button", { name: /Editor/ }).click();
    await page.frameLocator("#research-frame").locator(".outline-editor-shell").waitFor();
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
    console.log(JSON.stringify({ signedOutButtonText, aiButtonText, exhaustedButtonText, modeButtonCount, scopeSelectCount, serviceOptions, aboutTouchScrollState, requestedPaths: Array.from(new Set(requestedPaths)) }, null, 2));
  } finally {
    await closeBrowser(browser);
  }
} finally {
  await stopChild(vite);
  await closeServer(mockService);
  await waitForPortClosed(vitePort, 5_000);
}
clearTimeout(hardTimeout);
process.exit(0);

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
    await page.getByRole("heading", { name: "調べたことを整理する", exact: true }).scrollIntoViewIfNeeded();
    const researchFrame = page.frameLocator("#research-frame");
    await researchFrame.locator("canvas").waitFor();
    const touchLayer = page.locator('.demo-touch-layer[data-frame-id="research-frame"]');
    await touchLayer.waitFor({ state: "visible" });
    const nodeLabel = researchFrame.locator('.space-title-preview[data-node-id="about-research-options"]');
    await nodeLabel.waitFor({ state: "visible" });
    let nodeBox = await nodeLabel.boundingBox();
    if (!nodeBox) throw new Error("Could not locate research node through the embedded frame.");
    const viewportHeight = page.viewportSize()?.height ?? 844;
    const nodeCenterY = nodeBox.y + nodeBox.height / 2;
    if (nodeCenterY > viewportHeight - 48 || nodeCenterY < 48) {
      await page.evaluate((deltaY) => window.scrollBy({ top: deltaY, behavior: "instant" }), nodeCenterY - viewportHeight * 0.68);
      await page.waitForTimeout(100);
      nodeBox = await nodeLabel.boundingBox();
      if (!nodeBox) throw new Error("Research node left the viewport after parent page scrolling.");
    }
    await page.mouse.click(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await researchFrame.locator('.app-shell[data-focus-panel="open"]').waitFor();

    const before = await page.evaluate(() => window.scrollY);
    const layerBox = await touchLayer.boundingBox();
    if (!layerBox) throw new Error("Could not locate the parent-owned demo touch layer.");
    const x = Math.round(layerBox.x + layerBox.width * 0.5);
    const startY = Math.round(layerBox.y + layerBox.height * 0.72);
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY, id: 91, radiusX: 4, radiusY: 4, force: 1 }],
    });
    for (const delta of [38, 78, 118, 158, 198]) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: startY - delta, id: 91, radiusX: 4, radiusY: 4, force: 1 }],
      });
      await page.waitForTimeout(28);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(220);
    const after = await page.evaluate(() => window.scrollY);
    const pointerState = await touchLayer.evaluate((layer) => ({
      touchAction: getComputedStyle(layer).touchAction,
      pointerEvents: getComputedStyle(layer).pointerEvents,
    }));
    if (after <= before + 60) {
      throw new Error(`About embedded touch scroll did not move the parent page enough: ${JSON.stringify({ before, after, pointerState })}`);
    }
    if (pointerState.touchAction !== "pan-y" || pointerState.pointerEvents === "none") {
      throw new Error(`About demo touch layer does not delegate vertical gestures to the page: ${JSON.stringify(pointerState)}`);
    }
    return { before, after, delta: after - before, nodeTapForwarded: true, pointerState };
  } finally {
    await context.close();
  }
}

async function verifyHostedBoardImport(browser) {
  const cases = [
    {
      name: "fixture.kif",
      extension: ".kif",
      content: "#KIF version=2.0\n\n手合割：平手\n\n手数----指手---------\n   1 ７六歩(77)\n   2 ３四歩(33)\n",
      mode: "shogi",
      viewer: ".shogi-viewer",
    },
    {
      name: "fixture.pgn",
      extension: ".pgn",
      content: "1. e4 e5 2. Nf3 *",
      mode: "chess",
      viewer: ".chess-viewer",
    },
    {
      name: "fixture.sgf",
      extension: ".sgf",
      content: "(;GM[1]FF[4]SZ[9];B[dd];W[cc])",
      mode: "go",
      viewer: ".go-viewer",
    },
  ];

  for (const fixture of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await seedCompletedOnboarding(page);
      await page.goto(appUrl, { waitUntil: "networkidle" });
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
      const input = page.locator("input[type=file]");
      const accept = await input.getAttribute("accept");
      if (!accept?.includes(fixture.extension)) {
        throw new Error(`Hosted import selector is missing ${fixture.extension}: ${accept}`);
      }
      await input.setInputFiles({ name: fixture.name, mimeType: "text/plain", buffer: Buffer.from(fixture.content) });
      await page.locator(fixture.viewer).waitFor({ timeout: 15_000 });
      const mode = await page.locator("main").getAttribute("data-notebook-mode");
      if (mode !== fixture.mode) throw new Error(`Hosted ${fixture.name} did not set board mode: ${mode}`);
      if (await page.locator(".panel-attach-preview-button").count()) {
        throw new Error(`Hosted ${fixture.name} exposed the multimedia attachment control.`);
      }
      await verifyHostedBoardAiSurface(page, fixture.mode);
      if (fixture.mode === "shogi") {
        await verifyHostedShogiAnalysis(page);
        await verifyHostedShogiMergeFeedback(page, fixture.content);
      }
    } finally {
      await context.close();
    }
  }
}

/**
 * A board record is an authoritative move tree, so the free-form text AI is
 * withdrawn in every board mode and only shogi gains the engine control.
 */
async function verifyHostedBoardAiSurface(page, mode) {
  if (await page.locator(".ai-feature-button").count()) {
    throw new Error(`Hosted ${mode} mode still exposed the text AI feature button.`);
  }
  if (await page.locator(".command-dock").count()) {
    throw new Error(`Hosted ${mode} mode still exposed the text AI command dock.`);
  }
  const analysisButtons = await page.locator(".shogi-analysis-button").count();
  const expected = mode === "shogi" ? 1 : 0;
  if (analysisButtons !== expected) {
    throw new Error(`Hosted ${mode} mode showed ${analysisButtons} analysis buttons, expected ${expected}.`);
  }
  if (mode !== "shogi") return;
  const order = await page.locator(".global-menu > button").evaluateAll((buttons) =>
    buttons.map((button) => (button.classList.contains("shogi-analysis-button") ? "analysis" : "other")),
  );
  if (order[0] !== "analysis") {
    throw new Error(`The analysis button must lead the atlas action cluster: ${order.join(",")}`);
  }
}

/**
 * Drives one analysis end to end: the request reaches the service, the answer
 * is written into the analyzed node, and the engine reading becomes real move
 * nodes without duplicating the move the record already held.
 */
async function verifyHostedShogiAnalysis(page) {
  const before = shogiAnalysisRequests.length;
  const analysisButton = page.locator(".shogi-analysis-button");
  // Analyze the initial position: the record already holds the first move of
  // the canned reading, which is what proves an existing move is reused.
  const toInitialPosition = page.getByRole("button", { name: "初期局面に戻る" });
  if (await toInitialPosition.isEnabled()) await toInitialPosition.click();
  await page.waitForFunction(
    () => !document.querySelector(".shogi-analysis-button")?.disabled,
    null,
    { timeout: 10_000 },
  ).catch(async () => {
    throw new Error(`The analysis button stayed disabled: ${await analysisButton.getAttribute("title")}`);
  });
  await analysisButton.click();
  await waitFor(() => shogiAnalysisRequests.length > before, "The analysis request never reached the service.");
  const sfen = shogiAnalysisRequests[shogiAnalysisRequests.length - 1];
  if (!/^[1-9a-zA-Z+*/ -]+$/.test(sfen)) throw new Error(`The client sent a malformed SFEN: ${sfen}`);

  const body = page.locator(".node-body-input").first();
  await body.waitFor({ timeout: 15_000 });
  await page.waitForFunction(
    () => document.querySelector(".node-body-input")?.value?.includes("--- AI解析 ") ?? false,
    null,
    { timeout: 15_000 },
  );
  const text = await body.inputValue();
  for (const fragment of ["エンジン: やねうら王 + 水匠5", "評価値: +62（先手やや有利）", "最善手: ", "読み筋: "]) {
    if (!text.includes(fragment)) throw new Error(`The analysis block is missing ${fragment}:\n${text}`);
  }

  // The button must refuse a second request only while one is in flight; once
  // the answer lands it has to be usable again.
  await page.waitForFunction(
    () => !document.querySelector(".shogi-analysis-button")?.classList.contains("is-analyzing"),
    null,
    { timeout: 15_000 },
  );
  if (await analysisButton.isDisabled()) throw new Error("The analysis button stayed disabled after the answer arrived.");
}

async function waitFor(predicate, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function verifyHostedShogiMergeFeedback(page, recordText) {
  await page.getByRole("button", { name: "Mind Atlasメニューを開く" }).click();
  await page.getByRole("button", { name: "KIF棋譜をマージ" }).click();
  const dialog = page.locator(".board-record-dialog");
  await dialog.waitFor();
  const mergeStrategies = dialog.locator('input[name="board-record-merge-strategy"]');
  if (await mergeStrategies.count() !== 2) {
    throw new Error("Hosted shogi merge did not expose both merge starting-point choices.");
  }
  const initialStrategy = dialog.locator('input[value="record-root"]');
  const deepestStrategy = dialog.locator('input[value="deepest-common-position"]');
  // The merge anchors at the position nearest the imported tail by default, so
  // a continuation of the same game lands where it was played rather than being
  // replayed from the initial position.
  if (!await deepestStrategy.isChecked()) {
    throw new Error("Hosted shogi merge did not default to the nearest matching position.");
  }
  await initialStrategy.check();
  if (!await initialStrategy.isChecked()) {
    throw new Error("Hosted shogi merge could not select the initial position.");
  }
  await deepestStrategy.check();
  if (!await deepestStrategy.isChecked()) {
    throw new Error("Hosted shogi merge could not select deepest matching position.");
  }
  await dialog.locator("textarea").fill(recordText);
  const action = dialog.getByRole("button", { name: "この棋譜にマージ" });
  const colors = await action.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, text: style.color };
  });
  if (colors.background === colors.text || colors.background === "rgba(0, 0, 0, 0)") {
    throw new Error(`Hosted shogi merge action is not visually readable after paste: ${JSON.stringify(colors)}`);
  }
  const alertMessage = new Promise((resolve) => {
    page.once("dialog", async (browserDialog) => {
      resolve(browserDialog.message());
      await browserDialog.accept();
    });
  });
  await action.click();
  const message = await alertMessage;
  if (!String(message).includes("棋譜をマージしました")) {
    throw new Error(`Hosted shogi merge did not show completion feedback: ${message}`);
  }
  await dialog.waitFor({ state: "detached" });
}

async function verifyDirectShogiLaunch(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(`${appUrl}/?mode=shogi`, { waitUntil: "networkidle" });
    await page.locator('main[data-notebook-mode="shogi"]').waitFor({ timeout: 15_000 });
    await page.locator(".shogi-viewer").waitFor({ timeout: 15_000 });
    const state = await page.evaluate(() => ({
      datasetTitle: document.querySelector(".dataset-title-input")?.value ?? "",
      nodeTitle: document.querySelector(".node-title-input")?.value ?? "",
      nodeBody: document.querySelector(".node-body-input")?.value ?? "",
      modeParam: new URLSearchParams(location.search).get("mode"),
    }));
    if (state.datasetTitle !== "新規の棋譜" || state.nodeTitle !== "将棋" || state.nodeBody !== "") {
      throw new Error(`Direct shogi launch did not create the requested empty record: ${JSON.stringify(state)}`);
    }
    if (state.modeParam !== null) throw new Error(`Direct shogi launch URL was not consumed safely: ${JSON.stringify(state)}`);
  } finally {
    await context.close();
  }
}

function createMockSession() {
  if (mockSessionMode === "signed-out") {
    return {
      publicService: true,
      authenticated: false,
      user: null,
      subscription: null,
      credit: null,
      entitlement: {
        aiEnabled: false,
        reason: "authentication_required",
      },
      chatOptions: createMockChatOptions(),
    };
  }
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

/**
 * A canned engine answer. The principal variation deliberately opens with the
 * move the fixture record already contains, so the assertion can prove the
 * existing node is reused instead of duplicated.
 */
function createMockShogiAnalysis(sfen) {
  return {
    engine: { id: "yaneuraou-suisho5", name: "YaneuraOu NNUE", label: "やねうら王 + 水匠5" },
    analyzedAt: new Date().toISOString(),
    sfen,
    sideToMove: sfen.split(" ")[1] === "w" ? "gote" : "sente",
    movetimeMs: 5000,
    depth: 24,
    seldepth: 30,
    nodes: 12000000,
    nps: 2400000,
    elapsedMs: 5010,
    terminal: false,
    score: { kind: "cp", sente: 62 },
    bestMove: "7g7f",
    pv: ["7g7f", "3c3d", "2g2f", "8c8d", "2f2e"],
  };
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

async function seedHostedMobileEditorNotebook(page) {
  const now = new Date().toISOString();
  const baseFields = {
    author: "human",
    status: "waiting",
    texture: "speckled",
    attachments: [],
    createdAt: now,
    updatedAt: now,
    nextDecision: "",
    tags: [],
    position: [0, 0, 0],
  };
  const root = {
    id: "atlas-root",
    kind: "root",
    nodeType: "note",
    title: "Hosted mobile root",
    subtitle: "Hosted mobile root",
    body: "Hosted mobile root body",
    color: "#8df5cf",
    radius: 80,
    summary: "Hosted mobile root",
    ...baseFields,
    children: [
      {
        id: "hosted-mobile-child",
        kind: "thread",
        nodeType: "human_prompt",
        title: "Hosted mobile child",
        subtitle: "Hosted mobile child",
        body: "Line one\nLine two\nLine three\nLine four\nLine five\nLine six",
        color: "#94a3ff",
        radius: 48,
        summary: "Hosted mobile child",
        ...baseFields,
        children: [],
      },
    ],
  };
  await page.addInitScript((seed) => {
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(seed.root));
    window.localStorage.setItem(
      "mind-atlas-ui-state-v1",
      JSON.stringify({
        version: 1,
        savedAt: seed.now,
        selectedNodeId: "atlas-root",
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: "phyllotaxis",
        mobilePanelTab: "editor",
      }),
    );
  }, { root, now });
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

async function stopChild(child) {
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (!child.pid || child.exitCode !== null) {
    child.unref();
    return;
  }
  const exited = waitForChildExit(child);
  terminateChildNow(child);
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the status check and the signal.
    }
    await Promise.race([waitForChildExit(child), delay(2_000)]);
  }
  child.unref();
}

function terminateChildNow(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may already have exited.
  }
}

function waitForChildExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

async function waitForPortClosed(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isPortOpen(port))) return;
    await delay(50);
  }
  throw new Error(`Vite verification port ${port} remained open after cleanup.`);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    const finishClosed = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once("error", finishClosed);
    socket.once("timeout", finishClosed);
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await Promise.race([
    new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
    delay(2_000),
  ]);
}

async function closeBrowser(browser) {
  let closed = false;
  await Promise.race([
    browser.close()
      .catch(() => {})
      .then(() => {
        closed = true;
      }),
    delay(3_000),
  ]);
  if (!closed) {
    console.warn("Browser close exceeded 3000ms; forcing verifier process shutdown.");
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
