import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.MIND_ATLAS_URL ?? "http://127.0.0.1:5173";
const outputDir = "artifacts/screenshots";

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

async function verifyViewport(browser, name, viewport) {
  const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
  await seedCompletedOnboarding(page);
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
  for (const label of ["Tree", "Mind map", "Phyllotaxis"]) {
    await page.getByLabel("Open atlas menu").click();
    await page.getByTitle(label).click();
    await page.locator(".global-context-menu").waitFor({ state: "detached" });
    await page.waitForTimeout(220);
    const hasCanvas = await page.locator("canvas").evaluate((canvas) => {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      return Boolean(gl);
    });
    if (!hasCanvas) throw new Error(`Mode ${label} lost WebGL canvas`);
  }
  await page.getByLabel("Open atlas menu").click();
  await page.locator(".global-context-menu").getByTitle("Outline").click();
  await page.waitForSelector(".outline-editor-shell");
  await page.close();
}

async function verifyGeneratedLayoutBlocksBackgroundBirth(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
  await seedCompletedOnboarding(page);
  await seedSingleChildNotebook(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  for (const label of ["Tree", "Mind map"]) {
    await page.getByLabel("Open atlas menu").click();
    await page.getByTitle(label).click();
    await page.locator(".global-context-menu").waitFor({ state: "detached" });
    await page.waitForTimeout(260);
    const beforeCount = await readPersistedNodeCount(page);
    const box = await page.locator("canvas").boundingBox();
    if (!box) throw new Error(`Missing canvas box while testing ${label} background birth`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1720);
    await page.mouse.up();
    await page.waitForTimeout(180);
    const afterCount = await readPersistedNodeCount(page);
    if (afterCount !== beforeCount) {
      throw new Error(`${label} background long press created a node: before=${beforeCount}, after=${afterCount}`);
    }
  }

  await page.close();
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
  await page.locator(".global-context-menu").getByTitle("Outline").click();
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
  await page.locator(".global-context-menu").getByTitle("Outline").click();
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
    await page.locator(".global-context-menu").getByTitle("Outline").click();
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
    const menuEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    menu.dispatchEvent(menuEvent);
    const canvasEvent = new Event("touchmove", { bubbles: true, cancelable: true });
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

async function verifyMobileGeneratedLayoutVisibility(browser) {
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
    for (const layoutMode of ["tree", "mind-map"]) {
      const page = await context.newPage();
      await seedCompletedOnboarding(page);
      await seedGeneratedLayoutNotebook(page, layoutMode);
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForSelector("canvas");
      await page.waitForTimeout(1800);
      const coverage = await readGeneratedLayoutCoverage(page);
      if (coverage.insideCount < coverage.total) {
        throw new Error(`Mobile ${viewportCase.name} ${layoutMode} layout did not keep visible nodes in view: ${JSON.stringify(coverage)}`);
      }
      if (!coverage.centered) {
        throw new Error(`Mobile ${viewportCase.name} ${layoutMode} layout was not centered in the usable viewport: ${JSON.stringify(coverage)}`);
      }
      results[`${viewportCase.name}-${layoutMode}`] = coverage;
      await page.close();
    }
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
  await page.getByRole("tab", { name: "Operation" }).click();
  const operationSlot = page.locator(".mobile-operation-slot");
  const mobileOperationLabels = await operationSlot.locator(".operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  const expectedOperationLabels = ["Tab", "Enter", "up", "down", "left", "right"];
  if (JSON.stringify(mobileOperationLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Mobile operation labels/order changed: ${JSON.stringify(mobileOperationLabels)}`);
  }
  const mobileDesktopToolbarCount = await page.locator(".operation-panel-desktop").count();
  if (mobileDesktopToolbarCount > 0) {
    throw new Error(`Desktop operation toolbar was rendered on mobile: count=${mobileDesktopToolbarCount}`);
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
    throw new Error(`Mobile operation buttons did not fit in one compact row: ${JSON.stringify(mobileOperationLayout)}`);
  }
  await operationSlot.getByRole("button", { name: "Go to child layer" }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") === "true",
  );
  await operationSlot.getByRole("button", { name: "Go to parent layer" }).click();
  await page.waitForFunction(
    () => document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]')?.getAttribute("data-selected") !== "true",
  );
  await operationSlot.getByRole("button", { name: "Add child" }).click();
  await page.waitForFunction(
    () => {
      const selected = document.querySelector('textarea.space-title-editor[data-selected="true"]');
      return selected && selected.getAttribute("data-node-id") !== "verify-child";
    },
  );
  await mobileContext.close();

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
  await lockedMobilePage.locator("canvas").tap({ position: { x: 24, y: 180 } });
  await lockedMobilePage.getByRole("tab", { name: "Operation" }).waitFor();
  const lockedMobileAiTabCount = await lockedMobilePage.getByRole("tab", { name: "AI" }).count();
  if (lockedMobileAiTabCount > 0) {
    throw new Error("Locked mobile operation panel exposed the AI tab.");
  }
  await lockedMobilePage.getByRole("tab", { name: "Operation" }).click();
  const lockedMobileOperationLabels = await lockedMobilePage.locator(".mobile-operation-slot .operation-button small").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  if (JSON.stringify(lockedMobileOperationLabels) !== JSON.stringify(expectedOperationLabels)) {
    throw new Error(`Locked mobile operation labels/order changed: ${JSON.stringify(lockedMobileOperationLabels)}`);
  }
  await lockedMobileContext.close();

  return { mobileTabs: ["AI", "Editor", "Operation"], desktopLeftToolbar: true, lockedDesktopLeftToolbar: true, lockedMobileOperationTab: true };
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
  await page.locator("canvas").tap({ position: { x: 24, y: 180 } });
  await page.waitForFunction(() => !document.querySelector(".command-dock"));
  const afterBackgroundTap = await readCommandDockProbe(page);
  if (afterBackgroundTap.commandDockExists) {
    throw new Error(`Command dock should hide after a zoomed background tap clears the active node: ${JSON.stringify(afterBackgroundTap)}`);
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
  await desktopPage.waitForTimeout(700);
  const desktopLabelState = await readCommandDockProbe(desktopPage);
  if (desktopLabelState.editorValue !== "Verify Child" || desktopLabelState.editorPlaceholder !== "ここに記入") {
    throw new Error(`Desktop canvas editor should edit title with the new placeholder: ${JSON.stringify(desktopLabelState)}`);
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
  await bodyInput.tap();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-keyboard-overlay-input") === "true");
  const overlayState = await page.evaluate(() => {
    const panel = document.querySelector(".mobile-workspace-panel");
    const panelRect = panel?.getBoundingClientRect();
    const minimap = document.querySelector(".minimap");
    return {
      keyboardOverlay: document.documentElement.getAttribute("data-keyboard-overlay-input"),
      keyboardPortrait: document.documentElement.getAttribute("data-keyboard-overlay-portrait"),
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
    };
  });
  if (overlayState.keyboardOverlay !== "true" || overlayState.keyboardPortrait !== "true") {
    throw new Error(`Editor body input did not enter mobile keyboard overlay mode: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.spaceLabelOverlay === "true") {
    throw new Error(`Editor body input should not use space-label keyboard hiding: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.panelTab !== "editor" || !overlayState.panelRect || overlayState.panelRect.x > 24 || overlayState.panelRect.width < 330) {
    throw new Error(`Editor keyboard overlay panel looked like the compressed landscape layout: ${JSON.stringify(overlayState)}`);
  }
  if (overlayState.minimapDisplay !== "none") {
    throw new Error(`Minimap should stay hidden while editor keyboard overlay is active: ${JSON.stringify(overlayState)}`);
  }
  await context.close();

  return overlayState;
}

async function verifyCameraScopedRendering(browser) {
  const childCount = 360;
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    ignoreHTTPSErrors: true,
  });
  const page = await desktopContext.newPage();
  await seedCompletedOnboarding(page);
  await seedLargeNotebook(page, childCount, "phyllotaxis");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1600);
  const desktopCounts = await readBulkLabelCounts(page);
  if (desktopCounts.total <= 0 || desktopCounts.total >= childCount * 0.8) {
    throw new Error(`Camera-scoped rendering did not reduce desktop labels enough: ${JSON.stringify(desktopCounts)}`);
  }
  await desktopContext.close();

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
  if (mobileCounts.previews <= 0 || mobileCounts.editors >= mobileCounts.previews) {
    throw new Error(`Mobile bulk labels should prefer lightweight previews: ${JSON.stringify(mobileCounts)}`);
  }
  await mobileContext.close();

  return { desktop: desktopCounts, mobile: mobileCounts };
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
    await page.locator(".global-context-menu").getByTitle("Outline").click();
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
  await page.locator(".global-context-menu").getByTitle("Outline").click();
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
  await page.locator(".global-context-menu").getByTitle("Outline").click();
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
      ]),
    );
    window.localStorage.setItem(
      "mind-atlas-voice-summary-v1",
      JSON.stringify({ text: "Verification summary", createdAt: now, sessionId: "verify-session" }),
    );
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.getByLabel("Open atlas menu").click();
  await page.getByText("AI Partner log").click();
  await page.getByRole("dialog", { name: "AI Partner log" }).waitFor();
  const dialogText = await page.getByRole("dialog", { name: "AI Partner log" }).innerText();
  for (const expected of [
    "1 entries / 1 approval pending",
    "Latest summary",
    "Verification summary",
    "Human approval required. This tool request was logged but not executed.",
    "approval: voice-approval-verify",
    "executed: false",
    "args: nodeId=atlas-root, reason=verify",
  ]) {
    if (!dialogText.includes(expected)) {
      throw new Error(`Voice log dialog is missing ${expected}: ${dialogText}`);
    }
  }
  await context.close();
  return { approvalPending: 1 };
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

  const aiOnlyItemCount = await menu.getByText("AI Partner log").count();
  if (aiOnlyItemCount > 0) {
    throw new Error("Locked mode global menu exposed AI Partner log.");
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
  return { visibleSharedItems: ["Mode", "Restore from history", "Import text outline"] };
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

async function seedSingleChildNotebook(page, layoutMode = "phyllotaxis") {
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

async function seedLargeNotebook(page, childCount, layoutMode = "phyllotaxis") {
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
        selectedNodeId: "atlas-root",
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: seed.layoutMode,
        mobilePanelTab: "command",
      }),
    );
  }, { root, now, layoutMode });
}

async function seedGeneratedLayoutNotebook(page, layoutMode) {
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
        selectedNodeId: "atlas-root",
        viewport: { x: 0, y: 0, zoom: 0.92 },
        renderQuality: "high",
        layoutMode: seed.layoutMode,
        mobilePanelTab: "command",
      }),
    );
  }, { root, now, layoutMode });
}

function readBulkLabelCounts(page) {
  return page.evaluate(() => ({
    total: document.querySelectorAll('[data-node-id^="bulk-child-"]').length,
    editors: document.querySelectorAll('textarea.space-title-editor[data-node-id^="bulk-child-"]').length,
    previews: document.querySelectorAll('.space-title-preview[data-node-id^="bulk-child-"]').length,
  }));
}

function readGeneratedLayoutCoverage(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".mobile-workspace-panel")?.getBoundingClientRect();
    const sidePanel = panel && panel.height > window.innerHeight * 0.72 && panel.left > window.innerWidth * 0.45;
    const bottomPanel = panel && !sidePanel && panel.top > window.innerHeight * 0.35;
    const usableRight = sidePanel ? panel.left : window.innerWidth;
    const usableBottom = bottomPanel ? panel.top : window.innerHeight;
    const labels = [...document.querySelectorAll('[data-node-id^="layout-"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.getAttribute("data-node-id"),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inside: rect.right >= 0 && rect.left <= usableRight && rect.bottom >= 0 && rect.top <= usableBottom,
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
    return {
      total: labels.length,
      insideCount: labels.filter((label) => label.inside).length,
      centered: centerDeltaX <= usableRight * 0.24 && centerDeltaY <= usableBottom * 0.26,
      centerDeltaX: Math.round(centerDeltaX),
      centerDeltaY: Math.round(centerDeltaY),
      usableRight: Math.round(usableRight),
      usableBottom: Math.round(usableBottom),
      labels,
    };
  });
}

function readCommandDockProbe(page) {
  return page.evaluate(() => {
    const dock = document.querySelector(".command-dock");
    const panel = document.querySelector(".mobile-workspace-panel");
    const editor = document.querySelector('textarea.space-title-editor[data-node-id="verify-child"]');
    const preview = document.querySelector('.space-title-preview[data-node-id="verify-child"]');
    return {
      commandDockExists: Boolean(dock),
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
try {
  const desktop = await verifyViewport(browser, "desktop", { width: 1440, height: 920 });
  await verifyLayoutModeSwitch(browser);
  await verifyGeneratedLayoutBlocksBackgroundBirth(browser);
  await verifyStartupMissingTitleMaintenance(browser);
  await verifyIndexedDbCurrentBeatsStaleLegacyCache(browser);
  const lockedMenu = await verifyLockedModeGlobalMenu(browser);
  const voiceLog = await verifyVoiceLogDialog(browser);
  const outline = await verifyOutlineAndContextCopy(browser);
  const imports = await verifyExternalImports(browser);
  const mobileOutline = await verifyMobileOutlinePanel(browser);
  const mobileGlobalMenuScroll = await verifyMobileGlobalMenuScroll(browser);
  const mobileGeneratedLayout = await verifyMobileGeneratedLayoutVisibility(browser);
  const treeWheelZoom = await verifyTreeWheelZoomDoesNotAutoFocus(browser);
  const operationControls = await verifyOperationControls(browser);
  const commandDock = await verifyCommandDockAndMobileTextTap(browser);
  const mobileEditorKeyboard = await verifyMobileEditorKeyboardOverlay(browser);
  const cameraScopedRendering = await verifyCameraScopedRendering(browser);
  const mobile = await verifyViewport(browser, "mobile", { width: 390, height: 844 });
  const mobileLandscape = await verifyViewport(browser, "mobile-landscape", { width: 844, height: 390 });
  console.log("UI verification passed");
  console.log({ desktop, lockedMenu, voiceLog, outline, imports, mobileOutline, mobileGlobalMenuScroll, mobileGeneratedLayout, treeWheelZoom, operationControls, commandDock, mobileEditorKeyboard, cameraScopedRendering, mobile, mobileLandscape });
} finally {
  await browser.close();
}
