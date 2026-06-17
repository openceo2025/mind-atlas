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
  await page.getByLabel("Open atlas menu").click();
  for (const label of ["Tree", "Mind map", "Hub emphasis", "Phyllotaxis"]) {
    await page.getByTitle(label).click();
    await page.waitForTimeout(220);
    const hasCanvas = await page.locator("canvas").evaluate((canvas) => {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      return Boolean(gl);
    });
    if (!hasCanvas) throw new Error(`Layout mode ${label} lost WebGL canvas`);
  }
  await page.close();
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
  await page.getByText("Outline editor").click();
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
  await page.getByText("Outline editor").click();
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await seedCompletedOnboarding(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");

  await page.getByLabel("Open atlas menu").click();
  await page.getByText("Outline editor").click();
  const outlinePanel = page.locator('.mobile-workspace-panel[data-active-tab="outline"] .mobile-outline-slot[aria-hidden="false"] .outline-editor-shell');
  await outlinePanel.waitFor();
  const panelStats = await outlinePanel.evaluate((shell) => {
    const styles = window.getComputedStyle(shell);
    const rect = shell.getBoundingClientRect();
    return {
      position: styles.position,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  if (panelStats.position === "fixed") {
    throw new Error(`Mobile outline editor escaped the workspace panel: ${JSON.stringify(panelStats)}`);
  }
  if (panelStats.width > panelStats.viewportWidth || panelStats.height > panelStats.viewportHeight) {
    throw new Error(`Mobile outline editor overflowed the viewport: ${JSON.stringify(panelStats)}`);
  }
  await context.close();
  return panelStats;
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
    await page.getByText("Outline editor").click();
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
  await page.getByText("Outline editor").click();
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
  await page.getByText("Outline editor").click();
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

await mkdir(outputDir, { recursive: true });

const browser = await launchBrowser();
try {
  const desktop = await verifyViewport(browser, "desktop", { width: 1440, height: 920 });
  await verifyLayoutModeSwitch(browser);
  const outline = await verifyOutlineAndContextCopy(browser);
  const imports = await verifyExternalImports(browser);
  const mobileOutline = await verifyMobileOutlinePanel(browser);
  const mobile = await verifyViewport(browser, "mobile", { width: 390, height: 844 });
  const mobileLandscape = await verifyViewport(browser, "mobile-landscape", { width: 844, height: 390 });
  console.log("UI verification passed");
  console.log({ desktop, outline, imports, mobileOutline, mobile, mobileLandscape });
} finally {
  await browser.close();
}
