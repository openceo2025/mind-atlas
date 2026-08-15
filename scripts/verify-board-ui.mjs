import { chromium } from "playwright";

const baseUrl = process.env.MIND_ATLAS_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });

const fixtures = {
  shogi: {
    name: "fixture.kif",
    content: "#KIF version=2.0\n\n手合割：平手\n\n手数----指手---------\n   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角成(88)\n   4 同　銀(31)\n",
    viewer: ".shogi-viewer",
  },
  chess: {
    name: "fixture.pgn",
    content: "[Event \"Mind Atlas board UI\"]\n[Result \"*\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *",
    viewer: ".chess-viewer",
  },
  go: {
    name: "fixture.sgf",
    content: "(;GM[1]FF[4]SZ[9]GN[Mind Atlas board UI];B[dd](;W[cc])(;W[ee]))",
    viewer: ".go-viewer",
  },
};

try {
  await verifyShogi();
  await verifyChess();
  await verifyGo();
  for (const mode of ["shogi", "chess", "go"]) await verifyMobileLayout(mode);
  console.log("verify:board-ui:passed shogi-chess-go desktop-and-mobile");
} finally {
  await browser.close();
}

async function createPage({ width = 1280, height = 900, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const fields = {
      author: "human", status: "waiting", texture: "speckled", attachments: [], createdAt: now, updatedAt: now,
      nextDecision: "", tags: [], position: [0, 0, 0], color: "#94a3ff", radius: 48,
    };
    const root = { id: "atlas-root", kind: "root", nodeType: "note", title: "Board fixture", subtitle: "Board fixture", body: "", summary: "", ...fields, radius: 80, children: [] };
    window.localStorage.setItem("mind-atlas-notebook-v2", JSON.stringify(root));
    window.localStorage.setItem("mind-atlas-onboarding-v1", JSON.stringify({
      version: 1, firstRun: false, rootNodeCreated: true, nodeEditorOpened: true, nodeEditCompleted: true,
      nodeCountReached: true, pan: true, zoom: true, nodeDrag: true, childNodeCreated: true,
      spaceBasicsCompleted: true, basicCompleted: true, aiUnlocked: false, titlePromptApplied: true,
      startedAt: now, completedAt: now,
    }));
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  return { context, page };
}

async function importFixture(page, mode) {
  const fixture = fixtures[mode];
  await page.getByLabel(/Open atlas menu|Mind Atlasメニューを開く/).click();
  const extension = fixture.name.slice(fixture.name.lastIndexOf("."));
  const input = page.locator(`input[type="file"][accept*="${extension}"]`);
  await input.setInputFiles({ name: fixture.name, mimeType: "text/plain", buffer: Buffer.from(fixture.content) });
  await page.locator(fixture.viewer).waitFor({ state: "visible", timeout: 15_000 });
}

function activeFocusPanel(page) {
  return page.locator(".focus-panel.is-board-game-panel:not(.is-hidden)");
}

async function assertBoardModeLayout(page, mode, mobile) {
  const app = page.locator(`main[data-notebook-mode="${mode}"].is-board-game-mode`);
  await app.waitFor();
  const panel = activeFocusPanel(page);
  const board = await panel.locator(".panel-preview-area").boundingBox();
  const text = await panel.locator(".panel-text-section").boundingBox();
  const universe = await page.locator(".universe-shell").boundingBox();
  if (!board || !text || !universe) throw new Error(`${mode} board layout did not render all fixed regions.`);
  if (!mobile && board.x <= text.x + text.width) throw new Error(`${mode} desktop board is not to the right of the editor.`);
  if (!mobile && board.width < page.viewportSize().width * 0.42) throw new Error(`${mode} desktop board is narrower than the reserved right region.`);
  if (mobile && board.y <= page.viewportSize().height / 3) throw new Error(`${mode} mobile board is not anchored to the lower region.`);
  if (mobile && board.width < page.viewportSize().width - 28) throw new Error(`${mode} mobile board does not use the available width.`);
  if (mobile && universe.y + universe.height > board.y + 2) throw new Error(`${mode} mobile universe overlaps the board region.`);
  if (board.height < 180) throw new Error(`${mode} board region is too short: ${board.height}`);
  return { board, text, universe };
}

async function verifyShogi() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "shogi");
    await assertBoardModeLayout(page, "shogi", false);
    await assertDesktopInputLayer(page);
    await expectTexts(page.locator(".shogi-file-coordinates span"), ["9", "8", "7", "6", "5", "4", "3", "2", "1"], "shogi files");
    await expectTexts(page.locator(".shogi-rank-coordinates span"), ["一", "二", "三", "四", "五", "六", "七", "八", "九"], "shogi ranks");
    if (await page.locator(".shogi-candidate-marker").count() !== 1) throw new Error("Shogi root candidate is not marked on the board.");

    for (let ply = 1; ply <= 4; ply += 1) {
      await page.getByRole("button", { name: "一手進む" }).click();
      await page.locator(".shogi-viewer-position").filter({ hasText: `${ply}手目` }).waitFor();
    }
    if (await page.locator('.shogi-hand-host sg-hp-wrap[data-nb="1"]').count() !== 2) {
      throw new Error("Captured shogi pieces are not visible in both hands.");
    }
    if (await page.locator(".shogi-board-host sq.last-dest").count() !== 2) throw new Error("Shogi last move highlight is missing.");

    await page.getByRole("button", { name: "先手と後手を入れ替える" }).click();
    await expectTexts(page.locator(".shogi-file-coordinates span"), ["1", "2", "3", "4", "5", "6", "7", "8", "9"], "flipped shogi files");
    await expectTexts(page.locator(".shogi-rank-coordinates span"), ["九", "八", "七", "六", "五", "四", "三", "二", "一"], "flipped shogi ranks");
    const flipTransforms = await page.evaluate(() => ({
      sente: getComputedStyle(document.querySelector(".shogi-board-host piece.sente"), "::before").transform,
      gote: getComputedStyle(document.querySelector(".shogi-board-host piece.gote"), "::before").transform,
    }));
    if (flipTransforms.sente === "none" || flipTransforms.gote !== "none") throw new Error(`Shogi piece orientation did not flip: ${JSON.stringify(flipTransforms)}`);
    await page.getByRole("button", { name: "先手と後手を入れ替える" }).click();

    await playShogiMove(page, { fromColumn: 7, fromRow: 6, toColumn: 7, toRow: 5 });
    await page.locator(".shogi-viewer-position").filter({ hasText: "5手目" }).waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "一手戻る" }).click();
    await page.locator(".shogi-viewer-position").filter({ hasText: "4手目" }).waitFor();
    if (await page.locator(".shogi-candidate-marker").count() !== 1) throw new Error("New shogi branch is not marked as a candidate.");

    await page.getByRole("button", { name: "Go to parent layer" }).click();
    await page.locator(".shogi-viewer-position").filter({ hasText: "3手目" }).waitFor();
    await verifyGeneratedLayoutFocus(page, "ツリー");
    await verifyGeneratedLayoutFocus(page, "マインドマップ");
  } finally {
    await context.close();
  }
}

async function playShogiMove(page, move) {
  const board = await page.locator(".shogi-board-host").boundingBox();
  if (!board) throw new Error("Shogi board did not get a bounding box.");
  const point = (column, row) => ({ x: board.x + board.width * ((column + 0.5) / 9), y: board.y + board.height * ((row + 0.5) / 9) });
  const from = point(move.fromColumn, move.fromRow);
  const to = point(move.toColumn, move.toRow);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function verifyChess() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "chess");
    await assertBoardModeLayout(page, "chess", false);
    await assertDesktopInputLayer(page);
    if (await page.locator(".chess-board-host svg.cg-shapes g").count() < 1) throw new Error("Chess root candidate arrow is missing.");
    for (let ply = 1; ply <= 5; ply += 1) {
      await page.getByRole("button", { name: "一手進む" }).click();
      await page.locator(".chess-viewer-position").filter({ hasText: `${ply} ply` }).waitFor();
    }
    if (await page.locator(".chess-board-host square.last-move").count() !== 2) throw new Error("Chess last move highlight is missing.");
    const board = await page.locator(".chess-board-host").boundingBox();
    if (!board) throw new Error("Chess board did not get a bounding box.");
    const from = { x: board.x + board.width / 16, y: board.y + board.height * 3 / 16 };
    const to = { x: board.x + board.width / 16, y: board.y + board.height * 5 / 16 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.locator(".chess-viewer-position").filter({ hasText: "6 ply" }).waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "一手戻る" }).click();
    await page.locator(".chess-viewer-position").filter({ hasText: "5 ply" }).waitFor();
    if (await page.locator(".chess-board-host svg.cg-shapes g").count() < 1) throw new Error("New chess branch arrow is missing.");
  } finally {
    await context.close();
  }
}

async function verifyGo() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "go");
    await assertBoardModeLayout(page, "go", false);
    await assertDesktopInputLayer(page);
    await page.getByRole("button", { name: "一手進む" }).click();
    await page.locator(".go-viewer-position").filter({ hasText: "1 手目" }).waitFor();
    if (await page.locator(".go-point.is-last").count() !== 1) throw new Error("Go last move marker is missing.");
    if (await page.locator(".go-point.is-candidate").count() !== 2) throw new Error("Go branch candidates are not marked on the board.");
    const firstCandidate = page.locator(".go-variations button").first();
    await firstCandidate.click();
    await page.locator(".go-viewer-position").filter({ hasText: "2 手目" }).waitFor();
    await page.locator(".go-point").first().click();
    await page.locator(".go-viewer-position").filter({ hasText: "3 手目" }).waitFor();
  } finally {
    await context.close();
  }
}

async function verifyMobileLayout(mode) {
  const { context, page } = await createPage({ width: 390, height: 844, mobile: true });
  try {
    await importFixture(page, mode);
    const { board, text, universe } = await assertBoardModeLayout(page, mode, true);
    const panel = activeFocusPanel(page);
    const body = await panel.locator(".node-body-input").boundingBox();
    const toolbar = await panel.locator(".panel-toolbar").boundingBox();
    const breadcrumb = await page.locator(".atlas-breadcrumb").boundingBox();
    const globalMenu = await page.locator(".global-menu").boundingBox();
    if (!body || !toolbar || !breadcrumb || !globalMenu) throw new Error(`${mode} mobile compact controls are incomplete.`);
    if (body.height > 58) throw new Error(`${mode} mobile body editor is too tall: ${body.height}`);
    if (breadcrumb.x < page.viewportSize().width * 0.48) throw new Error(`${mode} mobile breadcrumb is not on the right.`);
    if (rectsOverlap(breadcrumb, globalMenu) || rectsOverlap(text, globalMenu)) throw new Error(`${mode} mobile header controls overlap.`);
    if (await panel.locator(".editor-panel-role").isVisible()) throw new Error(`${mode} mobile Editor label should be hidden.`);
    if (await panel.locator(".return-button").isVisible()) throw new Error(`${mode} mobile return button should be hidden.`);
    const addSibling = page.getByRole("button", { name: "Add sibling" });
    if (await addSibling.isVisible()) throw new Error(`${mode} mobile Enter operation should be hidden.`);
    if (board.x < 8 || board.x + board.width > page.viewportSize().width - 8) throw new Error(`${mode} mobile board overflows horizontally.`);
    const titleInputs = page.locator('.universe-shell input[aria-label$="のタイトル"]');
    if (await titleInputs.count()) {
      const activeTitle = await titleInputs.last().boundingBox();
      if (activeTitle && !rectsOverlap(activeTitle, universe)) throw new Error(`${mode} active node title is outside the compact universe.`);
    }
  } finally {
    await context.close();
  }
}

async function assertDesktopInputLayer(page) {
  const state = await page.evaluate(() => {
    const focus = document.querySelector(".focus-panel.is-board-game-panel:not(.is-hidden)");
    const operation = document.querySelector(".operation-panel-desktop button");
    if (!focus || !operation) return null;
    const r = operation.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { focusPointerEvents: getComputedStyle(focus).pointerEvents, operationHit: Boolean(hit?.closest(".operation-panel-desktop")) };
  });
  if (!state || state.focusPointerEvents !== "none" || !state.operationHit) {
    throw new Error(`Desktop Atlas input layer is blocked: ${JSON.stringify(state)}`);
  }
}

async function verifyGeneratedLayoutFocus(page, buttonName) {
  await page.getByLabel(/Open atlas menu|Mind Atlasメニューを開く/).click();
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  await page.waitForTimeout(650);
  const state = await page.evaluate(() => {
    const universe = document.querySelector(".universe-shell")?.getBoundingClientRect();
    const inputs = [...document.querySelectorAll('.universe-shell input[aria-label$="のタイトル"]')];
    const active = inputs.find((input) => input.value === document.querySelector(".node-title-input")?.value) ?? inputs.at(-1);
    const title = active?.getBoundingClientRect();
    return universe && title ? { universe: rectJson(universe), title: rectJson(title) } : null;
    function rectJson(rect) { return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
  });
  if (state && !rectsOverlap(state.universe, state.title)) throw new Error(`${buttonName} active node is outside the board-mode universe.`);
}

async function expectTexts(locator, expected, label) {
  const actual = await locator.allTextContents();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch: ${JSON.stringify(actual)}`);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
