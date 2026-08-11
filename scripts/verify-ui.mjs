import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.MIND_ATLAS_URL ?? "http://127.0.0.1:5173";
const outputDir = "artifacts/screenshots";

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ headless: true, args: ["--lang=en-US"] }),
    () => chromium.launch({ channel: "msedge", headless: true, args: ["--lang=en-US"] }),
    () => chromium.launch({ channel: "chrome", headless: true, args: ["--lang=en-US"] }),
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

async function verifyViewport(browser, name, viewport) {
  const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(900);

  const stats = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "missing canvas" };

    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "missing webgl context" };

    const width = canvas.width;
    const height = canvas.height;
    const x = 0;
    const y = 0;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let nonDark = 0;
    let colorEnergy = 0;
    const unique = new Set();

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = pixels[index + 3];
      const energy = red + green + blue;
      colorEnergy += energy;
      if (alpha > 0 && energy > 30) nonDark += 1;
      if (index % 64 === 0) unique.add(`${red},${green},${blue},${alpha}`);
    }

    return {
      ok: nonDark > 80 && unique.size > 6,
      nonDark,
      unique: unique.size,
      averageEnergy: Math.round(colorEnergy / (pixels.length / 4)),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  });

  if (!stats.ok) {
    throw new Error(`${name} canvas check failed: ${JSON.stringify(stats)}`);
  }

  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: true });
  await page.close();
  return stats;
}

async function verifyLayoutModeSwitch(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  for (const label of ["Tree", "Mind map", "Calendar", "Mind Atlas"]) {
    await page.getByLabel("Open atlas menu").click();
    await page.locator(".global-context-menu").getByRole("button", { name: label }).click();
    await page.locator(".global-context-menu").waitFor({ state: "detached" });
    await page.waitForTimeout(220);
    const hasCanvas = await page.locator("canvas").evaluate((canvas) => {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      return Boolean(gl);
    });
    if (!hasCanvas) throw new Error(`Mode ${label} lost WebGL canvas`);
  }
  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Text editor").click();
  await page.waitForSelector(".outline-editor-shell");
  await page.close();
}

async function verifyNodeSearch(browser) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 760 }, ignoreHTTPSErrors: true });
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  await page.keyboard.press("Control+f");
  const dialog = page.locator(".node-search-dialog");
  await dialog.waitFor({ state: "visible" });
  const input = dialog.locator('input[type="search"]');
  await input.fill("mobile tap");
  const plainResults = dialog.locator(".node-search-result");
  if (await plainResults.count() !== 1) throw new Error("Ctrl+F node search should find matching body text.");

  await dialog.getByText("Regular expression", { exact: true }).click();
  await input.fill("^Verify Child$");
  const regexResults = dialog.locator(".node-search-result");
  if (await regexResults.count() !== 1) throw new Error("Regular-expression node search should find the exact title.");
  await regexResults.first().click();
  await dialog.waitFor({ state: "detached" });
  const selectedTitle = await page.locator(".node-title-input").inputValue();
  if (selectedTitle !== "Verify Child") throw new Error(`Search result did not focus the selected node: ${selectedTitle}`);

  await page.getByLabel("Open atlas menu").click();
  await page.getByRole("button", { name: /Search all nodes/ }).click();
  await page.locator(".node-search-dialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.matches('.node-search-dialog input[type="search"]'));
  await page.locator(".node-search-dialog").getByLabel("Close").click();
  await page.locator(".node-search-dialog").waitFor({ state: "detached" });
  await page.close();
  return { plainMatches: 1, regexMatches: 1, selectedTitle };
}

async function verifyCalendarLayout(browser) {
  const results = {};
  for (const viewportCase of [
    { name: "desktop", viewport: { width: 1440, height: 920 }, mobile: false },
    { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: viewportCase.viewport,
      ignoreHTTPSErrors: true,
      ...(viewportCase.mobile ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    await seedCompletedOnboarding(page);
    await seedCalendarNotebook(page);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas");
    await page.waitForSelector(".spatial-guide-label-weekday");
    await page.waitForTimeout(1500);

    const stats = await page.evaluate(() => {
      const weekdayLabels = [...document.querySelectorAll(".spatial-guide-label-weekday")];
      const scheduledLabels = [...document.querySelectorAll('[data-node-id^="calendar-"]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-node-id"),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          centerX: Math.round(rect.left + rect.width / 2),
          centerY: Math.round(rect.top + rect.height / 2),
        };
      });
      const sameDay = scheduledLabels.filter((label) => label.id?.startsWith("calendar-dense-"));
      const nextWeek = scheduledLabels.find((label) => label.id === "calendar-next-week");
      return {
        weekdayCount: weekdayLabels.length,
        weekdayText: weekdayLabels.map((label) => label.textContent?.trim()),
        scheduledCount: scheduledLabels.length,
        unscheduledCount: document.querySelectorAll('[data-node-id="calendar-unscheduled"]').length,
        denseBadge: document.querySelector(".spatial-guide-label-count")?.textContent?.trim() ?? null,
        sameDayDistinctX: new Set(sameDay.map((label) => label.centerX)).size,
        sameDayDistinctY: new Set(sameDay.map((label) => label.centerY)).size,
        nextWeekBelow: Boolean(nextWeek && sameDay.length && nextWeek.centerY > Math.max(...sameDay.map((label) => label.centerY))),
        visibleLabels: scheduledLabels.filter((label) => label.width > 0 && label.height > 0).length,
      };
    });

    if (stats.weekdayCount !== 7 || !stats.weekdayText.includes("MON")) {
      throw new Error(`${viewportCase.name} calendar weekday labels are incomplete: ${JSON.stringify(stats)}`);
    }
    if (stats.scheduledCount !== 2 || stats.unscheduledCount !== 0 || stats.visibleLabels !== 2 || stats.denseBadge !== "×5") {
      throw new Error(`${viewportCase.name} calendar scheduled-node filtering failed: ${JSON.stringify(stats)}`);
    }
    if (!stats.nextWeekBelow) {
      throw new Error(`${viewportCase.name} calendar cell packing failed: ${JSON.stringify(stats)}`);
    }

    await page.screenshot({ path: `${outputDir}/calendar-${viewportCase.name}.png`, fullPage: true });
    results[viewportCase.name] = stats;
    await context.close();
  }
  return results;
}

async function verifyLocaleSwitching(browser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, ignoreHTTPSErrors: true, locale: "en-US" });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Open atlas menu").click();
  await page.getByLabel("Interface language").selectOption("ja");
  await page.getByRole("button", { name: "新しく始める" }).waitFor();
  const japaneseDocument = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    stored: window.localStorage.getItem("mind-atlas-locale-v1"),
  }));
  if (japaneseDocument.lang !== "ja" || japaneseDocument.dir !== "ltr" || japaneseDocument.stored !== "ja") {
    throw new Error(`Japanese locale did not apply and persist: ${JSON.stringify(japaneseDocument)}`);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("Mind Atlasメニューを開く").click();
  await page.getByRole("button", { name: "新しく始める" }).waitFor();

  await page.goto(`${baseUrl}?locale=ar-XB`, { waitUntil: "networkidle" });
  const pseudoDocument = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
  if (pseudoDocument.lang !== "ar-XB" || pseudoDocument.dir !== "rtl") {
    throw new Error(`RTL pseudo locale did not apply: ${JSON.stringify(pseudoDocument)}`);
  }
  await context.close();
  return { japaneseDocument, pseudoDocument };
}

async function verifyLocalDeveloperModeSurface(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.locator(".mode-switch").waitFor();

  const agentRunsLauncher = page.getByRole("button", { name: "Open Agent runs" });
  await agentRunsLauncher.waitFor();
  await agentRunsLauncher.click();
  const agentWorkspace = page.locator(".agent-workspace");
  await agentWorkspace.waitFor();
  const closeAgentWorkspace = agentWorkspace.getByRole("button", { name: "Close run workspace" });
  if (await closeAgentWorkspace.count()) {
    await closeAgentWorkspace.click();
  } else {
    await agentWorkspace.getByRole("button", { name: "Close", exact: true }).click();
  }
  await agentRunsLauncher.waitFor();

  // The detail panel is dismissible from its transparent backdrop as well as
  // from the explicit close control, including pointer/touch input.
  await agentRunsLauncher.click();
  await agentWorkspace.waitFor();
  await page.locator(".agent-workspace-backdrop").click({ position: { x: 4, y: 4 } });
  await agentRunsLauncher.waitFor();

  const localSavePrevented = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  if (!localSavePrevented) throw new Error("Ctrl+S did not prevent the browser save-page action in local mode.");
  await page.locator(".context-copy-toast", { hasText: "Saved locally." }).waitFor();

  const hostedButtonCount = await page.getByRole("button", { name: /AI\u6a5f\u80fd/ }).count();
  if (hostedButtonCount !== 0) {
    throw new Error(`Local developer mode exposed the hosted AI feature button: ${hostedButtonCount}`);
  }

  const modeLabels = await page.locator(".mode-switch button").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") || button.textContent?.trim() || ""),
  );
  for (const expected of ["Chat", "Code", "OpenClaw", "Note"]) {
    if (!modeLabels.includes(expected)) {
      throw new Error(`Local developer mode is missing ${expected} mode: ${JSON.stringify(modeLabels)}`);
    }
  }

  await page.getByRole("button", { name: "Code" }).click();
  await page.locator(".code-options-row").waitFor();
  const repositoryGuard = page.locator(".agent-repository-guard");
  await repositoryGuard.waitFor();
  const bindRepository = repositoryGuard.getByRole("button", { name: "Bind this branch" });
  await bindRepository.waitFor();
  const repositoryText = await repositoryGuard.innerText();
  if (!repositoryText.toLowerCase().includes("mind_atlas")) {
    throw new Error(`Code workspace preflight did not expose the actual repository: ${repositoryText}`);
  }
  await bindRepository.click();
  await repositoryGuard.getByText("Bound", { exact: true }).waitFor();
  const codexWorkRootInput = page.locator(".code-options-row .codex-workspace-field input").first();
  const boundWorkRoot = await codexWorkRootInput.inputValue();
  await codexWorkRootInput.fill("");
  const restoreBoundWorkRoot = repositoryGuard.getByRole("button", { name: "Restore bound work root" });
  await restoreBoundWorkRoot.waitFor();
  await restoreBoundWorkRoot.click();
  await page.waitForFunction(
    ({ selector, expected }) => document.querySelector(selector)?.value === expected,
    { selector: ".code-options-row .codex-workspace-field input", expected: boundWorkRoot },
  );
  await repositoryGuard.getByText("Bound", { exact: true }).waitFor();
  const codeBackends = await page.locator('.code-options-row select[title="Choose the code backend for this node-anchored run."] option')
    .evaluateAll((options) => options.map((option) => option.textContent?.trim()));
  for (const expected of ["Codex", "Claude Code API", "Claude Code Pro"]) {
    if (!codeBackends.includes(expected)) {
      throw new Error(`Local developer mode is missing ${expected} backend: ${JSON.stringify(codeBackends)}`);
    }
  }
  const backendSelect = page.locator('.code-options-row select[title="Choose the code backend for this node-anchored run."]');
  await backendSelect.selectOption("claude-subscription");
  await page.locator(".claude-options-row").waitFor();
  if ((await page.locator(".claude-options-row").innerText()).includes("Timeout")) {
    throw new Error("Claude Code settings still expose an elapsed-time limit.");
  }
  const proPresets = await page.locator(".claude-options-row select").nth(1).locator("option")
    .evaluateAll((options) => options.map((option) => option.textContent?.trim()));
  if (!proPresets.includes("Claude account default") || proPresets.some((preset) => preset?.includes("DeepSeek"))) {
    throw new Error(`Claude Code Pro presets are not subscription-safe: ${JSON.stringify(proPresets)}`);
  }
  // Claude Code Pro presets must carry the concrete version number, not a bare
  // alias, so the user can tell Opus 4.8 from Opus 5.
  if (!proPresets.some((preset) => /Claude .*\d/.test(preset ?? ""))) {
    throw new Error(`Claude Code Pro presets do not show model version numbers: ${JSON.stringify(proPresets)}`);
  }

  // The work root belongs to the branch, not to one provider: switching backend
  // must not clear it.
  const claudeWorkRoot = await page.locator(".claude-options-row .codex-workspace-field input").inputValue();
  if (!claudeWorkRoot.trim()) {
    throw new Error("Switching to Claude Code Pro cleared the work root.");
  }

  await backendSelect.selectOption("codex");
  if ((await page.locator(".code-options-row").innerText()).includes("Timeout")) {
    throw new Error("Codex settings still expose an elapsed-time limit.");
  }
  const codexWorkRoot = await page.locator(".code-options-row .codex-workspace-field input").first().inputValue();
  if (codexWorkRoot !== claudeWorkRoot) {
    throw new Error(`Work root changed when switching provider: codex=${codexWorkRoot} claude=${claudeWorkRoot}`);
  }
  const codexModels = await page.locator(".code-options-row select").nth(1).locator("option")
    .evaluateAll((options) => options.map((option) => ({ value: option.getAttribute("value"), label: option.textContent?.trim() })));
  if (!codexModels.some((option) => option.value === "gpt-5.3-codex-spark")) {
    throw new Error(`Codex Spark is missing from the model selector: ${JSON.stringify(codexModels)}`);
  }

  await page.getByRole("button", { name: "OpenClaw" }).click();
  await page.locator(".openclaw-options-row").waitFor();

  await page.getByRole("button", { name: "Chat" }).click();
  await page.locator(".chat-options-row").waitFor();
  const chatServices = await page.locator(".chat-options-row select").first().locator("option")
    .evaluateAll((options) => options.map((option) => option.textContent?.trim()));
  if (!chatServices.some((service) => service?.startsWith("Local"))) {
    throw new Error(`Local developer mode is missing the Local chat service: ${JSON.stringify(chatServices)}`);
  }
  if (chatServices.some((service) => service?.trim() === "Opus")) {
    throw new Error(`The Anthropic chat service is still labelled Opus: ${JSON.stringify(chatServices)}`);
  }

  await context.close();
  return {
    modeLabels,
    codeBackends,
    codexModels,
    proPresets,
    chatServices,
    claudeWorkRoot,
    codexWorkRoot,
    localSavePrevented,
    repositoryText,
    agentRunsReopened: true,
    agentWorkspaceClosedByOutsideClick: true,
  };
}

async function verifyAgentRunNodeSynchronization(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedAgentRunLinkedNotebook(page);
  const now = new Date().toISOString();
  const manifests = [
    createAgentRunManifest("verify-runtime-a", "verify-client-a", "agent-request-a", "C:\\verify\\repo-a", now),
    createAgentRunManifest("verify-runtime-b", "verify-client-b", "agent-request-b", "C:\\verify\\repo-b", now),
  ];

  await page.route("**/api/agent-runs**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (path === "/api/agent-runs") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: manifests }) });
      return;
    }
    if (path.endsWith("/events")) {
      const runId = path.split("/").at(-2);
      const manifest = manifests.find((entry) => entry.runId === runId);
      await route.fulfill({
        status: manifest ? 200 : 404,
        contentType: "text/event-stream",
        body: manifest ? `event: manifest\ndata: ${JSON.stringify(manifest)}\n\n` : "",
      });
      return;
    }
    const runId = path.split("/").at(-1);
    const manifest = manifests.find((entry) => entry.runId === runId);
    await route.fulfill({
      status: manifest ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(manifest ? { manifest, final: null } : { error: "not found" }),
    });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const launcher = page.getByRole("button", { name: "Open Agent runs" });
  await launcher.click();
  const switcher = page.getByRole("tablist", { name: "Parallel agent runs" });
  await switcher.waitFor();
  const runATab = switcher.getByRole("tab", { name: /repo-a/i });
  const runBTab = switcher.getByRole("tab", { name: /repo-b/i });

  await runBTab.click();
  await page.locator('textarea.space-title-editor[data-node-id="agent-request-b"][data-selected="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[role="tab"][title*="repo-b"]')?.getAttribute("aria-selected") === "true");

  await page.locator('textarea.space-title-editor[data-node-id="agent-request-a"]').evaluate((element) => element.click());
  await page.waitForFunction(() => document.querySelector('[role="tab"][title*="repo-a"]')?.getAttribute("aria-selected") === "true");

  await page.locator('textarea.space-title-editor[data-node-id="unlinked-note"]').evaluate((element) => element.click());
  await page.waitForTimeout(100);
  const runAStayedSelected = await runATab.getAttribute("aria-selected");
  if (runAStayedSelected !== "true") {
    throw new Error(`Selecting an unrelated node changed the Agent runs thread: aria-selected=${runAStayedSelected}`);
  }

  const result = {
    runToNode: "agent-request-b",
    nodeToRun: "verify-runtime-a",
    unlinkedNodeKeptRun: runAStayedSelected === "true",
  };
  await context.close();
  return result;
}

async function verifyCodePreflightFeedback(browser) {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 780 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas");
  await page.locator(".mode-switch").waitFor();
  await page.getByRole("button", { name: "Code" }).click();
  const prompt = "verify visible preflight failure";
  await page.locator(".command-field input").fill(prompt);
  const send = page.locator(".send-button");
  if (await send.isDisabled()) throw new Error("Code send stayed disabled, so the user would receive no feedback.");
  await send.click();
  await page.waitForTimeout(400);
  const recorded = await page.evaluate((expectedPrompt) => {
    const stored = window.localStorage.getItem("mind-atlas-notebook-v2");
    if (!stored) return null;
    const root = JSON.parse(stored);
    const nodes = [];
    const visit = (node) => {
      nodes.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    const request = nodes.find((node) => node.nodeType === "human_prompt" && node.body === expectedPrompt);
    const error = request?.children?.find((node) => node.status === "error");
    return request && error
      ? { requestTitle: request.title, requestStatus: request.status, errorTitle: error.title, errorBody: error.body }
      : null;
  }, prompt);
  if (!recorded) throw new Error("Code preflight failure did not persist a request node with an error child.");
  await context.close();
  return recorded;
}

async function verifyNotificationSnoozeActions(browser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  const reminderAt = new Date(Date.now() - 120_000).toISOString();
  const reminderFiredAt = new Date(Date.now() - 60_000).toISOString();
  await seedSingleChildNotebook(page, "phyllotaxis", { reminderAt, reminderFiredAt });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("mind-atlas-notebook", 1);
        request.onerror = () => resolve(false);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("meta", "readonly");
          const current = tx.objectStore("meta").get("current");
          current.onerror = () => resolve(false);
          current.onsuccess = () => {
            const child = current.result?.root?.children?.find((node) => node.id === "verify-child");
            resolve(Boolean(child?.reminderAt && child?.reminderFiredAt));
          };
          tx.oncomplete = () => db.close();
        };
      }),
    undefined,
    { timeout: 10_000 },
  );

  const reminderNotification = page.locator(".unread-notification-link.is-needs_review");
  await reminderNotification.waitFor();
  await reminderNotification.click();

  const actions = page.locator(".node-snooze-actions");
  await actions.waitFor();
  const labels = await actions.getByRole("button").allTextContents();
  const expectedLabels = ["OK", "In 2 hours", "In 1 day", "In 1 week"];
  if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
    throw new Error(`Reminder actions are incorrect: ${JSON.stringify(labels)}`);
  }

  const acknowledgeButton = actions.getByRole("button", { name: "OK", exact: true });
  const buttonStyles = await actions.evaluate((group) => {
    const buttons = [...group.querySelectorAll("button")];
    return {
      acknowledgeClass: buttons[0]?.className ?? "",
      acknowledgeBackground: buttons[0] ? getComputedStyle(buttons[0]).backgroundColor : "",
      snoozeBackground: buttons[1] ? getComputedStyle(buttons[1]).backgroundColor : "",
    };
  });
  if (!buttonStyles.acknowledgeClass.includes("is-acknowledge") || buttonStyles.acknowledgeBackground === buttonStyles.snoozeBackground) {
    throw new Error(`Reminder OK action is not visually distinct: ${JSON.stringify(buttonStyles)}`);
  }

  await acknowledgeButton.click();
  await actions.waitFor({ state: "detached" });
  if (await reminderNotification.count()) throw new Error("Reminder notification remained visible after OK.");

  const persistedReminder = await page.evaluate(async () => {
    const root = await new Promise((resolve, reject) => {
      const request = indexedDB.open("mind-atlas-notebook", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("meta", "readonly");
        const current = tx.objectStore("meta").get("current");
        current.onerror = () => reject(current.error);
        current.onsuccess = () => resolve(current.result?.root ?? null);
        tx.oncomplete = () => db.close();
      };
    });
    if (!root) return { missingRoot: true, childIds: [] };
    const child = root.children?.find((node) => node.id === "verify-child");
    return child
      ? {
          rootTitle: root.title,
          childIds: root.children?.map((node) => node.id) ?? [],
          reminderAt: child.reminderAt,
          reminderFiredAt: child.reminderFiredAt,
        }
      : {
          rootTitle: root.title,
          childIds: root.children?.map((node) => node.id) ?? [],
          missingChild: true,
        };
  });
  if (persistedReminder?.reminderAt !== reminderAt || persistedReminder?.reminderFiredAt !== reminderFiredAt) {
    throw new Error(`OK cleared the reminder instead of only acknowledging its notification: ${JSON.stringify(persistedReminder)}`);
  }

  await context.close();
  return { labels, buttonStyles, persistedReminder };
}

async function verifyGeneratedLayoutBlocksBackgroundBirth(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.evaluate(() => {
    window.__mindAtlasVerifyBackgroundInteractions = 0;
    window.addEventListener("mindatlas:universe-background-interaction", () => {
      window.__mindAtlasVerifyBackgroundInteractions += 1;
    });
  });

  for (const label of ["Tree", "Mind map"]) {
    await page.getByLabel("Open atlas menu").click();
    await page.getByTitle(label).click();
    await page.locator(".global-context-menu").waitFor({ state: "detached" });
    await page.waitForTimeout(900);
    const backgroundPoint = await findCanvasBackgroundPoint(page, label);
    await page.waitForTimeout(180);
    const beforeCount = await readPersistedNodeCount(page);
    await page.mouse.move(backgroundPoint.x, backgroundPoint.y);
    await page.mouse.down();
    await page.locator(".layout-birth-unavailable-toast").waitFor({ timeout: 2800 });
    const message = await page.locator(".layout-birth-unavailable-toast").innerText();
    if (!message.includes(label) || !message.includes("Mind Atlas")) {
      throw new Error(`${label} unavailable birth message was wrong: ${message}`);
    }
    await page.mouse.up();
    await page.locator(".layout-birth-unavailable-toast").waitFor({ state: "detached", timeout: 5200 });
    await page.waitForTimeout(180);
    const afterCount = await readPersistedNodeCount(page);
    if (afterCount !== beforeCount) {
      throw new Error(`${label} background long press created a node: before=${beforeCount}, after=${afterCount}`);
    }
  }

  await context.close();
}

async function verifyStablePhyllotaxisPositions(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const { deriveAtlasLayout, stabilizePhyllotaxisPositions } = await import("/src/layout/atlasLayout.ts");
    const now = new Date().toISOString();
    const makeNode = (id, children = []) => ({
      id,
      kind: id === "atlas-root" ? "root" : "thread",
      nodeType: "note",
      title: id,
      subtitle: id,
      body: "",
      author: "human",
      status: "waiting",
      color: "#8df5cf",
      texture: "speckled",
      radius: id === "atlas-root" ? 80 : 28,
      summary: "",
      nextDecision: "",
      tags: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
      children,
    });
    const root = makeNode("atlas-root", [
      makeNode("alpha", [makeNode("alpha-one"), makeNode("alpha-two")]),
      makeNode("beta"),
      makeNode("gamma"),
    ]);
    const stable = stabilizePhyllotaxisPositions(root);
    const before = deriveAtlasLayout(stable);
    stable.children = stable.children.filter((child) => child.id !== "beta");
    const alpha = stable.children.find((child) => child.id === "alpha");
    if (alpha) alpha.children = alpha.children.filter((child) => child.id !== "alpha-one");
    const after = deriveAtlasLayout(stable);
    return {
      alphaBefore: before.get("alpha"),
      alphaAfter: after.get("alpha"),
      gammaBefore: before.get("gamma"),
      gammaAfter: after.get("gamma"),
      nestedBefore: before.get("alpha-two"),
      nestedAfter: after.get("alpha-two"),
    };
  });
  for (const key of ["alpha", "gamma", "nested"]) {
    if (JSON.stringify(result[`${key}Before`]) !== JSON.stringify(result[`${key}After`])) {
      throw new Error(`Deleting a sibling moved ${key}: ${JSON.stringify(result)}`);
    }
  }
  await context.close();
  return result;
}

async function verifyBackgroundReturnsOneParent(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedGeneratedLayoutNotebook(page, "phyllotaxis");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const parentTitle = page.locator('textarea.space-title-editor[data-node-id="layout-alpha"]');
  try {
    await parentTitle.waitFor({ timeout: 5000 });
  } catch {
    const state = await page.evaluate(() => ({
      stored: window.localStorage.getItem("mind-atlas-notebook-v2"),
      nodeIds: [...document.querySelectorAll("[data-node-id]")].map((element) => element.getAttribute("data-node-id")),
    }));
    throw new Error(`Seeded parent label did not render: ${JSON.stringify(state)}`);
  }
  await parentTitle.click();
  await page.waitForTimeout(220);
  await page.locator('textarea.space-title-editor[data-node-id="layout-alpha-1"]').click();
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="layout-alpha-1"]')?.getAttribute("data-selected") === "true",
  );
  await page.evaluate(() => {
    window.__mindAtlasVerifyBackgroundInteractions = 0;
    window.addEventListener("mindatlas:universe-background-interaction", () => {
      window.__mindAtlasVerifyBackgroundInteractions += 1;
    });
  });
  await findCanvasBackgroundPoint(page, "Mind Atlas parent return");
  await page.waitForTimeout(320);
  const selectedNodeIds = await page.locator('textarea.space-title-editor[data-selected="true"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-node-id")).filter(Boolean),
  );
  if (!selectedNodeIds.includes("layout-alpha")) {
    throw new Error(`Background click did not return to the immediate parent: ${JSON.stringify(selectedNodeIds)}`);
  }
  const rootSelected = await page.locator('textarea.space-title-editor[data-node-id="atlas-root"][data-selected="true"]').count();
  if (rootSelected) throw new Error("Background click jumped directly to the root instead of one parent.");
  await context.close();
}

async function verifyKonamiDoesNotUnlock(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  await enterKonamiSequence(page);
  await page.waitForTimeout(350);
  const progress = await page.evaluate(() => {
    const raw = window.localStorage.getItem("mind-atlas-onboarding-v1");
    return raw ? JSON.parse(raw) : null;
  });
  if (progress?.aiUnlocked === true) {
    throw new Error("Konami sequence unlocked AI features.");
  }
  if (progress?.basicCompleted === true) {
    throw new Error("Konami sequence completed tutorial onboarding.");
  }

  await context.close();
  return { aiUnlocked: false };
}

async function verifyTutorialSkipButton(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  const skipButton = page.getByRole("button", { name: "Skip tutorial" });
  await skipButton.waitFor();
  await skipButton.click();
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("mind-atlas-onboarding-v1");
    if (!raw) return false;
    const progress = JSON.parse(raw);
    return progress.basicCompleted === true && progress.spaceBasicsCompleted === true && progress.aiUnlocked === false;
  });
  await page.getByLabel("Open atlas menu").waitFor();
  const remainingSkipButtons = await page.getByRole("button", { name: "Skip tutorial" }).count();
  if (remainingSkipButtons > 0) throw new Error("Tutorial skip button remained visible after completion.");

  await context.close();
  return { completed: true, aiUnlocked: false };
}

async function enterKonamiSequence(page) {
  for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
    await page.keyboard.press(key);
  }
}

async function findCanvasBackgroundPoint(page, label) {
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error(`Missing canvas box while testing ${label} background birth`);
  const candidates = [
    [0.78, 0.24],
    [0.22, 0.24],
    [0.82, 0.5],
    [0.18, 0.5],
    [0.72, 0.68],
    [0.28, 0.68],
  ];

  for (const [xRatio, yRatio] of candidates) {
    const point = {
      x: box.x + box.width * xRatio,
      y: box.y + box.height * yRatio,
    };
    const beforeInteractions = await readBackgroundInteractionCount(page);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(80);
    const afterInteractions = await readBackgroundInteractionCount(page);
    if (afterInteractions > beforeInteractions) return point;
  }

  throw new Error(`Could not find an interactive canvas background point for ${label}`);
}

function readBackgroundInteractionCount(page) {
  return page.evaluate(() => window.__mindAtlasVerifyBackgroundInteractions ?? 0);
}

async function verifyStartupMissingTitleMaintenance(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedMissingTitleNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="missing-title-child"]')?.value === "本文だけで作られた過去ノードです。起動時にタイト...",
    undefined,
    { timeout: 5000 },
  );
  await context.close();
}

async function verifyIndexedDbCurrentBeatsStaleLegacyCache(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    const staleRoot = createPersistenceProbeRoot("stale-child", "Stale Child", "Stale body", now);
    const freshRoot = createPersistenceProbeRoot("fresh-child", "Fresh Child", "Fresh body", now);
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(staleRoot));
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
    window.localStorage.setItem(
      "mind-atlas-ui-state-v1",
      JSON.stringify({
        version: 1,
        savedAt: now,
        selectedNodeId: "atlas-root",
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: "phyllotaxis",
        mobilePanelTab: "command",
      }),
    );

    const db = await openNotebookDbForProbe();
    const tx = db.transaction(["meta", "snapshots"], "readwrite");
    tx.objectStore("meta").put({ key: "current", root: freshRoot, updatedAt: now, generation: 42 });
    await waitForTransaction(tx);
    db.close();

    function createPersistenceProbeRoot(childId, childTitle, childBody, createdAt) {
      const baseFields = {
        author: "human",
        status: "waiting",
        texture: "speckled",
        attachments: [],
        createdAt,
        updatedAt: createdAt,
        nextDecision: "",
        tags: [],
        position: [0, 0, 0],
      };
      return {
        id: "atlas-root",
        kind: "root",
        nodeType: "note",
        title: `${childTitle} Root`,
        subtitle: `${childTitle} Root`,
        body: `${childBody} root`,
        color: "#8df5cf",
        radius: 80,
        summary: `${childTitle} root`,
        ...baseFields,
        children: [
          {
            id: childId,
            kind: "thread",
            nodeType: "human_prompt",
            title: childTitle,
            subtitle: childTitle,
            body: childBody,
            color: "#94a3ff",
            radius: 48,
            summary: childBody,
            ...baseFields,
            children: [],
          },
        ],
      };
    }

    function openNotebookDbForProbe() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("mind-atlas-notebook", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
          if (!db.objectStoreNames.contains("snapshots")) {
            const store = db.createObjectStore("snapshots", { keyPath: "id" });
            store.createIndex("generation", "generation");
            store.createIndex("dayKey", "dayKey");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function waitForTransaction(tx) {
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForSelector('textarea.space-title-editor[data-node-id="fresh-child"]', { state: "visible" });
  const state = await page.evaluate(() => {
    const legacyRoot = JSON.parse(window.localStorage.getItem("mind-atlas-notebook-v2") ?? "null");
    return {
      freshVisible: Boolean(document.querySelector('textarea.space-title-editor[data-node-id="fresh-child"]')),
      staleVisible: Boolean(document.querySelector('textarea.space-title-editor[data-node-id="stale-child"]')),
      legacyChildId: legacyRoot?.children?.[0]?.id ?? null,
    };
  });
  if (!state.freshVisible || state.staleVisible || state.legacyChildId !== "fresh-child") {
    throw new Error(`IndexedDB current did not beat stale legacy cache: ${JSON.stringify(state)}`);
  }
  await context.close();
}

async function verifyOutlineAndContextCopy(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Text editor").click();
  await page.waitForSelector(".outline-editor-shell");

  const titleInputs = page.getByLabel("Node title");
  const initialTitleCount = await titleInputs.count();
  await titleInputs.first().click();
  await page.keyboard.press("Control+Shift+Enter");
  await page.waitForFunction(
    (count) => document.querySelectorAll('input[aria-label="Node title"]').length > count,
    initialTitleCount,
  );

  const title = "Regression Outline Child";
  await page.getByLabel("Node title").last().fill(title);
  await page.getByLabel("Node title").last().blur();
  await page.waitForFunction(
    (expectedTitle) => [...document.querySelectorAll('input[aria-label="Node title"]')].some((input) => input.value === expectedTitle),
    title,
  );

  const titleInput = page.locator('input[aria-label="Node title"]').last();
  const outlineRow = titleInput.locator('xpath=ancestor::section[contains(@class, "outline-node-row")][1]');
  const copySelect = outlineRow.locator('select[aria-label="Copy with context"]');
  const ancestorOption = await copySelect.locator('option[value="ancestors"]').innerText();
  if (!/tokens \/ \d+ nodes/.test(ancestorOption)) {
    throw new Error(`Outline copy option is missing token/node preview: ${ancestorOption}`);
  }

  await copySelect.selectOption("ancestors");
  await page.waitForTimeout(120);
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  const titleOccurrences = clipboardText.match(new RegExp(title, "g"))?.length ?? 0;
  if (!clipboardText.includes("preset: ancestors") || !clipboardText.includes("## Ancestor Context") || !clipboardText.includes("## Target Node")) {
    throw new Error(`Copied context is missing expected sections: ${clipboardText.slice(0, 240)}`);
  }
  if (titleOccurrences > 2) {
    throw new Error(`Copied context appears to duplicate the selected node title ${titleOccurrences} times.`);
  }

  await page.getByRole("button", { name: /Close/i }).click();
  await page.keyboard.press("Control+Z");
  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Text editor").click();
  await page.waitForSelector(".outline-editor-shell");
  const revertedTitleCount = await page.locator('input[aria-label="Node title"]').evaluateAll(
    (inputs, expectedTitle) => inputs.filter((input) => input.value === expectedTitle).length,
    title,
  );
  if (revertedTitleCount > 0) {
    throw new Error("Undo did not revert the outline title edit.");
  }

  await context.close();
  return {
    ancestorOption,
    copiedCharacters: clipboardText.length,
    titleOccurrences,
  };
}

async function verifyOutlineCollapseAndDeletionSafety(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedNestedNotebook(page, { selectedNodeId: "atlas-root", renderQuality: "low" });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector('textarea.space-title-editor[data-node-id="nested-parent"]', { state: "visible" });
  const rootLabel = await page.locator('textarea.space-title-editor[data-node-id="nested-parent"]').inputValue();
  if (rootLabel !== "Nested Parent") {
    throw new Error(`Root child title label should remain visible in low quality root overview: ${rootLabel}`);
  }

  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Text editor").click();
  await page.waitForSelector(".outline-editor-shell");
  const initialOutlineValues = await readOutlineTitleValues(page);
  if (!initialOutlineValues.includes("Nested Parent") || !initialOutlineValues.includes("Nested Child")) {
    throw new Error(`Nested outline seed did not render all rows: ${JSON.stringify(initialOutlineValues)}`);
  }

  await page.getByRole("button", { name: /Collapse all/i }).click();
  await page.waitForFunction(
    () => ![...document.querySelectorAll('input[aria-label="Node title"]')].some((input) => input.value === "Nested Child"),
  );
  const collapsedOutlineValues = await readOutlineTitleValues(page);
  if (!collapsedOutlineValues.includes("Nested Parent") || collapsedOutlineValues.includes("Nested Child")) {
    throw new Error(`Collapse all should hide descendants but keep top-level rows: ${JSON.stringify(collapsedOutlineValues)}`);
  }

  await page.getByRole("button", { name: /Expand all/i }).click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('input[aria-label="Node title"]')].some((input) => input.value === "Nested Child"),
  );
  const expandedCount = await page.locator('input[aria-label="Node title"]').count();
  await page.locator('input[aria-label="Node title"]').first().click();
  await page.keyboard.press("Control+Shift+Enter");
  await page.waitForFunction(
    (count) => document.querySelectorAll('input[aria-label="Node title"]').length > count,
    expandedCount,
  );
  const newOutlineInput = page.locator('input[aria-label="Node title"]').last();
  const newOutlineState = await newOutlineInput.evaluate((input) => ({
    value: input.value,
    placeholder: input.getAttribute("placeholder"),
  }));
  if (newOutlineState.value !== "" || newOutlineState.placeholder !== "Untitled") {
    throw new Error(`New outline nodes should store an empty title and show a placeholder: ${JSON.stringify(newOutlineState)}`);
  }
  await page.getByRole("button", { name: /Close/i }).click();
  await page.locator('textarea.space-title-editor[data-node-id="nested-parent"]').click();
  await page.waitForTimeout(80);

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(150);
  if (!(await page.locator('[data-node-id="nested-parent"]').count())) {
    throw new Error("Backspace deleted the selected node.");
  }

  let dismissedDeleteDialog = "";
  page.once("dialog", async (dialog) => {
    dismissedDeleteDialog = dialog.message();
    await dialog.dismiss();
  });
  await page.keyboard.press("Delete");
  await page.waitForTimeout(150);
  if (!dismissedDeleteDialog.includes("Nested Parent") || !(await page.locator('[data-node-id="nested-parent"]').count())) {
    throw new Error(`Delete should confirm before removing a node with descendants: ${dismissedDeleteDialog}`);
  }

  let acceptedDeleteDialog = "";
  page.once("dialog", async (dialog) => {
    acceptedDeleteDialog = dialog.message();
    await dialog.accept();
  });
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => !document.querySelector('[data-node-id="nested-parent"]'));
  if (!acceptedDeleteDialog.includes("1 child node")) {
    throw new Error(`Delete confirmation should describe the descendant count: ${acceptedDeleteDialog}`);
  }

  await context.close();
  return {
    collapsedVisibleRows: collapsedOutlineValues.length,
    placeholder: newOutlineState.placeholder,
    deleteDialog: acceptedDeleteDialog,
  };
}

async function verifyOutlineThemeAndSubtreeCollapse(browser) {
  const darkContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const darkPage = await darkContext.newPage();
  await seedCompletedOnboarding(darkPage);
  await seedNestedNotebook(darkPage, { selectedNodeId: "nested-parent" });
  await darkPage.addInitScript(() => {
    window.localStorage.setItem("mind-atlas-theme", "dark");
  });
  await darkPage.goto(baseUrl, { waitUntil: "networkidle" });
  await darkPage.waitForSelector("canvas");
  await darkPage.getByLabel("Open atlas menu").click();
  await darkPage.locator(".global-context-menu").getByTitle("Text editor").click();
  await darkPage.waitForSelector(".outline-editor-shell");

  const darkThemeStats = await readOutlineThemeStats(darkPage);
  if (darkThemeStats.backgroundBrightness > 160) {
    throw new Error(`Dark outline theme rendered too bright: ${JSON.stringify(darkThemeStats)}`);
  }

  await darkPage.locator('input[aria-label="Node title"]').first().click();
  await darkPage.getByRole("button", { name: /Close/i }).click();
  await darkPage.locator(".outline-editor-shell").waitFor({ state: "detached" });
  await darkPage.getByLabel("Open atlas menu").click();
  await darkPage.locator(".global-context-menu").getByTitle("Text editor").click();
  await darkPage.waitForSelector(".outline-editor-shell");
  const subtreeInitialValues = await readOutlineTitleValues(darkPage);
  if (JSON.stringify(subtreeInitialValues) !== JSON.stringify(["Nested Parent", "Nested Child"])) {
    throw new Error(`Subtree outline should open from the active parent node: ${JSON.stringify(subtreeInitialValues)}`);
  }

  await darkPage.getByRole("button", { name: /Collapse all/i }).click();
  await darkPage.waitForFunction(
    () => ![...document.querySelectorAll('input[aria-label="Node title"]')].some((input) => input.value === "Nested Child"),
  );
  const subtreeCollapsedValues = await readOutlineTitleValues(darkPage);
  if (JSON.stringify(subtreeCollapsedValues) !== JSON.stringify(["Nested Parent"])) {
    throw new Error(`Subtree Collapse all should hide the subtree root children: ${JSON.stringify(subtreeCollapsedValues)}`);
  }

  await darkPage.getByRole("button", { name: /Expand all/i }).click();
  await darkPage.waitForFunction(
    () => [...document.querySelectorAll('input[aria-label="Node title"]')].some((input) => input.value === "Nested Child"),
  );
  await darkPage.locator(".outline-editor-body > .outline-node-row > .outline-title-row .outline-fold-button").click();
  await darkPage.waitForFunction(
    () => ![...document.querySelectorAll('input[aria-label="Node title"]')].some((input) => input.value === "Nested Child"),
  );
  await darkContext.close();

  const lightContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const lightPage = await lightContext.newPage();
  await seedCompletedOnboarding(lightPage);
  await seedNestedNotebook(lightPage, { selectedNodeId: "nested-parent" });
  await lightPage.addInitScript(() => {
    window.localStorage.setItem("mind-atlas-theme", "light");
  });
  await lightPage.goto(baseUrl, { waitUntil: "networkidle" });
  await lightPage.waitForSelector("canvas");
  await lightPage.getByLabel("Open atlas menu").click();
  await lightPage.locator(".global-context-menu").getByTitle("Text editor").click();
  await lightPage.waitForSelector(".outline-editor-shell");

  const lightThemeStats = await readOutlineThemeStats(lightPage);
  if (lightThemeStats.backgroundBrightness < 600) {
    throw new Error(`Light outline theme rendered too dark: ${JSON.stringify(lightThemeStats)}`);
  }
  await lightContext.close();

  return {
    darkBackground: darkThemeStats.backgroundColor,
    lightBackground: lightThemeStats.backgroundColor,
    subtreeCollapse: true,
  };
}

async function verifyMobileOutlinePanel(browser) {
  const results = {};
  for (const viewportCase of [
    { name: "portrait", viewport: { width: 390, height: 844 } },
    { name: "landscape", viewport: { width: 844, height: 390 } },
  ]) {
    const context = await browser.newContext({
      viewport: viewportCase.viewport,
      ignoreHTTPSErrors: true,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await seedCompletedOnboarding(page);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas");

    await page.getByLabel("Open atlas menu").click();
    await page.locator(".global-context-menu").getByTitle("Text editor").click();
    const outlinePanel = page.locator(".outline-editor-shell");
    await outlinePanel.waitFor();
    const panelStats = await outlinePanel.evaluate((shell) => {
      const styles = window.getComputedStyle(shell);
      const rect = shell.getBoundingClientRect();
      const visibleWorkspacePanels = Array.from(document.querySelectorAll(".mobile-workspace-panel")).filter((panel) => {
        const panelStyle = window.getComputedStyle(panel);
        const panelRect = panel.getBoundingClientRect();
        return panelStyle.display !== "none" && panelStyle.visibility !== "hidden" && panelRect.width > 0 && panelRect.height > 0;
      }).length;
      return {
        position: styles.position,
        inset: styles.inset,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        visibleWorkspacePanels,
        insideWorkspacePanel: Boolean(shell.closest(".mobile-workspace-panel")),
      };
    });
    if (panelStats.position !== "fixed" || panelStats.insideWorkspacePanel || panelStats.visibleWorkspacePanels > 0) {
      throw new Error(`Mobile ${viewportCase.name} outline editor was not a full-screen surface: ${JSON.stringify(panelStats)}`);
    }
    if (
      Math.abs(panelStats.x) > 1 ||
      Math.abs(panelStats.y) > 1 ||
      Math.abs(panelStats.width - panelStats.viewportWidth) > 2 ||
      Math.abs(panelStats.height - panelStats.viewportHeight) > 2
    ) {
      throw new Error(`Mobile ${viewportCase.name} outline editor did not fill the viewport: ${JSON.stringify(panelStats)}`);
    }
    results[viewportCase.name] = panelStats;
    await context.close();
  }
  return results;
}

async function verifyMobileGlobalMenuScroll(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").waitFor();
  const touchMoveState = await page.evaluate(() => {
    const menu = document.querySelector(".global-context-menu");
    const canvas = document.querySelector("canvas");
    if (!menu || !canvas) return { ok: false, reason: "missing menu or canvas" };
    const createTouchEvent = (type, target, points) => {
      const touches = points.map((point) => new Touch({
        identifier: point.id,
        target,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
        pageX: point.x,
        pageY: point.y,
      }));
      return new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches: touches,
      });
    };
    const menuEvent = createTouchEvent("touchmove", menu, [{ id: 1, x: 22, y: 22 }]);
    menu.dispatchEvent(menuEvent);
    const canvasEvent = createTouchEvent("touchmove", canvas, [{ id: 1, x: 120, y: 180 }]);
    canvas.dispatchEvent(canvasEvent);
    return {
      ok: !menuEvent.defaultPrevented && canvasEvent.defaultPrevented,
      menuDefaultPrevented: menuEvent.defaultPrevented,
      canvasDefaultPrevented: canvasEvent.defaultPrevented,
    };
  });
  if (!touchMoveState.ok) {
    throw new Error(`Mobile global menu touch scrolling was not preserved: ${JSON.stringify(touchMoveState)}`);
  }
  await context.close();
  return touchMoveState;
}

async function verifyMobileCanvasPinchZoom(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1100);

  const pinchState = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "missing canvas" };
    const createTouchEvent = (type, points) => {
      const touches = points.map((point) => new Touch({
        identifier: point.id,
        target: canvas,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
        pageX: point.x,
        pageY: point.y,
      }));
      return new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        targetTouches: touches,
        changedTouches: touches,
      });
    };
    const readOffset = () => {
      const raw = window.localStorage.getItem("mind-atlas-ui-state-v1");
      if (!raw) return 0;
      return JSON.parse(raw).cameraPose?.offset ?? 0;
    };
    const beforeOffset = readOffset();
    const startEvent = createTouchEvent("touchstart", [
      { id: 1, x: 150, y: 360 },
      { id: 2, x: 240, y: 360 },
    ]);
    canvas.dispatchEvent(startEvent);
    const moveEvent = createTouchEvent("touchmove", [
      { id: 1, x: 90, y: 360 },
      { id: 2, x: 300, y: 360 },
    ]);
    canvas.dispatchEvent(moveEvent);
    const endEvent = createTouchEvent("touchend", []);
    canvas.dispatchEvent(endEvent);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const afterOffset = readOffset();
    return {
      ok: moveEvent.defaultPrevented && afterOffset > beforeOffset + 20,
      beforeOffset,
      afterOffset,
      startDefaultPrevented: startEvent.defaultPrevented,
      moveDefaultPrevented: moveEvent.defaultPrevented,
    };
  });
  if (!pinchState.ok) {
    throw new Error(`Mobile canvas pinch zoom did not update the camera: ${JSON.stringify(pinchState)}`);
  }

  await context.close();
  return pinchState;
}

async function verifyMobileCanvasInterruptionRecovery(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1150);

  const recoveryState = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: "missing canvas" };
    const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
    const dispatchPointer = (type, pointerId, x, y, buttons) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        }),
      );
    };
    const readPose = () => {
      const raw = window.localStorage.getItem("mind-atlas-ui-state-v1");
      const cameraPose = raw ? JSON.parse(raw).cameraPose : null;
      return {
        yaw: Number(cameraPose?.yaw ?? 0),
        pitch: Number(cameraPose?.pitch ?? 0),
      };
    };

    dispatchPointer("pointerdown", 4101, 310, 370, 1);
    dispatchPointer("pointermove", 4101, 270, 400, 1);
    await wait(980);
    dispatchPointer("pointermove", 4101, 245, 414, 1);
    await wait(80);
    const interruptedPose = readPose();

    document.dispatchEvent(new Event("freeze"));
    document.dispatchEvent(new Event("resume"));
    await wait(120);

    dispatchPointer("pointerdown", 4102, 300, 370, 1);
    dispatchPointer("pointermove", 4102, 342, 344, 1);
    await wait(980);
    dispatchPointer("pointermove", 4102, 368, 330, 1);
    dispatchPointer("pointerup", 4102, 368, 330, 0);
    await wait(80);
    const recoveredPose = readPose();
    const recoveredDelta = Math.abs(recoveredPose.yaw - interruptedPose.yaw) + Math.abs(recoveredPose.pitch - interruptedPose.pitch);
    return {
      ok: recoveredDelta > 0.001,
      interruptedPose,
      recoveredPose,
      recoveredDelta,
    };
  });
  if (!recoveryState.ok) {
    throw new Error(`Mobile canvas did not recover after an interrupted pointer session: ${JSON.stringify(recoveryState)}`);
  }

  await context.close();
  return recoveryState;
}

async function verifyMobileTutorialRootBirth(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.locator(".onboarding-center-pulse").waitFor();
  await page.waitForTimeout(420);

  const beforeCount = await readPersistedNodeCount(page);
  if (beforeCount > 1) {
    throw new Error(`Fresh mobile tutorial should not start with user nodes: count=${beforeCount}`);
  }

  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("Could not locate mobile tutorial canvas.");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }],
  });
  await page.waitForTimeout(1850);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await page.waitForFunction(
    () => {
      const progressRaw = window.localStorage.getItem("mind-atlas-onboarding-v1");
      const notebookRaw = window.localStorage.getItem("mind-atlas-notebook-v2");
      if (!progressRaw || !notebookRaw) return false;
      const progress = JSON.parse(progressRaw);
      const root = JSON.parse(notebookRaw);
      return progress.rootNodeCreated === true && (root.children?.length ?? 0) >= 1;
    },
    undefined,
    { timeout: 6000 },
  );
  const afterCount = await readPersistedNodeCount(page);
  if (afterCount <= beforeCount) {
    throw new Error(`Mobile tutorial touch long press did not create the first node: before=${beforeCount}, after=${afterCount}`);
  }
  const pulseCount = await page.locator(".onboarding-center-pulse").count();
  if (pulseCount > 0) {
    throw new Error("Mobile tutorial root pulse remained after first-node creation.");
  }

  await context.close();
  return { beforeCount, afterCount };
}

async function verifyMobileGeneratedLayoutVisibility(browser) {
  const results = {};
  for (const viewportCase of [
    { name: "desktop", viewport: { width: 1440, height: 920 }, isMobile: false },
    { name: "portrait", viewport: { width: 390, height: 844 } },
    { name: "landscape", viewport: { width: 844, height: 390 } },
  ]) {
    const context = await browser.newContext({
      viewport: viewportCase.viewport,
      ignoreHTTPSErrors: true,
      ...(viewportCase.isMobile === false ? {} : { isMobile: true, hasTouch: true }),
    });
    for (const layoutMode of ["tree", "mind-map"]) {
      const page = await context.newPage();
      await seedCompletedOnboarding(page);
      await seedGeneratedLayoutNotebook(page, layoutMode);
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForSelector("canvas");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(1800);
      const coverage = await readGeneratedLayoutCoverage(page, viewportCase.name, layoutMode);
      if (!coverage.activeInside || coverage.insideCount < Math.max(1, coverage.total - 1)) {
        throw new Error(`${viewportCase.name} ${layoutMode} layout did not keep visible nodes in view: ${JSON.stringify(coverage)}`);
      }
      if (!coverage.focusAligned) {
        throw new Error(`${viewportCase.name} ${layoutMode} layout focus was not aligned to the reserved viewport center: ${JSON.stringify(coverage)}`);
      }
      results[`${viewportCase.name}-${layoutMode}`] = coverage;
      await page.close();
    }
    await context.close();
  }
  return results;
}

async function verifyPhyllotaxisFocusOffset(browser) {
  const results = {};
  for (const viewportCase of [
    { name: "desktop", viewport: { width: 1440, height: 920 }, isMobile: false },
    { name: "portrait", viewport: { width: 390, height: 844 } },
    { name: "landscape", viewport: { width: 844, height: 390 } },
  ]) {
    const context = await browser.newContext({
      viewport: viewportCase.viewport,
      ignoreHTTPSErrors: true,
      ...(viewportCase.isMobile === false ? {} : { isMobile: true, hasTouch: true }),
    });
    const page = await context.newPage();
    await seedCompletedOnboarding(page);
    await seedGeneratedLayoutNotebook(page, "phyllotaxis");
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("canvas");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(1800);
    const coverage = await readGeneratedLayoutCoverage(page, viewportCase.name, "phyllotaxis");
    if (!coverage.activeInside) {
      throw new Error(`${viewportCase.name} phyllotaxis focus node was outside the usable viewport: ${JSON.stringify(coverage)}`);
    }
    if (!coverage.focusAligned) {
      throw new Error(`${viewportCase.name} phyllotaxis focus was not aligned to the reserved viewport center: ${JSON.stringify(coverage)}`);
    }
    results[viewportCase.name] = coverage;
    await context.close();
  }
  return results;
}

async function verifyTreeWheelZoomDoesNotAutoFocus(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page, "tree");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForSelector('textarea.space-title-editor[data-node-id="verify-child"]', { state: "visible" });
  await page.waitForTimeout(900);

  const before = await readCommandDockProbe(page);
  if (before.editorSelected !== "false") {
    throw new Error(`Tree wheel test should start with root selected and child unselected: ${JSON.stringify(before)}`);
  }

  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("Tree wheel test could not find canvas bounds.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(90);
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(900);

  const after = await readCommandDockProbe(page);
  if (after.editorSelected !== "false" || after.activeNodeId === "verify-child") {
    throw new Error(`Tree wheel zoom should not auto-focus the single child node: ${JSON.stringify(after)}`);
  }

  await context.close();
  return { childSelectedAfterWheel: after.editorSelected };
}

async function verifyOperationControls(browser) {
  const expectedOperationLabels = ["Tab", "Enter", "up", "down", "left", "right"];
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await mobileContext.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.getByRole("tab", { name: "AI" }).waitFor();
  const portraitOperationTabCount = await page.getByRole("tab", { name: "Operation" }).count();
  if (portraitOperationTabCount > 0) {
    throw new Error(`Portrait mobile operation tab should be removed: count=${portraitOperationTabCount}`);
  }
  const portraitMobileSlotCount = await page.locator(".mobile-operation-slot").count();
  if (portraitMobileSlotCount > 0) {
    throw new Error(`Portrait mobile operation slot should be removed: count=${portraitMobileSlotCount}`);
  }
  const portraitToolbar = page.locator(".operation-panel-desktop");
  await portraitToolbar.waitFor();
  const portraitOperationLabels = await portraitToolbar.locator(".operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(portraitOperationLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Portrait mobile operation labels/order changed: ${JSON.stringify(portraitOperationLabels)}`);
  }
  const portraitToolbarBox = await portraitToolbar.boundingBox();
  const portraitToolbarCenterY = portraitToolbarBox ? portraitToolbarBox.y + portraitToolbarBox.height / 2 : Number.NaN;
  const portraitExpectedCenterY = (844 - Math.min(844 * 0.3, 236)) / 2;
  if (!portraitToolbarBox || portraitToolbarBox.x > 40 || portraitToolbarBox.height < 250 || Math.abs(portraitToolbarCenterY - portraitExpectedCenterY) > 18) {
    throw new Error(`Portrait mobile operation toolbar was not centered in the free workspace area: ${JSON.stringify({ box: portraitToolbarBox, portraitExpectedCenterY })}`);
  }
  await portraitToolbar.getByRole("button", { name: "Go to child layer" }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") === "true",
  );
  await portraitToolbar.getByRole("button", { name: "Go to parent layer" }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") !== "true",
  );
  await portraitToolbar.getByRole("button", { name: "Add child" }).click();
  await page.waitForFunction(
    () => {
      const selected = document.querySelector('textarea.space-title-editor[data-selected="true"]');
      return selected && selected.getAttribute("data-node-id") !== "verify-child";
    },
  );
  await mobileContext.close();

  const mobileLandscapeContext = await browser.newContext({
    viewport: { width: 844, height: 390 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const mobileLandscapePage = await mobileLandscapeContext.newPage();
  await seedCompletedOnboarding(mobileLandscapePage);
  await seedSingleChildNotebook(mobileLandscapePage);
  await mobileLandscapePage.goto(baseUrl, { waitUntil: "networkidle" });
  await mobileLandscapePage.waitForSelector("canvas");
  await mobileLandscapePage.getByRole("tab", { name: "AI" }).waitFor();
  await mobileLandscapePage.getByRole("tab", { name: "Operation" }).evaluate((button) => button.click());
  const operationSlot = mobileLandscapePage.locator(".mobile-operation-slot");
  const mobileOperationLabels = await operationSlot.locator(".operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(mobileOperationLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Landscape mobile operation labels/order changed: ${JSON.stringify(mobileOperationLabels)}`);
  }
  const mobileDesktopToolbarCount = await mobileLandscapePage.locator(".operation-panel-desktop").count();
  if (mobileDesktopToolbarCount > 0) {
    throw new Error(`Desktop operation toolbar was rendered on landscape mobile: count=${mobileDesktopToolbarCount}`);
  }
  const mobileOperationLayout = await operationSlot.locator(".operation-panel-mobile").evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const buttons = Array.from(panel.querySelectorAll(".operation-button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
    const firstTop = buttons[0]?.y ?? 0;
    return {
      buttonCount: buttons.length,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
      maxTopDelta: buttons.reduce((max, button) => Math.max(max, Math.abs(button.y - firstTop)), 0),
      maxButtonWidth: buttons.reduce((max, button) => Math.max(max, button.width), 0),
      maxButtonHeight: buttons.reduce((max, button) => Math.max(max, button.height), 0),
      overflow: buttons.some(
        (button) =>
          button.x < panelRect.x - 1 ||
          button.y < panelRect.y - 1 ||
          button.x + button.width > panelRect.x + panelRect.width + 1 ||
          button.y + button.height > panelRect.y + panelRect.height + 1,
      ),
    };
  });
  if (
    mobileOperationLayout.buttonCount !== 6 ||
    mobileOperationLayout.maxTopDelta > 3 ||
    mobileOperationLayout.maxButtonHeight > 42 ||
    mobileOperationLayout.maxButtonWidth > 64 ||
    mobileOperationLayout.overflow
  ) {
    throw new Error(`Landscape mobile operation buttons did not fit in one compact row: ${JSON.stringify(mobileOperationLayout)}`);
  }
  await operationSlot.getByRole("button", { name: "Go to child layer" }).click();
  await mobileLandscapePage.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") === "true",
  );
  await operationSlot.getByRole("button", { name: "Go to parent layer" }).click();
  await mobileLandscapePage.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") !== "true",
  );
  await operationSlot.getByRole("button", { name: "Add child" }).click();
  await mobileLandscapePage.waitForFunction(
    () => {
      const selected = document.querySelector('textarea.space-title-editor[data-selected="true"]');
      return selected && selected.getAttribute("data-node-id") !== "verify-child";
    },
  );
  await mobileLandscapeContext.close();

  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const desktopPage = await desktopContext.newPage();
  await seedCompletedOnboarding(desktopPage);
  await seedSingleChildNotebook(desktopPage);
  await desktopPage.goto(baseUrl, { waitUntil: "networkidle" });
  await desktopPage.waitForSelector("canvas");
  const desktopToolbar = desktopPage.locator(".operation-panel-desktop");
  await desktopToolbar.waitFor();
  const toolbarBox = await desktopToolbar.boundingBox();
  const viewportCenterY = 820 / 2;
  const toolbarCenterY = toolbarBox ? toolbarBox.y + toolbarBox.height / 2 : Number.NaN;
  if (!toolbarBox || toolbarBox.x > 80 || toolbarBox.height < 250 || Math.abs(toolbarCenterY - viewportCenterY) > 12) {
    throw new Error(`Desktop operation toolbar was not left-aligned vertically: ${JSON.stringify(toolbarBox)}`);
  }
  const visibleMobileOperationPanels = await desktopPage.locator(".operation-panel-mobile").evaluateAll((panels) =>
    panels.filter((panel) => {
      const style = window.getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      return style.display !== "none" && rect.width > 0 && rect.height > 0;
    }).length,
  );
  if (visibleMobileOperationPanels > 0) {
    throw new Error("Mobile operation panel was visible on desktop.");
  }
  const desktopOperationLabels = await desktopToolbar.locator(".operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(desktopOperationLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Desktop operation labels/order changed: ${JSON.stringify(desktopOperationLabels)}`);
  }
  await desktopToolbar.getByRole("button", { name: "Go to child layer" }).click();
  await desktopPage.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") === "true",
  );
  await desktopContext.close();

  const lockedDesktopContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const lockedDesktopPage = await lockedDesktopContext.newPage();
  await seedCompletedOnboarding(lockedDesktopPage, { aiUnlocked: false });
  await seedSingleChildNotebook(lockedDesktopPage);
  await lockedDesktopPage.goto(baseUrl, { waitUntil: "networkidle" });
  await lockedDesktopPage.waitForSelector("canvas");
  const lockedDesktopToolbar = lockedDesktopPage.locator(".operation-panel-desktop");
  await lockedDesktopToolbar.waitFor();
  const lockedDesktopLabels = await lockedDesktopToolbar.locator(".operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(lockedDesktopLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Locked desktop operation labels/order changed: ${JSON.stringify(lockedDesktopLabels)}`);
  }
  await lockedDesktopContext.close();

  const lockedMobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const lockedMobilePage = await lockedMobileContext.newPage();
  await seedCompletedOnboarding(lockedMobilePage, { aiUnlocked: false });
  await seedSingleChildNotebook(lockedMobilePage);
  await lockedMobilePage.goto(baseUrl, { waitUntil: "networkidle" });
  await lockedMobilePage.waitForSelector("canvas");
  const lockedMobileToolbar = lockedMobilePage.locator(".operation-panel-desktop");
  await lockedMobileToolbar.waitFor();
  const lockedMobileLabels = await lockedMobileToolbar.locator(".operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(lockedMobileLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Locked portrait mobile operation labels/order changed: ${JSON.stringify(lockedMobileLabels)}`);
  }
  const lockedMobileOperationTabCount = await lockedMobilePage.getByRole("tab", { name: "Operation" }).count();
  if (lockedMobileOperationTabCount > 0) {
    throw new Error(`Locked portrait mobile operation tab should be removed: count=${lockedMobileOperationTabCount}`);
  }
  await lockedMobileContext.close();

  const lockedMobileLandscapeContext = await browser.newContext({
    viewport: { width: 844, height: 390 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const lockedMobileLandscapePage = await lockedMobileLandscapeContext.newPage();
  await seedCompletedOnboarding(lockedMobileLandscapePage, { aiUnlocked: false });
  await seedSingleChildNotebook(lockedMobileLandscapePage);
  await lockedMobileLandscapePage.goto(baseUrl, { waitUntil: "networkidle" });
  await lockedMobileLandscapePage.waitForSelector("canvas");
  await lockedMobileLandscapePage.locator("canvas").tap({ position: { x: 24, y: 180 } });
  await lockedMobileLandscapePage.getByRole("tab", { name: "Operation" }).waitFor();
  await lockedMobileLandscapePage.getByRole("tab", { name: "Operation" }).evaluate((button) => button.click());
  const lockedMobileLandscapeOperationLabels = await lockedMobileLandscapePage
    .locator(".mobile-operation-slot .operation-button small")
    .evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(lockedMobileLandscapeOperationLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Locked landscape mobile operation labels/order changed: ${JSON.stringify(lockedMobileLandscapeOperationLabels)}`);
  }
  await lockedMobileLandscapeContext.close();

  return {
    portraitMobileLeftToolbar: true,
    landscapeMobileOperationTab: true,
    desktopLeftToolbar: true,
    lockedDesktopLeftToolbar: true,
    lockedPortraitMobileLeftToolbar: true,
    lockedLandscapeMobileOperationTab: true,
  };
}

async function verifyEditorTitleAndKeyboardCreateFocus(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const desktopToolbar = page.locator(".operation-panel-desktop");
  await desktopToolbar.waitFor();
  await desktopToolbar.getByRole("button", { name: "Go to child layer" }).click();
  await page.locator(".focus-panel .node-title-input").waitFor();

  const editedTitle = "Panel Title Edit";
  await page.locator(".focus-panel .node-title-input").fill(editedTitle);
  await page.waitForFunction(
    (title) => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.value === title,
    editedTitle,
  );

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForTimeout(80);
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => {
    const active = document.activeElement;
    const selectedEditor = document.querySelector('textarea.space-title-editor[data-selected="true"]');
    return active?.classList.contains("node-body-input") && selectedEditor?.getAttribute("data-node-id") !== "verify-child";
  });

  const state = await page.evaluate(() => {
    const active = document.activeElement;
    const selectedEditor = document.querySelector('textarea.space-title-editor[data-selected="true"]');
    return {
      activeClass: active instanceof HTMLElement ? active.className : "",
      activeBody: active?.classList.contains("node-body-input") ?? false,
      selectedNodeId: selectedEditor?.getAttribute("data-node-id") ?? null,
      selectedTitle: selectedEditor instanceof HTMLTextAreaElement ? selectedEditor.value : null,
      panelTitle: document.querySelector(".focus-panel .node-title-input")?.value ?? null,
    };
  });
  if (!state.activeBody) {
    throw new Error(`Editor title/body focus regression: ${JSON.stringify(state)}`);
  }

  await context.close();
  return state;
}

async function verifyCommandDockAndMobileTextTap(browser) {
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await mobileContext.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForSelector('.space-title-preview[data-node-id="verify-child"]', { state: "visible" });
  await page.waitForTimeout(700);

  const initial = await readCommandDockProbe(page);
  if (!initial.commandDockExists || initial.panelTab !== "command") {
    throw new Error(`Command dock should be visible from the root home view: ${JSON.stringify(initial)}`);
  }
  if (!initial.previewExists || initial.editorSelected !== null) {
    throw new Error(`Verify child should start as a lightweight mobile preview: ${JSON.stringify(initial)}`);
  }
  if (initial.previewText !== "Verify Child") {
    throw new Error(`Mobile canvas preview should show the node title, not body text: ${JSON.stringify(initial)}`);
  }

  await page.tap('.space-title-preview[data-node-id="verify-child"]');
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") === "true",
  );
  await page.waitForTimeout(200);
  const afterFirstTap = await readCommandDockProbe(page);
  if (afterFirstTap.activeNodeId === "verify-child") {
    throw new Error(`First mobile tap should activate the node without focusing its title editor: ${JSON.stringify(afterFirstTap)}`);
  }
  if (!afterFirstTap.commandDockExists) {
    throw new Error(`Command dock should stay available while a child node is active: ${JSON.stringify(afterFirstTap)}`);
  }

  await page.tap('textarea.space-title-editor[data-node-id="verify-child"]');
  await page.waitForFunction(() => document.activeElement?.getAttribute?.("data-node-id") === "verify-child");
  const afterSecondTap = await readCommandDockProbe(page);
  if (afterSecondTap.activeNodeId !== "verify-child") {
    throw new Error(`Second mobile tap should focus the title editor: ${JSON.stringify(afterSecondTap)}`);
  }

  await page.locator('textarea.space-title-editor[data-node-id="verify-child"]').blur();
  await page.waitForTimeout(1000);
  await page.locator("canvas").tap({ position: { x: 340, y: 220 } });
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") !== "true",
  );
  await page.waitForSelector(".command-dock", { state: "visible", timeout: 4000 });
  const afterBackgroundTap = await readCommandDockProbe(page);
  if (!afterBackgroundTap.commandDockExists) {
    throw new Error(`Command dock should remain available after returning one level to the root: ${JSON.stringify(afterBackgroundTap)}`);
  }
  if (!afterBackgroundTap.previewExists || afterBackgroundTap.editorSelected !== null) {
    throw new Error(`Background tap should return the child label to its root-level preview state: ${JSON.stringify(afterBackgroundTap)}`);
  }
  await mobileContext.close();

  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const desktopPage = await desktopContext.newPage();
  await seedCompletedOnboarding(desktopPage);
  await seedSingleChildNotebook(desktopPage);
  await desktopPage.goto(baseUrl, { waitUntil: "networkidle" });
  await desktopPage.waitForSelector('textarea.space-title-editor[data-node-id="verify-child"]', { state: "visible" });
  await desktopPage.keyboard.press("ArrowDown");
  await desktopPage.waitForTimeout(700);
  const desktopLabelState = await readCommandDockProbe(desktopPage);
  if (desktopLabelState.editorValue !== "Verify Child" || desktopLabelState.editorPlaceholder !== "Untitled") {
    throw new Error(`Desktop canvas editor should edit title with the new placeholder: ${JSON.stringify(desktopLabelState)}`);
  }
  if (desktopLabelState.dockBottomGap > 24 || desktopLabelState.titleOverlapsDock) {
    throw new Error(`Local command dock should sit at the lower edge without covering the active node title: ${JSON.stringify(desktopLabelState)}`);
  }
  await desktopPage.click('textarea.space-title-editor[data-node-id="verify-child"]');
  await desktopPage.waitForFunction(() => document.activeElement?.getAttribute?.("data-node-id") === "verify-child");
  const desktopState = await readCommandDockProbe(desktopPage);
  await desktopContext.close();

  return {
    rootDockVisible: initial.commandDockExists,
    firstMobileTapFocusedTitle: afterFirstTap.activeNodeId === "verify-child",
    secondMobileTapFocusedTitle: afterSecondTap.activeNodeId === "verify-child",
    zoomedBackgroundDockHidden: !afterBackgroundTap.commandDockExists,
    desktopTapFocusedTitle: desktopState.activeNodeId === "verify-child",
  };
}

async function verifyProviderUsagePanel(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.route("**/api/provider-usage*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-06-25T04:00:00.000Z",
        metrics: [
          {
            id: "openai-rate-primary",
            vendor: "openai",
            vendorLabel: "OPENAI",
            kind: "rate_limit",
            label: "CODEX 5H",
            available: true,
            displayValue: "76%",
            value: 76,
            unit: "%",
            barPercent: 76,
            resetAt: "2026-06-25T05:30:00.000Z",
            source: "codex",
            defaultVisible: true,
          },
          {
            id: "openai-rate-secondary",
            vendor: "openai",
            vendorLabel: "OPENAI",
            kind: "rate_limit",
            label: "CODEX 7D",
            available: true,
            displayValue: "63%",
            value: 63,
            unit: "%",
            barPercent: 63,
            resetAt: "2026-06-28T08:00:00.000Z",
            source: "codex",
            defaultVisible: true,
          },
          {
            id: "claude-plan-five-hour",
            vendor: "claude",
            vendorLabel: "CLAUDE",
            kind: "rate_limit",
            label: "5H",
            available: true,
            displayValue: "42%",
            value: 42,
            unit: "%",
            barPercent: 42,
            resetAt: "2026-06-25T06:00:00.000Z",
            source: "claude-stream",
            defaultVisible: true,
          },
          {
            id: "deepseek-balance",
            vendor: "deepseek",
            vendorLabel: "DEEPSEEK",
            kind: "balance",
            label: "BALANCE",
            available: true,
            displayValue: "USD 19.39",
            value: 19.39,
            unit: "USD",
            barPercent: 100,
            source: "api",
            defaultVisible: true,
          },
        ],
      }),
    });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const panel = page.getByLabel("AI provider usage");
  await panel.waitFor();
  const selectedText = await panel.innerText();
  for (const expected of ["OPENAI", "CODEX 5H", "76%"]) {
    if (!selectedText.includes(expected)) throw new Error(`Selected-provider usage is missing ${expected}: ${selectedText}`);
  }
  if (selectedText.includes("CLAUDE") || selectedText.includes("DEEPSEEK")) {
    throw new Error(`Selected OpenAI usage leaked other providers: ${selectedText}`);
  }
  const selectedOpenAiMetricCount = await page.locator(".provider-usage-metric").count();
  if (selectedOpenAiMetricCount !== 2) throw new Error(`Expected two selected OpenAI metrics, got ${selectedOpenAiMetricCount}`);

  await page.getByRole("button", { name: "All", exact: true }).click();
  const allText = await panel.innerText();
  for (const expected of ["OPENAI", "CLAUDE", "42%", "DEEPSEEK", "USD 19.39"]) {
    if (!allText.includes(expected)) throw new Error(`All-provider usage is missing ${expected}: ${allText}`);
  }
  const allMetricCount = await page.locator(".provider-usage-metric").count();
  if (allMetricCount !== 4) throw new Error(`Expected four all-provider usage metrics, got ${allMetricCount}`);

  await page.getByRole("button", { name: "Select provider usage metrics" }).click();
  const selector = page.getByLabel("Provider usage metric selection");
  await selector.waitFor();
  await page.screenshot({ path: `${outputDir}/provider-usage.png`, fullPage: true });
  const deepSeekToggle = page.locator(".provider-usage-selector label").filter({ hasText: "DEEPSEEK" }).locator('input[type="checkbox"]');
  await deepSeekToggle.uncheck();
  const filteredMetricCount = await page.locator(".provider-usage-metric").count();
  if (filteredMetricCount !== 3) throw new Error(`Provider usage metric selection did not filter rows: ${filteredMetricCount}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("AI provider usage").waitFor();
  await page.getByRole("button", { name: "All", exact: true }).click();
  const persistedMetricCount = await page.locator(".provider-usage-metric").count();
  if (persistedMetricCount !== 3) throw new Error(`Provider usage selection did not persist: ${persistedMetricCount}`);

  await page.getByRole("button", { name: "Code" }).click();
  const backendSelect = page.locator('.code-options-row select[title="Choose the code backend for this node-anchored run."]');
  await backendSelect.selectOption("claude-subscription");
  await page.getByRole("button", { name: "Selected", exact: true }).waitFor();
  const claudeText = await panel.innerText();
  const selectedClaudeMetricCount = await page.locator(".provider-usage-metric").count();
  if (selectedClaudeMetricCount !== 1 || !claudeText.includes("CLAUDE") || !claudeText.includes("42%")) {
    throw new Error(`Claude Pro selection did not isolate its allowance: ${claudeText}`);
  }

  await context.close();
  return { selectedOpenAiMetricCount, allMetricCount, filteredMetricCount, persistedMetricCount, selectedClaudeMetricCount };
}

async function verifyIosTouchSuppression(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.locator(".tutorial-skip-button").waitFor();
  const styles = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const skip = document.querySelector(".tutorial-skip-button");
    const canvas = document.querySelector("canvas");
    if (!(shell instanceof HTMLElement) || !(skip instanceof HTMLElement) || !(canvas instanceof HTMLElement)) {
      throw new Error("Missing iOS touch-protection targets.");
    }
    const read = (element) => {
      const style = window.getComputedStyle(element);
      return {
        userSelect: style.userSelect,
        webkitUserSelect: style.getPropertyValue("-webkit-user-select"),
        webkitTouchCallout: style.getPropertyValue("-webkit-touch-callout"),
        tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
      };
    };
    return {
      shell: read(shell),
      skip: read(skip),
      canvas: read(canvas),
    };
  });
  for (const [target, style] of Object.entries(styles)) {
    if (style.userSelect !== "none" && style.webkitUserSelect !== "none") {
      throw new Error(`iOS touch target ${target} still allows native text selection: ${JSON.stringify(styles)}`);
    }
  }
  await context.close();
  return styles;
}

async function verifyMobileEditorKeyboardOverlay(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForSelector('.space-title-preview[data-node-id="verify-child"]', { state: "visible" });
  await page.tap('.space-title-preview[data-node-id="verify-child"]');
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") === "true",
  );
  await page.getByRole("tab", { name: "Editor" }).click();
  const bodyInput = page.locator('.mobile-editor-slot[aria-hidden="false"] .node-body-input');
  await bodyInput.waitFor();
  await page.waitForTimeout(1250);
  const shellRectBeforeKeyboard = await readUniverseShellRect(page);
  const titleCenterBeforeKeyboard = await readVerifyChildTitleCenterY(page);
  await page.evaluate(() => {
    window.__mindAtlasKeyboardProfileEvents = 0;
    window.__mindAtlasKeyboardShellResizes = 0;
    window.addEventListener("mind-atlas-mobile-keyboard-profile", () => {
      window.__mindAtlasKeyboardProfileEvents += 1;
    });
    const shell = document.querySelector(".universe-shell");
    if (shell instanceof HTMLElement) {
      const observer = new ResizeObserver(() => {
        window.__mindAtlasKeyboardShellResizes += 1;
      });
      observer.observe(shell);
      window.__mindAtlasKeyboardResizeObserver = observer;
    }
  });
  await bodyInput.evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1001, pointerType: "touch" }));
  });
  await page.waitForTimeout(140);
  const preFocusState = await page.evaluate(() => ({
    activeClassName: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
    keyboardOverlay: document.documentElement.getAttribute("data-keyboard-overlay-input"),
  }));
  const shellRectAfterPointerDown = await readUniverseShellRect(page);
  if (preFocusState.keyboardOverlay === "true" || shellRectAfterPointerDown.height < shellRectBeforeKeyboard.height - 4) {
    throw new Error(`Mobile keyboard overlay moved before textarea focus: ${JSON.stringify({ preFocusState, shellRectBeforeKeyboard, shellRectAfterPointerDown })}`);
  }
  await bodyInput.tap();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-keyboard-overlay-input") === "true");
  await page.waitForFunction(
    ({ beforeHeight, beforeY }) => {
      const element =
        document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]') ??
        document.querySelector('.space-title-preview[data-node-id="verify-child"]');
      const shell = document.querySelector(".universe-shell");
      if (!(shell instanceof HTMLElement)) return false;
      if (!(element instanceof HTMLElement)) return false;
      const shellRect = shell.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return shellRect.height < beforeHeight - 120 && rect.y + rect.height / 2 < beforeY - 36;
    },
    { beforeHeight: shellRectBeforeKeyboard.height, beforeY: titleCenterBeforeKeyboard },
    { timeout: 2500 },
  );
  const titleCenterDuringKeyboard = await readVerifyChildTitleCenterY(page);
  const shellRectDuringKeyboard = await readUniverseShellRect(page);
  const overlayState = {
    ...(await page.evaluate(() => {
    const panel = document.querySelector(".mobile-workspace-panel");
    const panelRect = panel?.getBoundingClientRect();
    const minimap = document.querySelector(".minimap");
    const shell = document.querySelector(".universe-shell");
    const shellRect = shell?.getBoundingClientRect();
    const mobileTabs = [...document.querySelectorAll(".mobile-workspace-tabs button")].map((button) => button.textContent?.trim());
    return {
      keyboardOverlay: document.documentElement.getAttribute("data-keyboard-overlay-input"),
      keyboardPortrait: document.documentElement.getAttribute("data-keyboard-overlay-portrait"),
      keyboardState: document.documentElement.getAttribute("data-keyboard-state"),
      spaceLabelOverlay: document.documentElement.getAttribute("data-keyboard-overlay-space-label"),
      keyboardBottomOffset: document.documentElement.style.getPropertyValue("--keyboard-bottom-offset"),
      panelTab: panel?.getAttribute("data-active-tab") ?? null,
      panelRect: panelRect
        ? {
            x: Math.round(panelRect.x),
            y: Math.round(panelRect.y),
            width: Math.round(panelRect.width),
            height: Math.round(panelRect.height),
          }
        : null,
      activeClassName: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
      minimapDisplay: minimap ? window.getComputedStyle(minimap).display : null,
      shellBecameLandscape: shellRect ? shellRect.width > shellRect.height : false,
      mobileTabs,
      operationTabCount: mobileTabs.filter((label) => label === "Operation").length,
      operationSlotCount: document.querySelectorAll(".mobile-operation-slot").length,
      profileEventCount: window.__mindAtlasKeyboardProfileEvents ?? 0,
      shellResizeCount: window.__mindAtlasKeyboardShellResizes ?? 0,
      viewportHeight: window.innerHeight,
      bodyUserSelect: window.getComputedStyle(document.querySelector(".node-body-input")).userSelect,
    };
    })),
    shellRectBeforeKeyboard,
    shellRectDuringKeyboard,
    titleCenterBeforeKeyboard,
    titleCenterDuringKeyboard,
  };
  if (overlayState.keyboardOverlay !== "true" || overlayState.keyboardPortrait !== "true") {
    throw new Error(`Editor body input did not enter mobile keyboard overlay mode: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.spaceLabelOverlay === "true") {
    throw new Error(`Editor body input should not use space-label keyboard hiding: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.panelTab !== "editor" || !overlayState.panelRect || overlayState.panelRect.x > 24 || overlayState.panelRect.width < 330) {
    throw new Error(`Editor keyboard overlay panel looked like the compressed landscape layout: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.panelRect.y < 0 || overlayState.panelRect.y + overlayState.panelRect.height > overlayState.viewportHeight + 1) {
    throw new Error(`Editor keyboard overlay panel escaped the visible viewport: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.profileEventCount > 1 || overlayState.shellResizeCount > 2) {
    throw new Error(`Editor keyboard overlay produced repeated layout recentering: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.bodyUserSelect !== "text") {
    throw new Error(`Editable text must remain selectable while app chrome is protected: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.minimapDisplay !== "none") {
    throw new Error(`Minimap should stay hidden while editor keyboard overlay is active: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.shellBecameLandscape && (overlayState.operationTabCount > 0 || overlayState.operationSlotCount > 0)) {
    throw new Error(`Keyboard overlay should keep the mobile portrait operation surface even when the shell becomes landscape: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.titleCenterDuringKeyboard >= overlayState.titleCenterBeforeKeyboard - 36) {
    throw new Error(`Universe target did not move upward for mobile keyboard overlay: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.shellRectDuringKeyboard.height >= overlayState.shellRectBeforeKeyboard.height - 120) {
    throw new Error(`Universe shell did not shrink for mobile keyboard overlay: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.panelRect && overlayState.shellRectDuringKeyboard.bottom > overlayState.panelRect.y + 2) {
    throw new Error(`Universe shell should end above the mobile editor panel: ${JSON.stringify(overlayState)}`);
  }
  if (
    overlayState.titleCenterDuringKeyboard < overlayState.shellRectDuringKeyboard.y ||
    overlayState.titleCenterDuringKeyboard > overlayState.shellRectDuringKeyboard.bottom
  ) {
    throw new Error(`Edited node should remain inside the shrunken universe shell: ${JSON.stringify(overlayState)}`);
  }
  await bodyInput.evaluate((element) => element.blur());
  await page.evaluate(() => window.__mindAtlasKeyboardResizeObserver?.disconnect());
  await page.waitForFunction(() => document.documentElement.getAttribute("data-keyboard-overlay-input") !== "true", undefined, { timeout: 3500 });
  const settledState = await page.evaluate(() => ({
    keyboardOverlay: document.documentElement.getAttribute("data-keyboard-overlay-input"),
    keyboardPortrait: document.documentElement.getAttribute("data-keyboard-overlay-portrait"),
    keyboardState: document.documentElement.getAttribute("data-keyboard-state"),
    keyboardBottomOffset: document.documentElement.style.getPropertyValue("--keyboard-bottom-offset"),
    keyboardPanelWidth: document.documentElement.style.getPropertyValue("--keyboard-panel-width"),
    keyboardPanelHeight: document.documentElement.style.getPropertyValue("--keyboard-panel-height"),
  }));
  if (settledState.keyboardOverlay === "true" || settledState.keyboardPortrait === "true" || settledState.keyboardState) {
    throw new Error(`Mobile keyboard overlay state did not clear after focus left: ${JSON.stringify(settledState)}`);
  }
  if (settledState.keyboardBottomOffset !== "0px" || settledState.keyboardPanelWidth || settledState.keyboardPanelHeight) {
    throw new Error(`Mobile keyboard overlay metrics did not reset after focus left: ${JSON.stringify(settledState)}`);
  }
  await context.close();

  return { overlayState, settledState };
}

async function readVerifyChildTitleCenterY(page) {
  return page.evaluate(() => {
    const element =
      document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]') ??
      document.querySelector('.space-title-preview[data-node-id="verify-child"]');
    if (!(element instanceof HTMLElement)) throw new Error("Missing verify child label for keyboard camera check.");
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Verify child label was not visible for keyboard camera check.");
    return rect.y + rect.height / 2;
  });
}

async function readUniverseShellRect(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".universe-shell");
    if (!(shell instanceof HTMLElement)) throw new Error("Missing universe shell for keyboard layout check.");
    const rect = shell.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bottom: Math.round(rect.bottom),
    };
  });
}

async function verifyCameraScopedRendering(browser) {
  const childCount = 360;
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await desktopContext.newPage();
  await seedCompletedOnboarding(page);
  const priorityNodeId = "bulk-child-19-17";
  await seedLargeNotebook(page, childCount, "phyllotaxis", priorityNodeId);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1600);
  const desktopCounts = await readBulkLabelCounts(page);
  if (desktopCounts.total <= 0 || desktopCounts.total >= childCount * 0.8) {
    throw new Error(`Camera-scoped rendering did not reduce desktop labels enough: ${JSON.stringify(desktopCounts)}`);
  }
  if (desktopCounts.total > 96) {
    throw new Error(`Desktop graph-distance label budget was exceeded: ${JSON.stringify(desktopCounts)}`);
  }
  if (await page.locator(`[data-node-id="${priorityNodeId}"]`).count() === 0) {
    throw new Error("The active graph-distance anchor label was removed by the desktop label budget.");
  }
  await desktopContext.close();

  const rootPriorityContext = await browser.newContext({
    viewport: { width: 1920, height: 945 },
    ignoreHTTPSErrors: true,
  });
  const rootPriorityPage = await rootPriorityContext.newPage();
  await seedCompletedOnboarding(rootPriorityPage);
  const rootSiblingIds = await seedRootPriorityNotebook(rootPriorityPage);
  await rootPriorityPage.goto(baseUrl, { waitUntil: "networkidle" });
  await rootPriorityPage.waitForSelector("canvas");
  await rootPriorityPage.waitForTimeout(1600);
  const rootPriorityCounts = await rootPriorityPage.evaluate((expectedRootSiblingIds) => ({
    total: document.querySelectorAll("[data-node-id]").length,
    missingRootSiblingIds: expectedRootSiblingIds.filter(
      (nodeId) => !document.querySelector(`[data-node-id="${nodeId}"]`),
    ),
  }), rootSiblingIds);
  if (rootPriorityCounts.total > 96 || rootPriorityCounts.missingRootSiblingIds.length > 0) {
    throw new Error(`Root-level labels lost priority to a high-fanout branch: ${JSON.stringify(rootPriorityCounts)}`);
  }
  await rootPriorityContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  await seedCompletedOnboarding(mobilePage);
  await seedLargeNotebook(mobilePage, childCount, "phyllotaxis");
  await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
  await mobilePage.waitForSelector("canvas");
  await mobilePage.waitForTimeout(1600);
  const mobileCounts = await readBulkLabelCounts(mobilePage);
  if (mobileCounts.total <= 0 || mobileCounts.total >= childCount * 0.8) {
    throw new Error(`Camera-scoped rendering did not reduce mobile labels enough: ${JSON.stringify(mobileCounts)}`);
  }
  if (mobileCounts.total > 56) {
    throw new Error(`Mobile graph-distance label budget was exceeded: ${JSON.stringify(mobileCounts)}`);
  }
  if (mobileCounts.previews <= 0 || mobileCounts.editors >= mobileCounts.previews) {
    throw new Error(`Mobile bulk labels should prefer lightweight previews: ${JSON.stringify(mobileCounts)}`);
  }
  await mobileContext.close();

  return { desktop: desktopCounts, rootPriority: rootPriorityCounts, mobile: mobileCounts };
}

async function verifyExternalImports(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  const samples = [
    {
      name: "import-book.md",
      mimeType: "text/markdown",
      text: "# Imported Book\n\n## Chapter One\nOpening note.\n\n- Scene Alpha\n- Scene Beta",
      expected: ["Imported Book", "Chapter One", "Scene Alpha", "Scene Beta"],
    },
    {
      name: "research.opml",
      mimeType: "text/xml",
      text: `<?xml version="1.0"?><opml version="2.0"><head><title>Research Plan</title></head><body><outline text="Question"><outline text="Source A"/></outline><outline text="Answer"/></body></opml>`,
      expected: ["Research Plan", "Question", "Source A", "Answer"],
    },
    {
      name: "map.mm",
      mimeType: "text/xml",
      text: `<?xml version="1.0"?><map version="1.0.1"><node TEXT="FreeMind Root"><node TEXT="Branch A"><node TEXT="Leaf A1"/></node><node TEXT="Branch B"/></node></map>`,
      expected: ["FreeMind Root", "Branch A", "Leaf A1", "Branch B"],
    },
  ];

  for (const sample of samples) {
    await page.getByLabel("Open atlas menu").click();
    await page.locator('input[type="file"][accept*=".mindatlas"]').setInputFiles({
      name: sample.name,
      mimeType: sample.mimeType,
      buffer: Buffer.from(sample.text, "utf8"),
    });
    await page.waitForFunction(
      (expectedTitle) => document.querySelector('input[aria-label="Dataset name"]')?.value === expectedTitle,
      sample.expected[0],
    );
    await page.getByRole("button", { name: "MindAtlas" }).click();
    await page.getByLabel("Open atlas menu").click();
    await page.locator(".global-context-menu").getByTitle("Text editor").click();
    await page.waitForSelector(".outline-editor-shell");
    const outlineTitles = await page.locator('input[aria-label="Node title"]').evaluateAll((inputs) =>
      inputs.map((input) => input.value),
    );
    for (const expected of sample.expected) {
      if (!outlineTitles.includes(expected)) {
        throw new Error(`Imported ${sample.name} outline is missing ${expected}: ${outlineTitles.join(", ")}`);
      }
    }
    await page.getByRole("button", { name: /Close/i }).click();
  }

  await page.getByRole("button", { name: "MindAtlas" }).click();
  await page.getByLabel("Open atlas menu").click();
  await page.getByText("Import text outline").click();
  await page.getByLabel("Markdown outline text").fill("# Pasted Outline\n\n## Act One\n\n- Beat One");
  await page.getByRole("button", { name: "Append as children" }).click();
  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Text editor").click();
  await page.waitForSelector(".outline-editor-shell");
  const appendedTitles = await page.locator('input[aria-label="Node title"]').evaluateAll((inputs) =>
    inputs.map((input) => input.value),
  );
  for (const expected of ["Act One", "Beat One"]) {
    if (!appendedTitles.includes(expected)) {
      throw new Error(`Append as children is missing ${expected}: ${appendedTitles.join(", ")}`);
    }
  }
  await page.getByRole("button", { name: /Close/i }).click();

  await page.getByLabel("Open atlas menu").click();
  await page.getByText("Import text outline").click();
  await page.getByLabel("Markdown outline text").fill("# Preview Rewrite\n\nPreview rewritten body");
  await page.getByRole("button", { name: "Preview merge" }).click();
  await page.getByRole("dialog", { name: "Preview merge" }).waitFor();
  await page.getByRole("button", { name: "Apply merge" }).click();
  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Text editor").click();
  await page.waitForSelector(".outline-editor-shell");
  const previewTitles = await page.locator('input[aria-label="Node title"]').evaluateAll((inputs) =>
    inputs.map((input) => input.value),
  );
  if (!previewTitles.includes("Preview Rewrite")) {
    throw new Error(`Preview merge did not apply incoming title: ${previewTitles.join(", ")}`);
  }

  await context.close();
  return { imported: samples.map((sample) => sample.name), textImport: "append and preview merge" };
}

async function verifyVoiceLogDialog(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.route("**/api/openclaw/options", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          { model: "deepseek/deepseek-v4-pro", displayName: "DeepSeek V4 Pro", input: "text", contextWindow: 200000, local: false },
          { model: "lmstudio/qwen/qwen3.6-27b", displayName: "Qwen 3.6 27B", input: "text+image", contextWindow: 65536, local: true },
        ],
        defaultModel: "deepseek/deepseek-v4-pro",
        defaultTimeoutMs: 600000,
      }),
    });
  });
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "mind-atlas-voice-log-v1",
      JSON.stringify([
        {
          id: "verify-voice-tool",
          role: "tool",
          title: "Tool result: delete_node",
          text: "delete_node requires human approval and was not executed.",
          status: "approval_required",
          toolName: "delete_node",
          createdAt: now,
          metadata: {
            approvalId: "voice-approval-verify",
            toolName: "delete_node",
            args: { nodeId: "atlas-root", reason: "verify" },
            status: "pending_user_approval",
            executed: false,
          },
        },
        {
          id: "verify-openclaw-partner",
          role: "assistant",
          title: "AI Partner (OpenClaw)",
          text: "OpenClaw root reply ready.",
          sessionId: "openclaw-partner-verify",
          createdAt: now,
          metadata: {
            provider: "openclaw",
            model: "deepseek/deepseek-v4-pro",
          },
        },
      ]),
    );
    window.localStorage.setItem(
      "mind-atlas-voice-summary-v1",
      JSON.stringify({ text: "Verification summary", createdAt: now, sessionId: "verify-session" }),
    );
    window.localStorage.setItem("mind-atlas-voice-log-last-seen-v1", "2000-01-01T00:00:00.000Z");
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const openClawNotification = page.locator(".unread-notification-link.is-voice-log");
  await openClawNotification.waitFor();
  const openClawNotificationText = await openClawNotification.innerText();
  const openClawNotificationTitle = await openClawNotification.getAttribute("title");
  if (openClawNotificationTitle !== "AI Partner (OpenClaw)") {
    throw new Error(`OpenClaw AI Partner reply did not create an unread notification: ${openClawNotificationTitle ?? openClawNotificationText}`);
  }
  await openClawNotification.click();
  await page.getByRole("dialog", { name: "AI Partner log" }).waitFor();
  const dialogText = await page.getByRole("dialog", { name: "AI Partner log" }).innerText();
  for (const expected of [
    "2 entries / 1 approval pending",
    "Latest summary",
    "Verification summary",
    "OpenClaw root reply ready.",
    "Human approval required. This tool request was logged but not executed.",
    "approval: voice-approval-verify",
    "executed: false",
    "args: nodeId=atlas-root, reason=verify",
  ]) {
    if (!dialogText.includes(expected)) {
      throw new Error(`Voice log dialog is missing ${expected}: ${dialogText}`);
    }
  }
  await page.getByLabel("Close AI Partner log").click();
  await page.getByRole("button", { name: "OpenClaw" }).click();
  const modelSelect = page.getByLabel("OpenClaw model");
  await modelSelect.waitFor();
  const modelOptions = await modelSelect.locator("option").allTextContents();
  if (modelOptions.length !== 2 || !modelOptions.some((option) => option.includes("Qwen 3.6 27B"))) {
    throw new Error(`OpenClaw model selector did not use available models: ${JSON.stringify(modelOptions)}`);
  }
  const agentInputCount = await page.locator('.openclaw-options-row input[placeholder="default"]').count();
  if (agentInputCount > 0) {
    throw new Error("OpenClaw settings still expose the obsolete Agent input.");
  }
  const timeoutWidth = await page.locator(".openclaw-timeout-field input").evaluate((input) => input.getBoundingClientRect().width);
  if (timeoutWidth > 100) {
    throw new Error(`OpenClaw timeout input is too wide: ${timeoutWidth}px`);
  }
  await context.close();
  return { approvalPending: 1, openClawNotification: true, openClawModels: modelOptions.length, timeoutWidth: Math.round(timeoutWidth) };
}

async function verifyAgentRecoveryNotification(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  let acknowledged = false;
  const agentRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/agent-runs/")) {
      agentRequests.push({ method: request.method(), url: request.url(), body: request.postData() });
    }
  });
  await page.route("**/health", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, bridge: "verify" }) });
  });
  await page.route("**/api/agent-runs/inbox", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: acknowledged
          ? []
          : [{
              id: "verify-agent-recovery",
              provider: "claude",
              status: "completed",
              startedAt: "2026-07-19T00:00:00.000Z",
              completedAt: "2026-07-19T00:01:00.000Z",
              clientRunId: "verify-agent-run",
              workspace: "C:\\verify\\workspace",
              model: "claude-verify",
              prompt: "Recover this coding request.",
              result: {
                id: "verify-agent-result",
                provider: "anthropic",
                model: "claude-verify",
                output: {
                  title: "Recovered result",
                  body: "Recovered coding response from the durable inbox.",
                  summary: "Recovered coding response.",
                  suggestedStatus: "needs_review",
                  tags: [],
                },
                rawText: "Recovered coding response from the durable inbox.",
              },
            }],
      }),
    });
  });
  await page.route("**/api/agent-runs/ack", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.ids?.includes("verify-agent-recovery")) acknowledged = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ acknowledged: 1 }) });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const notification = page.locator(".unread-notification-link.is-voice-log");
  await notification.waitFor();
  const title = await notification.getAttribute("title");
  if (title !== "Recovered Claude Code result") {
    throw new Error(`Recovered agent result did not create an unread AI Partner notification: ${title ?? "missing title"}`);
  }
  await notification.click();
  const dialog = page.getByRole("dialog", { name: "AI Partner log" });
  await dialog.waitFor();
  const dialogText = await dialog.innerText();
  for (const expected of ["Recover this coding request.", "Recovered coding response from the durable inbox."]) {
    if (!dialogText.includes(expected)) throw new Error(`Recovered agent log is missing ${expected}: ${dialogText}`);
  }
  for (let attempt = 0; attempt < 20 && !acknowledged; attempt += 1) await page.waitForTimeout(25);
  if (!acknowledged) {
    throw new Error(`Recovered agent journal was not acknowledged after being stored in the AI Partner log: ${JSON.stringify(agentRequests)}`);
  }
  await context.close();
  return { notificationTitle: title, acknowledged };
}

async function verifyShareFlows(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      value: (data) => Array.isArray(data?.files) && data.files.length === 1 && data.files[0]?.type === "image/png",
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: async (data) => {
        const file = data.files?.[0];
        const bitmap = file ? await createImageBitmap(file) : null;
        const dataUrl = file
          ? await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            })
          : "";
        window.__mindAtlasImageShare = {
          fileName: file?.name ?? "",
          fileType: file?.type ?? "",
          fileSize: file?.size ?? 0,
          width: bitmap?.width ?? 0,
          height: bitmap?.height ?? 0,
          title: data.title ?? "",
          text: data.text ?? "",
        };
        window.__mindAtlasImageShareDataUrl = dataUrl;
        bitmap?.close();
      },
      configurable: true,
    });
  });
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.getByLabel("Share atlas image").click();
  await page.waitForFunction(() => Boolean(window.__mindAtlasImageShare));
  const imageShare = await page.evaluate(() => window.__mindAtlasImageShare);
  if (
    imageShare.fileType !== "image/png"
    || imageShare.fileSize < 10_000
    || imageShare.width < 1000
    || imageShare.height < 600
    || !imageShare.text.includes("https://mind-atlas.org/")
    || !imageShare.text.includes("#MindAtlas")
  ) {
    throw new Error(`Share atlas image did not produce a usable social image: ${JSON.stringify(imageShare)}`);
  }
  const shareImageDataUrl = await page.evaluate(() => window.__mindAtlasImageShareDataUrl);
  await writeFile(`${outputDir}/share-atlas.png`, Buffer.from(shareImageDataUrl.split(",")[1], "base64"));

  await page.getByLabel("Open atlas menu").click();
  await page.getByRole("button", { name: /Create embedded-data URL/ }).click();
  const sharedUrl = await waitForClipboardText(page, (text) => text.includes("#mindatlas="));
  if (!sharedUrl.startsWith(baseUrl) || !sharedUrl.includes("#mindatlas=")) {
    throw new Error(`Embedded-data URL action did not create a Mind Atlas URL: ${sharedUrl.slice(0, 120)}`);
  }
  if (sharedUrl.includes("verify-child") || sharedUrl.includes("Verify Child")) {
    throw new Error("Embedded-data URL leaked source node ids or plain title text.");
  }

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  });
  const fallbackDownloadPromise = page.waitForEvent("download");
  await page.getByLabel("Share atlas image").click();
  const fallbackDownload = await fallbackDownloadPromise;
  const fallbackFileName = fallbackDownload.suggestedFilename();
  if (!fallbackFileName.endsWith(".png")) {
    throw new Error(`Unsupported native sharing did not fall back to a PNG download: ${fallbackFileName}`);
  }

  const receiver = await context.newPage();
  await seedCompletedOnboarding(receiver);
  await receiver.goto(sharedUrl, { waitUntil: "networkidle" });
  await receiver.getByRole("dialog", { name: "Shared Mind Atlas" }).waitFor();
  await receiver.getByRole("button", { name: "Import shared atlas" }).click();
  await receiver.waitForSelector("textarea.space-title-editor", { state: "visible" });
  await receiver.waitForFunction(() =>
    [...document.querySelectorAll("textarea.space-title-editor")].some((editor) => editor.value === "Verify Child"),
  );
  const imported = await receiver.evaluate(() => {
    const editor = [...document.querySelectorAll("textarea.space-title-editor")].find((item) => item.value === "Verify Child");
    return {
      title: editor?.value ?? "",
      id: editor?.getAttribute("data-node-id") ?? "",
      hash: window.location.hash,
    };
  });
  if (imported.title !== "Verify Child" || imported.id === "verify-child" || imported.hash) {
    throw new Error(`Shared atlas import did not restore and clear URL hash: ${JSON.stringify(imported)}`);
  }
  await context.close();
  return {
    imageWidth: imageShare.width,
    imageHeight: imageShare.height,
    imageBytes: imageShare.fileSize,
    fallbackFileName,
    urlCharacters: sharedUrl.length,
  };
}

async function waitForClipboardText(page, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  let latest = "";
  while (Date.now() - startedAt < timeoutMs) {
    latest = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    if (predicate(latest)) return latest;
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out waiting for clipboard text. Latest: ${latest.slice(0, 120)}`);
}

async function verifyLockedModeGlobalMenu(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page, { aiUnlocked: false });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  await page.getByLabel("Open atlas menu").click();
  const menu = page.locator(".global-context-menu");
  await menu.getByLabel("Mode", { exact: true }).waitFor();
  await menu.getByText("Restore from history").waitFor();
  await menu.getByText("Import text outline").waitFor();
  await menu.getByText("Tutorial mode").waitFor();

  const aiLogItemCount = await menu.getByText("AI Partner log").count();
  if (aiLogItemCount !== 1) {
    throw new Error(`Locked mode should expose read-only AI Partner log once, found ${aiLogItemCount}.`);
  }
  const sourceLink = menu.getByRole("link", { name: "Source code and license" });
  const sourceHref = await sourceLink.getAttribute("href");
  const sourceText = await sourceLink.innerText();
  if (sourceHref !== "https://github.com/openceo2025/mind-atlas" || !sourceText.includes("AGPL-3.0-only")) {
    throw new Error(`Source/license link is incorrect: ${sourceHref} / ${sourceText}`);
  }

  await menu.getByTitle("Tree").click();
  await menu.waitFor({ state: "detached" });
  await page.waitForTimeout(220);
  await page.getByLabel("Open atlas menu").click();
  await menu.getByText("Restore from history").click();
  await page.getByRole("dialog", { name: "Restore from history" }).waitFor();
  await page.getByRole("button", { name: /Close/i }).click();

  await page.getByLabel("Open atlas menu").click();
  await menu.getByText("Import text outline").click();
  await page.getByRole("dialog", { name: "Import text outline" }).waitFor();

  await context.close();
  return { visibleSharedItems: ["Mode", "AI Partner log", "Restore from history", "Import text outline", "Tutorial mode", "Source code & legal"] };
}

async function verifyTutorialModeMenuActions(browser) {
  const clickContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const clickPage = await clickContext.newPage();
  await seedCompletedOnboarding(clickPage, { aiUnlocked: true });
  await clickPage.goto(baseUrl, { waitUntil: "networkidle" });
  await clickPage.waitForSelector("canvas");
  const originalCount = await addTutorialVerificationChild(clickPage);
  let menu;

  await clickPage.getByLabel("Open atlas menu").click();
  menu = clickPage.locator(".global-context-menu");
  await menu.getByTitle("Tree").click();
  await menu.waitFor({ state: "detached" });
  await clickPage.waitForTimeout(240);

  await clickPage.getByLabel("Open atlas menu").click();
  menu = clickPage.locator(".global-context-menu");
  const tutorialButton = menu.getByRole("button", { name: /Tutorial mode/ });
  await tutorialButton.waitFor();
  clickPage.once("dialog", (dialog) => dialog.dismiss());
  await tutorialButton.click();
  await clickPage.waitForTimeout(160);
  const countAfterCancel = await readPersistedNodeCount(clickPage);
  if (countAfterCancel !== originalCount) {
    throw new Error(`Tutorial cancel changed notebook node count: before=${originalCount}, after=${countAfterCancel}`);
  }

  clickPage.once("dialog", (dialog) => dialog.accept());
  await tutorialButton.click();
  await clickPage.waitForFunction(() => {
    const raw = window.localStorage.getItem("mind-atlas-onboarding-v1");
    if (!raw) return false;
    const progress = JSON.parse(raw);
    return progress.firstRun === true && progress.rootNodeCreated === false && progress.aiUnlocked === false;
  });
  await clickPage.waitForFunction(() => {
    const notebookRaw = window.localStorage.getItem("mind-atlas-notebook-v2");
    if (!notebookRaw) return true;
    const root = JSON.parse(notebookRaw);
    return (root.children?.length ?? 0) === 0;
  });
  await clickPage.locator(".onboarding-center-pulse").waitFor();
  const tutorialLayoutMode = await clickPage.evaluate(() => {
    const raw = window.localStorage.getItem("mind-atlas-ui-state-v1");
    return raw ? JSON.parse(raw).layoutMode : null;
  });
  if (tutorialLayoutMode !== "phyllotaxis") {
    throw new Error(`Tutorial mode should reset tree layout to phyllotaxis, got ${tutorialLayoutMode}`);
  }

  const canvasBox = await clickPage.locator("canvas").boundingBox();
  if (!canvasBox) throw new Error("Could not locate tutorial canvas after tree reset.");
  let tutorialNodeCreated = false;
  for (const [xRatio, yRatio] of [[0.5, 0.5], [0.58, 0.46], [0.42, 0.54]]) {
    await clickPage.mouse.move(canvasBox.x + canvasBox.width * xRatio, canvasBox.y + canvasBox.height * yRatio);
    await clickPage.mouse.down();
    await clickPage.waitForTimeout(1720);
    await clickPage.mouse.up();
    try {
      await clickPage.waitForFunction(() => {
        const progressRaw = window.localStorage.getItem("mind-atlas-onboarding-v1");
        const notebookRaw = window.localStorage.getItem("mind-atlas-notebook-v2");
        if (!progressRaw || !notebookRaw) return false;
        const progress = JSON.parse(progressRaw);
        const root = JSON.parse(notebookRaw);
        return progress.rootNodeCreated === true && (root.children?.length ?? 0) >= 1;
      }, undefined, { timeout: 3500 });
      tutorialNodeCreated = true;
      break;
    } catch {
      // R3F can occasionally drop one synthetic pointer sequence in a long browser suite.
    }
  }
  if (!tutorialNodeCreated) throw new Error("Tutorial root node was not created after three long-press attempts.");
  await clickPage.evaluate(() => {
    window.dispatchEvent(new CustomEvent("mindatlas:onboarding-event", { detail: { type: "node-editor-opened" } }));
    window.dispatchEvent(new CustomEvent("mindatlas:onboarding-event", { detail: { type: "node-text-edited" } }));
  });
  const tutorialOperationPanel = clickPage.locator(".operation-panel-desktop");
  await tutorialOperationPanel.waitFor();
  const addChildButton = tutorialOperationPanel.getByRole("button", { name: "Add child" });
  await addChildButton.click();
  await addChildButton.click();
  const completionStartedAt = Date.now();
  await clickPage.waitForFunction(() => {
    const raw = window.localStorage.getItem("mind-atlas-onboarding-v1");
    if (!raw) return false;
    const progress = JSON.parse(raw);
    return progress.nodeEditCompleted === true && progress.nodeCountReached === true && progress.spaceBasicsCompleted === false;
  });
  const tutorialCompleteDialog = clickPage.getByRole("alertdialog", { name: "Tutorial complete" });
  const tutorialNextDialog = clickPage.getByRole("alertdialog", { name: "How would you like to begin?" });
  const startSpaceDialog = clickPage.getByRole("dialog", { name: "Choose how to start" });
  await clickPage.waitForTimeout(1000);
  if ((await tutorialCompleteDialog.count()) || (await tutorialNextDialog.count()) || (await startSpaceDialog.count())) {
    throw new Error("Tutorial completion flow opened before the three-node completion feedback was visible for five seconds.");
  }
  if ((await clickPage.locator(".minimap").count()) || (await clickPage.getByLabel("Open atlas menu").count())) {
    throw new Error("Main UI unlocked before the tutorial-complete acknowledgement.");
  }
  await tutorialCompleteDialog.waitFor({ timeout: 7000 });
  const templateDelayMs = Date.now() - completionStartedAt;
  if (templateDelayMs < 4500) {
    throw new Error(`Tutorial completion acknowledgement delay was too short: ${templateDelayMs}ms.`);
  }
  if (await startSpaceDialog.count()) {
    throw new Error("Template chooser should not compete with the tutorial-complete acknowledgement.");
  }
  await tutorialCompleteDialog.getByRole("button", { name: "OK", exact: true }).click();
  await tutorialCompleteDialog.waitFor({ state: "detached" });
  await clickPage.locator(".minimap").waitFor();
  await clickPage.getByLabel("Open atlas menu").waitFor();
  await clickPage.waitForTimeout(350);
  if (await tutorialNextDialog.count()) {
    throw new Error("The next-step choice covered the main UI before its unlock animation could be seen.");
  }
  await tutorialNextDialog.waitFor({ timeout: 2200 });
  if (await startSpaceDialog.count()) {
    throw new Error("Template chooser should remain closed until the user chooses to use a template.");
  }
  await tutorialNextDialog.getByRole("button", { name: "Use a template", exact: true }).waitFor();
  await tutorialNextDialog.getByRole("button", { name: "Continue with these nodes", exact: true }).click();
  await tutorialNextDialog.waitFor({ state: "detached" });
  const preservedTutorialNodeCount = await readPersistedNodeCount(clickPage);
  if (preservedTutorialNodeCount < 4) {
    throw new Error(`Tutorial no-template continuation should preserve created nodes, got ${preservedTutorialNodeCount}.`);
  }
  await clickContext.close();

  return {
    tutorialResetConfirmed: true,
    completionAcknowledgementConfirmed: true,
    noTemplateContinuationConfirmed: true,
    templateChoiceOfferedConfirmed: true,
    templateDelayMs,
  };
}

async function addTutorialVerificationChild(page) {
  await page.locator(".operation-panel-desktop").getByRole("button", { name: "Add child" }).click();
  await page.waitForFunction(() => {
    const stored = window.localStorage.getItem("mind-atlas-notebook-v2");
    if (!stored) return false;
    const countNodes = (node) => 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
    return countNodes(JSON.parse(stored)) >= 2;
  });
  return readPersistedNodeCount(page);
}

async function seedCompletedOnboarding(page, { aiUnlocked = true } = {}) {
  await page.addInitScript((seed) => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "mind-atlas-onboarding-v1",
      JSON.stringify({
        version: 1,
        firstRun: false,
        rootNodeCreated: true,
        nodeEditorOpened: true,
        nodeEditCompleted: true,
        nodeCountReached: true,
        pan: true,
        zoom: true,
        nodeDrag: true,
        childNodeCreated: true,
        spaceBasicsCompleted: true,
        basicCompleted: true,
        aiUnlocked: seed.aiUnlocked,
        titlePromptApplied: true,
        startedAt: now,
        completedAt: now,
      }),
    );
  }, { aiUnlocked });
}

async function seedSingleChildNotebook(page, layoutMode = "phyllotaxis", childPatch = {}) {
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
    title: "Verify Root",
    subtitle: "Verify Root",
    body: "Verify root body",
    color: "#8df5cf",
    radius: 80,
    summary: "Verify root",
    ...baseFields,
    children: [
      {
        id: "verify-child",
        kind: "thread",
        nodeType: "human_prompt",
        title: "Verify Child",
        subtitle: "Verify Child",
        body: "Child body for mobile tap",
        color: "#94a3ff",
        radius: 48,
        summary: "Verify child",
        ...baseFields,
        children: [],
        ...childPatch,
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
        layoutMode: seed.layoutMode,
        mobilePanelTab: "command",
      }),
    );
  }, { root, now, layoutMode });
}

async function seedAgentRunLinkedNotebook(page) {
  const now = new Date().toISOString();
  const baseFields = {
    kind: "thread",
    nodeType: "human_prompt",
    author: "human",
    status: "needs_review",
    texture: "speckled",
    attachments: [],
    createdAt: now,
    updatedAt: now,
    nextDecision: "",
    tags: [],
    position: [0, 0, 0],
    color: "#94a3ff",
    radius: 48,
    children: [],
  };
  const linkedNode = (suffix) => ({
    ...baseFields,
    id: `agent-request-${suffix}`,
    title: `Agent request ${suffix.toUpperCase()}`,
    subtitle: `Agent request ${suffix.toUpperCase()}`,
    body: `Linked request ${suffix}`,
    summary: `Linked request ${suffix}`,
    aiRunId: `verify-client-${suffix}`,
    agentExecution: {
      clientRunId: `verify-client-${suffix}`,
      runtimeRunId: `verify-runtime-${suffix}`,
      requestedWorkspace: `C:\\verify\\repo-${suffix}`,
      workspaceMode: "shared",
      recordedAt: now,
    },
  });
  const root = {
    ...baseFields,
    id: "atlas-root",
    kind: "root",
    nodeType: "note",
    title: "Agent sync root",
    subtitle: "Agent sync root",
    body: "Agent sync verification",
    summary: "Agent sync root",
    color: "#8df5cf",
    radius: 80,
    children: [
      linkedNode("a"),
      linkedNode("b"),
      {
        ...baseFields,
        id: "unlinked-note",
        title: "Unlinked note",
        subtitle: "Unlinked note",
        body: "No durable agent run",
        summary: "Unlinked note",
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
        mobilePanelTab: "command",
      }),
    );
  }, { root, now });
}

function createAgentRunManifest(runId, clientRunId, requestNodeId, workspace, now) {
  return {
    schemaVersion: 1,
    runId,
    clientRunId,
    provider: "codex",
    route: "codex-app-server",
    requestedRoute: "codex-app-server",
    status: "completed",
    requestNodeId,
    sourceNodeId: "atlas-root",
    workspace,
    sourceWorkspace: workspace,
    workspaceMode: "shared",
    worktree: null,
    model: "gpt-verify",
    effort: "medium",
    permissionMode: "default",
    sandboxMode: "workspace-write",
    authMode: "subscription",
    title: `Verify ${runId}`,
    session: null,
    ownership: { state: "mind_atlas", leaseId: `lease-${runId}`, acquiredAt: now },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    lastEventSequence: 0,
    finalEventId: "",
    acknowledgedAt: now,
  };
}

async function seedNestedNotebook(page, { selectedNodeId = "atlas-root", layoutMode = "phyllotaxis", renderQuality = "high" } = {}) {
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
    title: "Nested Root",
    subtitle: "Nested Root",
    body: "Nested root body",
    color: "#8df5cf",
    radius: 80,
    summary: "Nested root",
    ...baseFields,
    children: [
      {
        id: "nested-parent",
        kind: "thread",
        nodeType: "human_prompt",
        title: "Nested Parent",
        subtitle: "Nested Parent",
        body: "Parent body",
        color: "#94a3ff",
        radius: 48,
        summary: "Nested parent",
        ...baseFields,
        children: [
          {
            id: "nested-child",
            kind: "thread",
            nodeType: "human_prompt",
            title: "Nested Child",
            subtitle: "Nested Child",
            body: "Child body",
            color: "#f0a06d",
            radius: 48,
            summary: "Nested child",
            ...baseFields,
            children: [],
          },
        ],
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
        selectedNodeId: seed.selectedNodeId,
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: seed.renderQuality,
        layoutMode: seed.layoutMode,
        mobilePanelTab: "command",
      }),
    );
  }, { root, now, selectedNodeId, layoutMode, renderQuality });
}

async function seedMissingTitleNotebook(page) {
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
    title: "Verify Root",
    subtitle: "Verify Root",
    body: "Verify root body",
    color: "#8df5cf",
    radius: 80,
    summary: "Verify root",
    ...baseFields,
    children: [
      {
        id: "missing-title-child",
        kind: "thread",
        nodeType: "human_prompt",
        title: "",
        subtitle: "",
        body: "本文だけで作られた過去ノードです。起動時にタイトルへ補完されます。",
        color: "#94a3ff",
        radius: 48,
        summary: "Missing title child",
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
        mobilePanelTab: "command",
      }),
    );
  }, { root, now });
}

async function seedLargeNotebook(page, childCount, layoutMode = "phyllotaxis", selectedNodeId = "atlas-root") {
  const now = new Date().toISOString();
  const topLevelCount = 20;
  const childrenPerTopLevel = Math.ceil(childCount / topLevelCount);
  const makeBulkNode = (id, index, children = []) => ({
    id,
    kind: "thread",
    nodeType: "human_prompt",
    title: `Bulk Child ${index}`,
    subtitle: `Bulk Child ${index}`,
    body: `Bulk child ${index}`,
    author: "human",
    status: "waiting",
    color: index % 2 === 0 ? "#94a3ff" : "#8df5cf",
    texture: index % 3 === 0 ? "bands" : "speckled",
    radius: 48,
    summary: `Bulk child ${index}`,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  });
  const root = {
    id: "atlas-root",
    kind: "root",
    nodeType: "note",
    title: "Bulk Verify Root",
    subtitle: "Bulk Verify Root",
    body: "Bulk root body",
    author: "human",
    status: "waiting",
    color: "#8df5cf",
    texture: "speckled",
    radius: 80,
    summary: "Bulk verify root",
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children: Array.from({ length: topLevelCount }, (_, index) => makeBulkNode(
      `bulk-child-${index}`,
      index,
      Array.from({ length: childrenPerTopLevel }, (_, childIndex) => makeBulkNode(`bulk-child-${index}-${childIndex}`, index * childrenPerTopLevel + childIndex)),
    )),
  };
  await page.addInitScript((seed) => {
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(seed.root));
    window.localStorage.setItem(
      "mind-atlas-ui-state-v1",
      JSON.stringify({
        version: 1,
        savedAt: seed.now,
        selectedNodeId: seed.selectedNodeId,
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: seed.layoutMode,
        mobilePanelTab: "command",
      }),
    );
  }, { root, now, layoutMode, selectedNodeId });
}

async function seedRootPriorityNotebook(page) {
  const now = new Date().toISOString();
  const makeNode = (id, title, children = []) => ({
    id,
    kind: "thread",
    nodeType: "note",
    title,
    subtitle: title,
    body: title,
    author: "human",
    status: "waiting",
    color: "#94a3ff",
    texture: "bands",
    radius: 48,
    summary: title,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  });
  const rootSiblingIds = Array.from({ length: 7 }, (_, index) => `root-priority-sibling-${index}`);
  const root = {
    ...makeNode("atlas-root", "Root priority verify", [
      makeNode(
        "root-priority-anchor",
        "Root priority anchor",
        Array.from({ length: 140 }, (_, index) => makeNode(`root-priority-child-${index}`, `Root priority child ${index}`)),
      ),
      ...rootSiblingIds.map((id, index) => makeNode(id, `Root priority sibling ${index}`)),
    ]),
    kind: "root",
    radius: 80,
  };
  await page.addInitScript((seed) => {
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(seed.root));
    window.localStorage.setItem(
      "mind-atlas-ui-state-v1",
      JSON.stringify({
        version: 1,
        savedAt: seed.now,
        selectedNodeId: "root-priority-anchor",
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: "phyllotaxis",
        mobilePanelTab: "command",
      }),
    );
  }, { root, now });
  return rootSiblingIds;
}

async function seedGeneratedLayoutNotebook(page, layoutMode, selectedNodeId = "atlas-root") {
  const now = new Date().toISOString();
  const makeNode = (id, title, children = []) => ({
    id,
    kind: id === "atlas-root" ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: title,
    body: `${title} body`,
    author: "human",
    status: "waiting",
    color: id.endsWith("1") ? "#94a3ff" : "#8df5cf",
    texture: "speckled",
    radius: id === "atlas-root" ? 80 : 48,
    summary: title,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    children,
  });
  const root = makeNode("atlas-root", "Root", [
    makeNode("layout-alpha", "Alpha", [makeNode("layout-alpha-1", "Alpha 1"), makeNode("layout-alpha-2", "Alpha 2")]),
    makeNode("layout-beta", "Beta", [makeNode("layout-beta-1", "Beta 1")]),
    makeNode("layout-gamma", "Gamma"),
    makeNode("layout-delta", "Delta"),
  ]);
  await page.addInitScript((seed) => {
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(seed.root));
    window.localStorage.setItem(
      "mind-atlas-ui-state-v1",
      JSON.stringify({
        version: 1,
        savedAt: seed.now,
        selectedNodeId: seed.selectedNodeId,
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: seed.layoutMode,
        mobilePanelTab: "command",
      }),
    );
  }, { root, now, layoutMode, selectedNodeId });
}

async function seedCalendarNotebook(page) {
  const now = new Date().toISOString();
  const makeNode = (id, title, reminderAt, children = []) => ({
    id,
    kind: id === "atlas-root" ? "root" : "thread",
    nodeType: "note",
    title,
    subtitle: title,
    body: `${title} body`,
    author: "human",
    status: "waiting",
    color: id.endsWith("1") ? "#94a3ff" : "#8df5cf",
    texture: "speckled",
    radius: id === "atlas-root" ? 80 : 48,
    summary: title,
    nextDecision: "",
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    ...(reminderAt ? { reminderAt } : {}),
    children,
  });
  const root = makeNode("atlas-root", "Calendar root", null, [
    makeNode("calendar-unscheduled", "No reminder", null),
    makeNode("calendar-dense-1", "Morning", "2026-07-13T09:00:00"),
    makeNode("calendar-dense-2", "Noon", "2026-07-13T12:00:00"),
    makeNode("calendar-dense-3", "Afternoon", "2026-07-13T15:00:00"),
    makeNode("calendar-dense-4", "Evening", "2026-07-13T18:00:00"),
    makeNode("calendar-dense-5", "Night", "2026-07-13T21:00:00"),
    makeNode("calendar-next-week", "Next week", "2026-07-20T10:00:00"),
  ]);
  await page.addInitScript((seed) => {
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(seed.root));
    window.localStorage.setItem(
      "mind-atlas-ui-state-v1",
      JSON.stringify({
        version: 1,
        savedAt: seed.now,
        selectedNodeId: "calendar-dense-1",
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: "calendar",
        mobilePanelTab: "editor",
      }),
    );
  }, { root, now });
}

function readBulkLabelCounts(page) {
  return page.evaluate(() => ({
    total: document.querySelectorAll('[data-node-id^="bulk-child-"]').length,
    editors: document.querySelectorAll('textarea.space-title-editor[data-node-id^="bulk-child-"]').length,
    previews: document.querySelectorAll('.space-title-preview[data-node-id^="bulk-child-"]').length,
  }));
}

function readGeneratedLayoutCoverage(page, viewportName, layoutMode) {
  return page.evaluate(({ viewportName, layoutMode }) => {
    const reserved = getReservedArea(viewportName, window.innerWidth, window.innerHeight);
    const usableLeft = reserved.left;
    const usableTop = reserved.top;
    const usableRight = window.innerWidth - reserved.right;
    const usableBottom = window.innerHeight - reserved.bottom;
    const usableWidth = Math.max(1, usableRight - usableLeft);
    const usableHeight = Math.max(1, usableBottom - usableTop);
    const treeBias = layoutMode === "tree" ? getTreeBias(viewportName, usableWidth, usableHeight) : { x: 0, y: 0 };
    const expectedFocusX = window.innerWidth / 2 + (reserved.left - reserved.right) / 2 + treeBias.x;
    const expectedFocusY = window.innerHeight / 2 + (reserved.top - reserved.bottom) / 2 + treeBias.y;
    const labels = [...document.querySelectorAll('[data-node-id^="layout-"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute("data-node-id"),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerX: Math.round(rect.left + rect.width / 2),
        centerY: Math.round(rect.top + rect.height / 2),
        inside: rect.right >= usableLeft && rect.left <= usableRight && rect.bottom >= usableTop && rect.top <= usableBottom,
      };
    });
    const visibleLabels = labels.filter((label) => label.width > 0 && label.height > 0);
    const minX = Math.min(...visibleLabels.map((label) => label.x));
    const maxX = Math.max(...visibleLabels.map((label) => label.x + label.width));
    const minY = Math.min(...visibleLabels.map((label) => label.y));
    const maxY = Math.max(...visibleLabels.map((label) => label.y + label.height));
    const centerX = visibleLabels.length ? (minX + maxX) / 2 : usableRight / 2;
    const centerY = visibleLabels.length ? (minY + maxY) / 2 : usableBottom / 2;
    const centerDeltaX = Math.abs(centerX - usableRight / 2);
    const centerDeltaY = Math.abs(centerY - usableBottom / 2);
    const activeLabel = labels.find((label) => label.id === "layout-alpha");
    // Phyllotaxis labels are anchored below the planet, so infer the planet center from the label box.
    const activeLabelCenterOffsetY = layoutMode === "phyllotaxis" && activeLabel ? activeLabel.height * 8 : 0;
    const focusDeltaX = activeLabel ? activeLabel.centerX - expectedFocusX : Number.POSITIVE_INFINITY;
    const focusDeltaY = activeLabel ? activeLabel.centerY - (expectedFocusY + activeLabelCenterOffsetY) : Number.POSITIVE_INFINITY;
    const focusToleranceX = Math.max(72, usableWidth * 0.14);
    const focusToleranceY = Math.max(72, usableHeight * 0.14);
    return {
      total: labels.length,
      insideCount: labels.filter((label) => label.inside).length,
      activeInside: Boolean(activeLabel?.inside),
      focusAligned: Math.abs(focusDeltaX) <= focusToleranceX && Math.abs(focusDeltaY) <= focusToleranceY,
      centerDeltaX: Math.round(centerDeltaX),
      centerDeltaY: Math.round(centerDeltaY),
      focusDeltaX: Number.isFinite(focusDeltaX) ? Math.round(focusDeltaX) : null,
      focusDeltaY: Number.isFinite(focusDeltaY) ? Math.round(focusDeltaY) : null,
      expectedFocusX: Math.round(expectedFocusX),
      expectedFocusY: Math.round(expectedFocusY),
      expectedLabelCenterY: Math.round(expectedFocusY + activeLabelCenterOffsetY),
      usableLeft: Math.round(usableLeft),
      usableTop: Math.round(usableTop),
      usableRight: Math.round(usableRight),
      usableBottom: Math.round(usableBottom),
      labels,
    };
    function getReservedArea(viewportName, width, height) {
      if (viewportName === "portrait") {
        return { left: 0, right: 0, top: 0, bottom: Math.min(336, height * 0.42) + 24 };
      }
      if (viewportName === "landscape") {
        return { left: 0, right: Math.min(292, width * 0.33) + 24, top: 0, bottom: 0 };
      }
      return { left: 0, right: Math.min(370, Math.max(0, width - 96)), top: 0, bottom: 0 };
    }
    function getTreeBias(viewportName, usableWidth, usableHeight) {
      if (viewportName === "portrait") return { x: 0, y: 0 };
      return { x: 0, y: -Math.min(170, usableHeight * (viewportName === "landscape" ? 0.2 : 0.18)) };
    }
  }, { viewportName, layoutMode });
}

function readCommandDockProbe(page) {
  return page.evaluate(() => {
    const dock = document.querySelector(".command-dock");
    const panel = document.querySelector(".mobile-workspace-panel");
    const editor = document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]');
    const preview = document.querySelector('.space-title-preview[data-node-id="verify-child"]');
    const dockRect = dock?.getBoundingClientRect();
    const titleRect = editor?.getBoundingClientRect();
    const titleOverlapsDock = Boolean(
      dockRect &&
        titleRect &&
        titleRect.right > dockRect.left &&
        titleRect.left < dockRect.right &&
        titleRect.bottom > dockRect.top &&
        titleRect.top < dockRect.bottom,
    );
    return {
      commandDockExists: Boolean(dock),
      dockBottomGap: dockRect ? Math.round(window.innerHeight - dockRect.bottom) : null,
      titleOverlapsDock,
      panelTab: panel?.getAttribute("data-active-tab") ?? null,
      panelClass: panel?.className ?? null,
      editorSelected: editor?.getAttribute("data-selected") ?? null,
      editorValue: editor?.value ?? null,
      editorPlaceholder: editor?.getAttribute("placeholder") ?? null,
      previewExists: Boolean(preview),
      previewText: preview?.textContent ?? null,
      activeNodeId: document.activeElement?.getAttribute?.("data-node-id") ?? null,
      activeTag: document.activeElement?.tagName ?? null,
    };
  });
}

function readOutlineTitleValues(page) {
  return page.locator('input[aria-label="Node title"]').evaluateAll((inputs) => inputs.map((input) => input.value));
}

function readOutlineThemeStats(page) {
  return page.locator(".outline-editor-shell").evaluate((shell) => {
    const backgroundColor = getComputedStyle(shell).backgroundColor;
    const channels = (backgroundColor.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    return {
      backgroundColor,
      backgroundBrightness: channels.reduce((sum, channel) => sum + channel, 0),
    };
  });
}

function readPersistedNodeCount(page) {
  return page.evaluate(() => {
    const stored = window.localStorage.getItem("mind-atlas-notebook-v2");
    if (!stored) return 0;
    const root = JSON.parse(stored);
    const countNodes = (node) => 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
    return countNodes(root);
  });
}

await mkdir(outputDir, { recursive: true });

const browser = await launchBrowser();
async function runStep(name, fn) {
  console.log(`verify:${name}:start`);
  const result = await fn();
  console.log(`verify:${name}:done`);
  return result;
}
try {
  if (process.argv[2] === "share") {
    const shareFlows = await runStep("shareFlows", () => verifyShareFlows(browser));
    console.log("Share UI verification passed");
    console.log({ shareFlows });
    process.exitCode = 0;
  } else if (process.argv[2] === "background-parent") {
    await runStep("backgroundReturnsOneParent", () => verifyBackgroundReturnsOneParent(browser));
    console.log("Background parent verification passed");
  } else if (process.argv[2] === "calendar") {
    const calendarLayout = await runStep("calendarLayout", () => verifyCalendarLayout(browser));
    console.log("Calendar layout verification passed");
    console.log({ calendarLayout });
  } else if (process.argv[2] === "tutorial") {
    const tutorialMode = await runStep("tutorialMode", () => verifyTutorialModeMenuActions(browser));
    console.log("Tutorial completion verification passed");
    console.log({ tutorialMode });
  } else if (process.argv[2] === "mobile-input") {
    const iosTouchSuppression = await runStep("iosTouchSuppression", () => verifyIosTouchSuppression(browser));
    const mobileEditorKeyboard = await runStep("mobileEditorKeyboard", () => verifyMobileEditorKeyboardOverlay(browser));
    console.log("Mobile input verification passed");
    console.log({ iosTouchSuppression, mobileEditorKeyboard });
  } else if (process.argv[2] === "local-developer") {
    const localDeveloperMode = await runStep("localDeveloperMode", () => verifyLocalDeveloperModeSurface(browser));
    console.log("Local developer mode verification passed");
    console.log({ localDeveloperMode });
  } else if (process.argv[2] === "agent-run-sync") {
    const agentRunNodeSync = await runStep("agentRunNodeSync", () => verifyAgentRunNodeSynchronization(browser));
    console.log("Agent run/node synchronization verification passed");
    console.log({ agentRunNodeSync });
  } else if (process.argv[2] === "code-preflight") {
    const codePreflight = await runStep("codePreflight", () => verifyCodePreflightFeedback(browser));
    console.log("Code preflight feedback verification passed");
    console.log({ codePreflight });
  } else if (process.argv[2] === "provider-usage") {
    const providerUsage = await runStep("providerUsage", () => verifyProviderUsagePanel(browser));
    console.log("Provider usage verification passed");
    console.log({ providerUsage });
  } else if (process.argv[2] === "command-dock") {
    const commandDock = await runStep("commandDock", () => verifyCommandDockAndMobileTextTap(browser));
    console.log("Command dock verification passed");
    console.log({ commandDock });
  } else if (process.argv[2] === "notification") {
    const notificationSnoozeActions = await runStep("notificationSnoozeActions", () => verifyNotificationSnoozeActions(browser));
    console.log("Notification verification passed");
    console.log({ notificationSnoozeActions });
  } else if (process.argv[2] === "search") {
    const nodeSearch = await runStep("nodeSearch", () => verifyNodeSearch(browser));
    console.log("Node search UI verification passed");
    console.log({ nodeSearch });
  } else {
    const desktop = await runStep("desktopViewport", () => verifyViewport(browser, "desktop", { width: 1440, height: 920 }));
    const localeSwitching = await runStep("localeSwitching", () => verifyLocaleSwitching(browser));
    const nodeSearch = await runStep("nodeSearch", () => verifyNodeSearch(browser));
    await runStep("layoutModeSwitch", () => verifyLayoutModeSwitch(browser));
    const calendarLayout = await runStep("calendarLayout", () => verifyCalendarLayout(browser));
    const localDeveloperMode = await runStep("localDeveloperMode", () => verifyLocalDeveloperModeSurface(browser));
    const agentRunNodeSync = await runStep("agentRunNodeSync", () => verifyAgentRunNodeSynchronization(browser));
    const notificationSnoozeActions = await runStep("notificationSnoozeActions", () => verifyNotificationSnoozeActions(browser));
    await runStep("generatedLayoutBlocksBackgroundBirth", () => verifyGeneratedLayoutBlocksBackgroundBirth(browser));
    await runStep("backgroundReturnsOneParent", () => verifyBackgroundReturnsOneParent(browser));
    await runStep("stablePhyllotaxisPositions", () => verifyStablePhyllotaxisPositions(browser));
    const konamiBlocked = await runStep("konamiBlocked", () => verifyKonamiDoesNotUnlock(browser));
    const tutorialSkip = await runStep("tutorialSkip", () => verifyTutorialSkipButton(browser));
    await runStep("startupTitleMaintenance", () => verifyStartupMissingTitleMaintenance(browser));
    await runStep("indexedDbBeatsLegacy", () => verifyIndexedDbCurrentBeatsStaleLegacyCache(browser));
    const lockedMenu = await runStep("lockedMenu", () => verifyLockedModeGlobalMenu(browser));
    const tutorialMode = await runStep("tutorialMode", () => verifyTutorialModeMenuActions(browser));
    const voiceLog = await runStep("voiceLog", () => verifyVoiceLogDialog(browser));
    const agentRecovery = await runStep("agentRecovery", () => verifyAgentRecoveryNotification(browser));
    const shareFlows = await runStep("shareFlows", () => verifyShareFlows(browser));
    const outline = await runStep("outline", () => verifyOutlineAndContextCopy(browser));
    const outlineSafety = await runStep("outlineSafety", () => verifyOutlineCollapseAndDeletionSafety(browser));
    const outlineTheme = await runStep("outlineTheme", () => verifyOutlineThemeAndSubtreeCollapse(browser));
    const imports = await runStep("imports", () => verifyExternalImports(browser));
    const mobileOutline = await runStep("mobileOutline", () => verifyMobileOutlinePanel(browser));
    const mobileGlobalMenuScroll = await runStep("mobileGlobalMenuScroll", () => verifyMobileGlobalMenuScroll(browser));
    const mobileCanvasPinchZoom = await runStep("mobileCanvasPinchZoom", () => verifyMobileCanvasPinchZoom(browser));
    const mobileCanvasInterruptionRecovery = await runStep("mobileCanvasInterruptionRecovery", () => verifyMobileCanvasInterruptionRecovery(browser));
    const mobileTutorialRootBirth = await runStep("mobileTutorialRootBirth", () => verifyMobileTutorialRootBirth(browser));
    const mobileGeneratedLayout = await runStep("mobileGeneratedLayout", () => verifyMobileGeneratedLayoutVisibility(browser));
    const phyllotaxisFocusOffset = await runStep("phyllotaxisFocusOffset", () => verifyPhyllotaxisFocusOffset(browser));
    const treeWheelZoom = await runStep("treeWheelZoom", () => verifyTreeWheelZoomDoesNotAutoFocus(browser));
    const operationControls = await runStep("operationControls", () => verifyOperationControls(browser));
    const editorKeyboardCreateFocus = await runStep("editorKeyboardCreateFocus", () => verifyEditorTitleAndKeyboardCreateFocus(browser));
    const commandDock = await runStep("commandDock", () => verifyCommandDockAndMobileTextTap(browser));
    const providerUsage = await runStep("providerUsage", () => verifyProviderUsagePanel(browser));
    const iosTouchSuppression = await runStep("iosTouchSuppression", () => verifyIosTouchSuppression(browser));
    const mobileEditorKeyboard = await runStep("mobileEditorKeyboard", () => verifyMobileEditorKeyboardOverlay(browser));
    const cameraScopedRendering = await runStep("cameraScopedRendering", () => verifyCameraScopedRendering(browser));
    const mobile = await runStep("mobileViewport", () => verifyViewport(browser, "mobile", { width: 390, height: 844 }));
    const mobileLandscape = await runStep("mobileLandscapeViewport", () => verifyViewport(browser, "mobile-landscape", { width: 844, height: 390 }));
    console.log("UI verification passed");
    console.log({ desktop, nodeSearch, calendarLayout, localDeveloperMode, agentRunNodeSync, notificationSnoozeActions, konamiBlocked, tutorialSkip, lockedMenu, tutorialMode, voiceLog, agentRecovery, shareFlows, outline, outlineSafety, outlineTheme, imports, mobileOutline, mobileGlobalMenuScroll, mobileCanvasPinchZoom, mobileCanvasInterruptionRecovery, mobileTutorialRootBirth, mobileGeneratedLayout, phyllotaxisFocusOffset, treeWheelZoom, operationControls, editorKeyboardCreateFocus, commandDock, providerUsage, iosTouchSuppression, mobileEditorKeyboard, cameraScopedRendering, mobile, mobileLandscape });
  }
} finally {
  await browser.close();
}
