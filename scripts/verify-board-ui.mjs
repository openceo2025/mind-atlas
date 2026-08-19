import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.MIND_ATLAS_URL ?? "http://127.0.0.1:5173";
const testScope = process.env.MIND_ATLAS_BOARD_TEST ?? "all";
const screenshotDir = process.env.MIND_ATLAS_BOARD_SCREENSHOT_DIR;
const mobileViewport = parseViewport(process.env.MIND_ATLAS_BOARD_VIEWPORT) ?? { width: 390, height: 844 };
const browser = await chromium.launch({ headless: true });

const fixtures = {
  shogi: {
    name: "fixture.kif",
    content: "#KIF version=2.0\n\n手合割：平手\n\n手数----指手---------\n   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角成(88)\n   4 同　銀(31)\n",
    viewer: ".shogi-viewer",
    exportMarker: "手数----指手",
  },
  chess: {
    name: "fixture.pgn",
    content: "[Event \"Mind Atlas board UI\"]\n[Result \"*\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *",
    viewer: ".chess-viewer",
    exportMarker: "[Event",
  },
  go: {
    name: "fixture.sgf",
    content: "(;GM[1]FF[4]SZ[9]GN[Mind Atlas board UI];B[dd](;W[cc])(;W[ee]))",
    viewer: ".go-viewer",
    exportMarker: "GM[1]",
  },
};

try {
  if (testScope === "all" || testScope === "shogi") await verifyShogi();
  if (testScope === "all" || testScope === "shogi-candidates") await verifyShogiCandidateBranches();
  if (testScope === "all" || testScope === "chess") await verifyChess();
  if (testScope === "all" || testScope === "chess-special") await verifyChessSpecialMoves();
  if (testScope === "all" || testScope === "go") await verifyGo();
  if (testScope === "all" || testScope === "go-ko") await verifyGoKo();
  if (testScope === "all" || testScope === "merge-dialog") await verifyMergeDialogLayout();
  if (testScope === "all" || testScope === "mobile") {
    for (const mode of ["shogi", "chess", "go"]) await verifyMobileLayout(mode);
  } else if (testScope.startsWith("mobile-")) {
    const mode = testScope.slice("mobile-".length);
    if (!["shogi", "chess", "go"].includes(mode)) throw new Error(`Unknown mobile board test scope: ${testScope}`);
    await verifyMobileLayout(mode);
  }
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
  await importRecord(page, fixture.name, fixture.content, fixture.viewer);
}

async function importRecord(page, name, content, viewer) {
  await page.getByLabel(/Open atlas menu|Mind Atlasメニューを開く/).click();
  const extension = name.slice(name.lastIndexOf("."));
  const input = page.locator(`input[type="file"][accept*="${extension}"]`);
  await input.setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(content) });
  await page.locator(viewer).waitFor({ state: "visible", timeout: 15_000 });
}

async function verifyBoardExport(page, mode) {
  const fixture = fixtures[mode];
  const extension = fixture.name.slice(fixture.name.lastIndexOf("."));
  const format = extension.slice(1).toUpperCase();
  await page.getByLabel(/Open atlas menu|Mind Atlasメニューを開く/).click();
  const exportButton = page.getByRole("button", {
    name: new RegExp(`(?:Export\\s+${format}\\s+record|${format}棋譜をエクスポート)`, "i"),
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.click(),
  ]);
  if (!download.suggestedFilename().toLowerCase().endsWith(extension)) {
    throw new Error(`${mode} export used the wrong file extension: ${download.suggestedFilename()}`);
  }
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error(`${mode} export did not produce a readable download.`);
  const content = await readFile(downloadPath, "utf8");
  if (!content.includes(fixture.exportMarker)) throw new Error(`${mode} export did not contain a valid record marker.`);
}

function activeFocusPanel(page) {
  return page.locator(".focus-panel.is-board-game-panel:not(.is-hidden)");
}

async function assertDesktopBoardFocusCenter(page, mode, expectedTitle = null) {
  const universe = await page.locator(".universe-shell").boundingBox();
  const titleBox = await page.locator(".universe-shell [data-node-id]").evaluateAll((elements, titleValue) => {
    const target = titleValue
      ? elements.find((element) => ("value" in element ? element.value : element.textContent)?.trim() === titleValue)
      : elements.find((element) => element.dataset.selected === "true")
        ?? elements.find((element) => ("value" in element ? element.value : element.textContent)?.trim());
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, expectedTitle);
  if (!universe || !titleBox) throw new Error(`${mode} desktop board focus title is missing.`);
  const titleCenterX = titleBox.x + titleBox.width / 2;
  const universeCenterX = universe.x + universe.width / 2;
  if (Math.abs(titleCenterX - universeCenterX) > Math.max(18, universe.width * 0.08)) {
    throw new Error(`${mode} desktop board focus is horizontally offset: ${JSON.stringify({ titleCenterX, universeCenterX, universe })}`);
  }
}

async function assertBoardModeLayout(page, mode, mobile) {
  const app = page.locator(`main[data-notebook-mode="${mode}"].is-board-game-mode`);
  await app.waitFor();
  const panel = activeFocusPanel(page);
  const board = await panel.locator(".panel-preview-area").boundingBox();
  const text = mobile ? null : await panel.locator(".panel-text-section").boundingBox();
  const universe = await page.locator(".universe-shell").boundingBox();
  if (!board || (!mobile && !text) || !universe) throw new Error(`${mode} board layout did not render all fixed regions.`);
  if (!mobile && board.x <= text.x + text.width) throw new Error(`${mode} desktop board is not to the right of the editor.`);
  if (!mobile && board.width < page.viewportSize().width * 0.42) throw new Error(`${mode} desktop board is narrower than the reserved right region.`);
  if (mobile && board.y <= page.viewportSize().height * 0.2) throw new Error(`${mode} mobile board is not anchored to the lower region.`);
  if (mobile && board.width < page.viewportSize().width - 28) throw new Error(`${mode} mobile board does not use the available width.`);
  if (mobile && universe.y + universe.height > board.y + 2) throw new Error(`${mode} mobile universe overlaps the board region.`);
  if (board.height < 180) throw new Error(`${mode} board region is too short: ${board.height}`);
  const addSibling = page.locator(".operation-panel-desktop button[aria-label='Add sibling']");
  if (await addSibling.count() && await addSibling.first().isEnabled()) {
    throw new Error(`${mode} root-level sibling creation is not disabled in board mode.`);
  }
  await assertBoardControlsVisible(page, mode, board);
  return { board, text, universe };
}

async function verifyShogi() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "shogi");
    await verifyBoardExport(page, "shogi");
    await assertBoardModeLayout(page, "shogi", false);
    await assertDesktopBoardFocusCenter(page, "shogi");
    await verifyBoardChildBodyPreview(page, "shogi");
    await assertDesktopInputLayer(page);
    await captureScreenshot(page, "shogi-desktop");
    await expectTexts(page.locator(".shogi-file-coordinates span"), ["9", "8", "7", "6", "5", "4", "3", "2", "1"], "shogi files");
    await expectTexts(page.locator(".shogi-rank-coordinates span"), ["一", "二", "三", "四", "五", "六", "七", "八", "九"], "shogi ranks");
    if (await page.locator(".shogi-candidate-arrow-hit").count() !== 1) throw new Error("Shogi root candidate arrow is not marked on the board.");
    const firstMoveLabel = await page.locator(".shogi-variations button").first().textContent();
    if (!firstMoveLabel?.includes("７六歩") || /[?�]/.test(firstMoveLabel)) throw new Error(`Shogi UTF-8 move label is corrupted: ${firstMoveLabel}`);
    await page.locator(".shogi-candidate-arrow-hit").first().click();
    await page.locator(".shogi-viewer-position").filter({ hasText: "1手目" }).waitFor();
    await page.getByRole("button", { name: "一手戻る" }).click();
    await page.locator(".shogi-viewer-position").filter({ hasText: "開始局面" }).waitFor();

    for (let ply = 1; ply <= 4; ply += 1) {
      await page.getByRole("button", { name: "一手進む" }).click();
      await page.locator(".shogi-viewer-position").filter({ hasText: `${ply}手目` }).waitFor();
    }
    if (await page.locator('.shogi-hand-host sg-hp-wrap[data-nb="1"]').count() !== 2) {
      throw new Error("Captured shogi pieces are not visible in both hands.");
    }
    if (await page.locator(".shogi-board-host sq.last-dest").count() !== 2) throw new Error("Shogi last move highlight is missing.");

    const senteBishop = await page.locator(".shogi-hand-host").nth(1).locator("piece.bishop").boundingBox();
    const shogiBoard = await page.locator(".shogi-board-host").boundingBox();
    if (!senteBishop || !shogiBoard) throw new Error("Sente captured bishop is not available for a legal drop.");
    await dragBetween(page, centerOf(senteBishop), {
      x: shogiBoard.x + shogiBoard.width / 2,
      y: shogiBoard.y + shogiBoard.height / 2,
    });
    await page.locator(".shogi-viewer-position").filter({ hasText: "5手目" }).waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "一手戻る" }).click();
    await page.locator(".shogi-viewer-position").filter({ hasText: "4手目" }).waitFor();

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
    if (await page.locator(".shogi-candidate-arrow-hit").count() !== 2) throw new Error("Shogi drop and move branches are not both marked as candidates.");

    await page.getByRole("button", { name: "Go to parent layer" }).click();
    await page.locator(".shogi-viewer-position").filter({ hasText: "3手目" }).waitFor();
    await verifyGeneratedLayoutFocus(page, "ツリー");
    await verifyGeneratedLayoutFocus(page, "マインドマップ");
  } finally {
    await context.close();
  }
}

/**
 * The merge dialog leads with what people actually operate: the record to merge
 * in, then the merge button. The starting-point choice is set once and is
 * parked at the bottom, defaulting to the shared-position anchor.
 */
async function verifyMergeDialogLayout() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "shogi");
    await page.getByLabel(/Open atlas menu|Mind Atlasメニューを開く/).click();
    await page.getByRole("button", { name: /棋譜をマージ|Merge .* record/ }).first().click();
    const dialog = page.locator(".board-record-dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });

    const strategy = dialog.locator(".board-record-merge-strategy");
    await strategy.waitFor({ state: "visible" });
    const checked = await strategy.locator("input[type=radio]:checked").getAttribute("value");
    if (checked !== "deepest-common-position") {
      throw new Error(`Merge dialog defaulted to ${checked} instead of the shared-position anchor.`);
    }

    const order = await dialog.locator(".board-record-dialog-body > *").evaluateAll((blocks) =>
      blocks.map((block) => block.className.split(" ")[0]),
    );
    if (order[0] !== "board-record-source-section") {
      throw new Error(`Merge dialog does not lead with the record input: ${JSON.stringify(order)}`);
    }
    if (order.at(-1) !== "board-record-merge-strategy") {
      throw new Error(`Merge starting point is not the last block: ${JSON.stringify(order)}`);
    }

    // The merge button has to sit above the options, not below them.
    const mergeButton = dialog.getByRole("button", { name: /この棋譜にマージ|Merge into this record/ });
    const buttonBox = await mergeButton.boundingBox();
    const strategyBox = await strategy.boundingBox();
    if (!buttonBox || !strategyBox || buttonBox.y >= strategyBox.y) {
      throw new Error("Merge dialog puts the starting-point choice above the merge button.");
    }
    console.log("verify:board-ui:merge-dialog:passed");
  } finally {
    await context.close();
  }
}

async function verifyBoardChildBodyPreview(page, mode) {
  await page.getByRole("button", { name: "一手進む" }).click();
  await page.locator(".node-body-input").fill("1234567890AB\nsecond line");
  await page.getByRole("button", { name: "一手戻る" }).click();
  const preview = page.locator(".board-node-body-preview").filter({ hasText: "1234567890…" }).first();
  await preview.waitFor({ state: "visible", timeout: 5_000 });
  const text = (await preview.textContent())?.trim();
  if (text !== "1234567890…") {
    throw new Error(`${mode} board child body preview was not limited to the first ten characters: ${text}`);
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

async function verifyShogiCandidateBranches() {
  const { context, page } = await createPage({ width: 980, height: 900 });
  try {
    const promotionBranches = `後手の持駒：なし
  ９ ８ ７ ６ ５ ４ ３ ２ １
+---------------------------+
| ・ ・ ・ ・v玉 ・ ・ ・ ・|一
| ・ ・ ・ ・ ・ ・ ・ ・ ・|二
| ・ ・ ・ ・ ・ ・ ・ ・ ・|三
| ・ 飛 ・ ・ ・ ・ ・ ・ ・|四
| ・ ・ ・ ・ ・ ・ ・ ・ ・|五
| ・ ・ ・ ・ ・ ・ ・ ・ ・|六
| ・ ・ ・ ・ ・ ・ ・ ・ ・|七
| ・ ・ ・ ・ ・ ・ ・ ・ ・|八
| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九
+---------------------------+
先手の持駒：なし
先手番
手数----指手---------消費時間--
   1 ８二飛(84)   ( 0:00/00:00:00)+

変化：1手
   1 ８二飛成(84) ( 0:00/00:00:00)
`;
    await importRecord(page, "promotion-branches.kif", promotionBranches, ".shogi-viewer");
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const board = document.querySelector(".shogi-board-host")?.getBoundingClientRect();
      const targets = [...document.querySelectorAll(".shogi-candidate-arrow-hit[data-candidate-square='8b']")]
        .map((target) => {
          const rect = target.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
      const lines = [...document.querySelectorAll(".shogi-candidate-arrows line")]
        .map((line) => ["x1", "y1", "x2", "y2"].map((name) => Number(line.getAttribute(name))));
      return board ? {
        board: { x: board.x, y: board.y, width: board.width, height: board.height },
        targets,
        lines,
      } : null;
    });
    if (!state || state.targets.length !== 2 || state.lines.length !== 2 || state.lines.some((line) => line.some((value) => !Number.isFinite(value)))) {
      throw new Error(`Shogi promotion candidates did not render two finite arrows: ${JSON.stringify(state)}`);
    }
    const destination = {
      x: state.board.x + state.board.width * 1.5 / 9,
      y: state.board.y + state.board.height * 1.5 / 9,
    };
    const [first, second] = state.targets;
    const targetXs = [first.x, second.x].sort((a, b) => a - b);
    if (!(targetXs[0] < destination.x && targetXs[1] > destination.x) || Math.abs(first.y - destination.y) > 2 || Math.abs(second.y - destination.y) > 2) {
      throw new Error(`Shogi promotion targets do not straddle 8b: ${JSON.stringify({ destination, targets: state.targets })}`);
    }
    const cellWidth = state.board.width / 9;
    if (state.targets.some((target) => Math.abs(target.x - destination.x) >= cellWidth / 2)) {
      throw new Error(`Shogi promotion target escaped its destination cell: ${JSON.stringify({ destination, targets: state.targets })}`);
    }

    // A deliberately selected variation must remain the next-step choice
    // after going back to the shared position and advancing again.
    const candidateTargets = page.locator(".shogi-candidate-arrow-hit");
    await candidateTargets.nth(1).click();
    const chosenNodeId = await page.locator('.universe-shell [data-selected="true"]').getAttribute("data-node-id");
    if (!chosenNodeId) throw new Error("Shogi selected variation did not focus a node.");
    await page.getByRole("button", { name: "一手戻る" }).click();
    await page.locator(".shogi-candidate-arrow-hit").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "一手進む" }).click();
    const replayedNodeId = await page.locator('.universe-shell [data-selected="true"]').getAttribute("data-node-id");
    if (replayedNodeId !== chosenNodeId) {
      throw new Error(`Shogi next navigation forgot the selected variation: chosen=${chosenNodeId} replayed=${replayedNodeId}`);
    }

    // The last-position control must follow that same remembered branch when
    // it is invoked from the shared position.
    await page.locator(".shogi-viewer-icon").nth(2).click();
    await page.locator(".shogi-candidate-arrow-hit").first().waitFor({ state: "visible" });
    await page.locator(".shogi-viewer-icon").last().click();
    const tailedNodeId = await page.locator('.universe-shell [data-selected="true"]').getAttribute("data-node-id");
    if (tailedNodeId !== chosenNodeId) {
      throw new Error(`Shogi last navigation forgot the selected variation: chosen=${chosenNodeId} tailed=${tailedNodeId}`);
    }
  } finally {
    await context.close();
  }
}

async function verifyChess() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "chess");
    const initialRecordNodeId = await page.evaluate(() => {
      const root = JSON.parse(window.localStorage.getItem("mind-atlas-notebook-v2") || "null");
      return root?.children?.[0]?.id || "";
    });
    await page.locator(".atlas-logo-crumb").click();
    if (initialRecordNodeId) {
      await page.locator(`.universe-shell [data-selected="true"][data-node-id="${initialRecordNodeId}"]`).waitFor({ state: "visible" });
    }
    await page.waitForTimeout(700);
    await verifyBoardExport(page, "chess");
    await assertBoardModeLayout(page, "chess", false);
    await assertDesktopBoardFocusCenter(page, "chess");
    await verifyBoardChildBodyPreview(page, "chess");
    await assertDesktopInputLayer(page);
    await captureScreenshot(page, "chess-desktop");
    const chessPalette = await page.locator(".chess-board-host cg-board").evaluate((board) => {
      const style = getComputedStyle(board);
      return { backgroundImage: style.backgroundImage, backgroundSize: style.backgroundSize };
    });
    if (!chessPalette.backgroundImage.includes("conic-gradient") || chessPalette.backgroundSize !== "25% 25%") {
      throw new Error(`Chess board should use a stable green-and-white checker pattern: ${JSON.stringify(chessPalette)}`);
    }
    if (await page.locator(".chess-candidate-arrows line").count() < 1) throw new Error("Chess root candidate arrow is missing.");
    const whiteFiles = await chessCoordinatePositions(page);
    await page.getByRole("button", { name: "盤面を反転" }).click();
    const blackFiles = await chessCoordinatePositions(page);
    if (!(whiteFiles.a < whiteFiles.h && blackFiles.a > blackFiles.h)) {
      throw new Error(`Chess orientation did not reverse its coordinates: ${JSON.stringify({ whiteFiles, blackFiles })}`);
    }
    await page.getByRole("button", { name: "盤面を反転" }).click();
    for (let ply = 1; ply <= 5; ply += 1) {
      await page.getByRole("button", { name: "一手進む" }).click();
      await page.locator(".chess-viewer-position").filter({ hasText: `${ply} ply` }).waitFor();
    }
    if (await page.locator(".chess-board-host square.last-move").count() !== 2) throw new Error("Chess last move highlight is missing.");
    const board = await page.locator(".chess-board-host").boundingBox();
    if (!board) throw new Error("Chess board did not get a bounding box.");
    const from = { x: board.x + board.width / 16, y: board.y + board.height * 3 / 16 };
    const to = { x: board.x + board.width / 16, y: board.y + board.height * 5 / 16 };
    await dragBetween(page, from, to);
    await page.locator(".chess-viewer-position").filter({ hasText: "6 ply" }).waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "一手戻る" }).click();
    await page.locator(".chess-viewer-position").filter({ hasText: "5 ply" }).waitFor();
    if (await page.locator(".chess-candidate-arrows line").count() < 1) throw new Error("New chess branch arrow is missing.");
    await verifyGeneratedLayoutFocus(page, "ツリー");
    await verifyGeneratedLayoutFocus(page, "マインドマップ");
  } finally {
    await context.close();
  }
}

async function verifyChessSpecialMoves() {
  const castlingPage = await createPage({ width: 1440, height: 900 });
  try {
    const castling = '[Event "Castling"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *';
    await importRecord(castlingPage.page, "castling.pgn", castling, ".chess-viewer");
    for (let ply = 1; ply <= 6; ply += 1) {
      await castlingPage.page.getByRole("button", { name: "一手進む" }).click();
      await castlingPage.page.locator(".chess-viewer-position").filter({ hasText: `${ply} ply` }).waitFor();
    }
    await castlingPage.page.waitForTimeout(220);
    await playChessMove(castlingPage.page, "e1", "g1");
    await castlingPage.page.locator(".chess-viewer-position").filter({ hasText: "7 ply" }).waitFor({ timeout: 5_000 });
    if (await castlingPage.page.locator(".chess-board-host square.last-move").count() !== 2) throw new Error("Chess castling did not retain its last-move highlight.");
  } finally {
    await castlingPage.context.close();
  }

  const promotionPage = await createPage({ width: 1440, height: 900 });
  try {
    const promotion = '[Event "Promotion"]\n[Result "*"]\n\n1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 *';
    await importRecord(promotionPage.page, "promotion.pgn", promotion, ".chess-viewer");
    for (let ply = 1; ply <= 8; ply += 1) {
      await promotionPage.page.getByRole("button", { name: "一手進む" }).click();
      await promotionPage.page.locator(".chess-viewer-position").filter({ hasText: `${ply} ply` }).waitFor();
    }
    await promotionPage.page.waitForTimeout(220);
    await playChessMove(promotionPage.page, "c2", "c3");
    await promotionPage.page.locator(".chess-viewer-position").filter({ hasText: "9 ply" }).waitFor({ timeout: 5_000 });
    await promotionPage.page.getByRole("button", { name: "一手戻る" }).click();
    await promotionPage.page.locator(".chess-viewer-position").filter({ hasText: "8 ply" }).waitFor();
    await promotionPage.page.waitForTimeout(220);
    await clickChessMove(promotionPage.page, "b7", "a8");
    const picker = promotionPage.page.locator(".chess-promotion-picker");
    await promotionPage.page.waitForTimeout(300);
    if (!await picker.isVisible()) {
      const promotionState = await inspectChessSquares(promotionPage.page, ["b7", "a8"]);
      throw new Error(`Chess promotion picker did not open: ${JSON.stringify(promotionState)}`);
    }
    await picker.getByRole("button", { name: "Q", exact: true }).click();
    await promotionPage.page.locator(".chess-viewer-position").filter({ hasText: "9 ply" }).waitFor({ timeout: 5_000 });
  } finally {
    await promotionPage.context.close();
  }
}

async function playChessMove(page, fromSquare, toSquare) {
  const board = await page.locator(".chess-board-host").boundingBox();
  if (!board) throw new Error("Chess board did not get a bounding box.");
  const squarePoint = (square) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    return {
      x: board.x + board.width * ((file + 0.5) / 8),
      y: board.y + board.height * ((8 - rank + 0.5) / 8),
    };
  };
  await dragBetween(page, squarePoint(fromSquare), squarePoint(toSquare));
}

async function clickChessMove(page, fromSquare, toSquare) {
  const board = await page.locator(".chess-board-host").boundingBox();
  if (!board) throw new Error("Chess board did not get a bounding box.");
  const squarePoint = (square) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    return {
      x: board.x + board.width * ((file + 0.5) / 8),
      y: board.y + board.height * ((8 - rank + 0.5) / 8),
    };
  };
  const from = squarePoint(fromSquare);
  const to = squarePoint(toSquare);
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(80);
  const selected = await page.locator(".chess-board-host square.selected").count();
  const destinations = await page.locator(".chess-board-host square.move-dest").count();
  if (selected !== 1 || destinations < 1) {
    throw new Error(`Chess tap selection failed for ${fromSquare}: selected=${selected}, destinations=${destinations}`);
  }
  const destinationStyle = await page.locator(".chess-board-host square.move-dest").first().evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return { content: style.content, width: style.width, backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth };
  });
  if (destinationStyle.content === "none" || destinationStyle.width === "0px"
    || (destinationStyle.backgroundColor === "rgba(0, 0, 0, 0)" && destinationStyle.borderTopWidth === "0px")) {
    throw new Error(`Chess legal destination marker is not visible: ${JSON.stringify(destinationStyle)}`);
  }
  await page.mouse.click(to.x, to.y);
}

async function inspectChessSquares(page, squares) {
  return page.evaluate((requested) => {
    const board = document.querySelector(".chess-board-host")?.getBoundingClientRect();
    if (!board) return null;
    const at = (square) => {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]);
      const x = board.x + board.width * ((file + 0.5) / 8);
      const y = board.y + board.height * ((8 - rank + 0.5) / 8);
      const hit = document.elementFromPoint(x, y);
      return { square, hit: hit?.tagName, className: hit?.getAttribute("class") ?? "" };
    };
    return {
      squares: requested.map(at),
      selected: document.querySelectorAll(".chess-board-host square.selected").length,
      destinations: document.querySelectorAll(".chess-board-host square.move-dest").length,
      position: document.querySelector(".chess-viewer-position")?.textContent,
      turn: document.querySelector(".board-turn-indicator")?.textContent,
      wraps: document.querySelectorAll(".chess-board-host .cg-wrap").length,
      boards: document.querySelectorAll(".chess-board-host cg-board").length,
      board: { x: board.x, y: board.y, width: board.width, height: board.height },
      pawns: [...document.querySelectorAll(".chess-board-host piece.white.pawn")].map((piece) => {
        const rect = piece.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, className: piece.getAttribute("class"), transform: piece.style.transform };
      }),
    };
  }, squares);
}

async function verifyGo() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    await importFixture(page, "go");
    await verifyBoardExport(page, "go");
    await assertBoardModeLayout(page, "go", false);
    await assertDesktopBoardFocusCenter(page, "go");
    await verifyBoardChildBodyPreview(page, "go");
    await assertDesktopInputLayer(page);
    await captureScreenshot(page, "go-desktop");
    const goEdgeGeometry = await page.locator(".go-point.is-left-edge.is-top-edge").first().evaluate((point) => {
      const rect = point.getBoundingClientRect();
      const horizontal = getComputedStyle(point, "::before");
      const vertical = getComputedStyle(point, "::after");
      return {
        pointWidth: rect.width,
        pointHeight: rect.height,
        horizontalLeft: Number.parseFloat(horizontal.left),
        horizontalWidth: Number.parseFloat(horizontal.width),
        verticalTop: Number.parseFloat(vertical.top),
        verticalHeight: Number.parseFloat(vertical.height),
      };
    });
    if (
      goEdgeGeometry.horizontalLeft < goEdgeGeometry.pointWidth * 0.4
      || goEdgeGeometry.horizontalWidth > goEdgeGeometry.pointWidth * 0.6
      || goEdgeGeometry.verticalTop < goEdgeGeometry.pointHeight * 0.4
      || goEdgeGeometry.verticalHeight > goEdgeGeometry.pointHeight * 0.6
    ) {
      throw new Error(`Go grid lines should terminate at the outer intersections: ${JSON.stringify(goEdgeGeometry)}`);
    }
    await page.getByRole("button", { name: "一手進む" }).click();
    await page.locator(".go-viewer-position").filter({ hasText: "1 手目" }).waitFor();
    if (await page.locator(".go-point.is-last").count() !== 1) throw new Error("Go last move marker is missing.");
    if (await page.locator(".go-point.is-candidate").count() !== 2) throw new Error("Go branch candidates are not marked on the board.");
    const lastBeforeFlip = await page.locator(".go-point.is-last").boundingBox();
    await page.getByRole("button", { name: "盤面を反転" }).click();
    const lastAfterFlip = await page.locator(".go-point.is-last").boundingBox();
    if (!lastBeforeFlip || !lastAfterFlip || (Math.abs(lastBeforeFlip.x - lastAfterFlip.x) < 4 && Math.abs(lastBeforeFlip.y - lastAfterFlip.y) < 4)) {
      throw new Error("Go orientation did not rotate the board position.");
    }
    await page.getByRole("button", { name: "盤面を反転" }).click();
    const firstCandidate = page.locator(".go-variations button").first();
    await firstCandidate.click();
    await page.locator(".go-viewer-position").filter({ hasText: "2 手目" }).waitFor();
    await page.locator(".go-point").first().click();
    await page.locator(".go-viewer-position").filter({ hasText: "3 手目" }).waitFor();
    await verifyGeneratedLayoutFocus(page, "ツリー");
    await verifyGeneratedLayoutFocus(page, "マインドマップ");
  } finally {
    await context.close();
  }
}

async function verifyGoKo() {
  const { context, page } = await createPage({ width: 1440, height: 900 });
  try {
    const ko = "(;GM[1]FF[4]SZ[5]AB[ab][ba][bc][cb]AW[ca][cc][db];W[bb])";
    await importRecord(page, "ko.sgf", ko, ".go-viewer");
    await page.getByRole("button", { name: "一手進む" }).click();
    await page.locator(".go-viewer-position").filter({ hasText: "1 手目" }).waitFor();
    await page.locator(".go-point").nth(7).click();
    await page.locator(".board-game-viewer-status").filter({ hasText: "コウ" }).waitFor();
    if (!await page.locator(".go-viewer-position").filter({ hasText: "1 手目" }).isVisible()) {
      throw new Error("Go immediate ko recapture incorrectly created a move node.");
    }
  } finally {
    await context.close();
  }
}

async function verifyMobileLayout(mode) {
  const { context, page } = await createPage({ ...mobileViewport, mobile: true });
  try {
    await importFixture(page, mode);
    const { board, universe } = await assertBoardModeLayout(page, mode, true);
    await page.waitForTimeout(1_450);
    await assertMobileBoardFocusScale(page, mode);
    await assertMobileAtlasComposition(page, `${mode} initial load`, universe, { strictCenter: true });
    await focusMobileBoardMidRecord(page, mode);
    await page.waitForTimeout(1_450);
    const panel = activeFocusPanel(page);
    const globalMenu = await page.locator(".global-menu").boundingBox();
    if (!globalMenu) throw new Error(`${mode} mobile global menu is missing.`);
    const viewport = { x: 0, y: 0, width: page.viewportSize().width, height: page.viewportSize().height };
    await assertRectInside(viewport, globalMenu, `${mode} mobile global menu`);
    if (await panel.locator(".panel-toolbar").isVisible()) throw new Error(`${mode} mobile editor toolbar should be hidden.`);
    if (await panel.locator(".panel-text-section").isVisible()) throw new Error(`${mode} mobile text editor panel should be hidden.`);
    if (await page.locator(".atlas-breadcrumb").isVisible()) throw new Error(`${mode} mobile breadcrumb should be hidden.`);
    if (await page.locator(".operation-panel-desktop").isVisible()) throw new Error(`${mode} mobile operation panel should be hidden.`);
    if (await panel.locator(".editor-panel-role").isVisible()) throw new Error(`${mode} mobile Editor label should be hidden.`);
    if (await panel.locator(".return-button").isVisible()) throw new Error(`${mode} mobile return button should be hidden.`);
    const addSibling = page.getByRole("button", { name: "Add sibling" });
    if (await addSibling.isVisible()) throw new Error(`${mode} mobile Enter operation should be hidden.`);
    if (board.x < 8 || board.x + board.width > page.viewportSize().width - 8) throw new Error(`${mode} mobile board overflows horizontally.`);
    await assertMobileCandidateVisibility(page, mode);
    await captureScreenshot(page, `${mode}-mobile`);
    await assertMobileAtlasComposition(page, `${mode} auto focus`, universe);
    await assertVariationStripHorizontalScroll(page, mode);
    const titleInputs = page.locator('.universe-shell input[aria-label$="のタイトル"]');
    if (await titleInputs.count()) {
      const activeTitle = await titleInputs.last().boundingBox();
      if (activeTitle && !rectsOverlap(activeTitle, universe)) throw new Error(`${mode} active node title is outside the compact universe.`);
    }
    const compactFields = await page.locator(".board-mobile-node-title, .board-mobile-node-body").evaluateAll((fields) => fields.map((field) => {
      const rect = field.getBoundingClientRect();
      const style = getComputedStyle(field);
      return { width: rect.width, border: style.borderTopWidth, outline: style.outlineWidth, background: style.backgroundColor };
    }));
    if (!compactFields.length || compactFields.some((field) => field.width > 134 || field.border !== "0px")) {
      throw new Error(`${mode} mobile node text fields are not compact and borderless: ${JSON.stringify(compactFields)}`);
    }
    if (mode === "shogi") {
      const coordinateState = await page.evaluate(() => {
        const board = document.querySelector(".shogi-board-host")?.getBoundingClientRect();
        const file = document.querySelector(".shogi-file-coordinates span")?.getBoundingClientRect();
        const rank = document.querySelector(".shogi-rank-coordinates span")?.getBoundingClientRect();
        return board && file && rank ? {
          board: rectJson(board), file: rectJson(file), rank: rectJson(rank),
        } : null;
        function rectJson(rect) { return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
      });
      if (!coordinateState
        || coordinateState.file.y + coordinateState.file.height > coordinateState.board.y + 1
        || coordinateState.rank.x < coordinateState.board.x + coordinateState.board.width - 1) {
        throw new Error(`Shogi mobile coordinates still overlap board pieces: ${JSON.stringify(coordinateState)}`);
      }
    }
  } finally {
    await context.close();
  }
}

async function focusMobileBoardMidRecord(page, mode) {
  const steps = mode === "go" ? 1 : 2;
  for (let step = 0; step < steps; step += 1) {
    await page.getByRole("button", { name: "一手進む" }).click();
  }
}

async function assertMobileBoardFocusScale(page, mode) {
  const metrics = await page.locator(".universe-shell").evaluate((element) => ({
    ratio: Number(element.getAttribute("data-board-mobile-focus-target-ratio")),
    referenceHeight: Number(element.getAttribute("data-board-mobile-reference-view-height")),
    referenceDiameter: Number(element.getAttribute("data-board-mobile-reference-node-diameter")),
    drawableHeight: Number(element.getAttribute("data-board-mobile-drawable-height")),
    targetDiameter: Number(element.getAttribute("data-board-mobile-target-node-diameter")),
    actualDiameter: Number(element.getAttribute("data-board-mobile-actual-node-diameter")),
    renderBudget: Number(element.getAttribute("data-board-render-budget")),
    renderedNodeCount: Number(element.getAttribute("data-board-rendered-node-count")),
    actualHeight: element.getBoundingClientRect().height,
  }));
  const expectedRatio = 57 / 359;
  const expectedDiameter = metrics.drawableHeight * expectedRatio;
  if (
    Math.abs(metrics.ratio - expectedRatio) > 0.000001
    || metrics.referenceHeight !== 359
    || metrics.referenceDiameter !== 57
    || Math.abs(metrics.drawableHeight - metrics.actualHeight) > 2
    || Math.abs(metrics.targetDiameter - expectedDiameter) > 0.05
    || Math.abs(metrics.actualDiameter - expectedDiameter) > 1
    || metrics.renderBudget !== 240
    || metrics.renderedNodeCount > metrics.renderBudget
  ) {
    throw new Error(`${mode} mobile board focus does not reproduce the measured 57/359 ratio: ${JSON.stringify(metrics)}`);
  }
}

async function assertMobileAtlasComposition(page, mode, universe, { strictCenter = false } = {}) {
  const composition = await page.evaluate(() => {
    const universeElement = document.querySelector(".universe-shell");
    const universeRect = universeElement?.getBoundingClientRect();
    if (!universeRect) return null;
    const visibleTitles = [...document.querySelectorAll(".universe-shell .board-mobile-node-title")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selected: element.classList.contains("board-mobile-node-input"),
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width,
          height: rect.height,
          visible:
            rect.width > 0
            && rect.height > 0
            && rect.x < universeRect.right
            && rect.right > universeRect.left
            && rect.y < universeRect.bottom
            && rect.bottom > universeRect.top,
        };
      })
      .filter((entry) => entry.visible);
    const selected = visibleTitles.find((entry) => entry.selected) ?? null;
    const selectedBodyElement = document.querySelector(".universe-shell .board-mobile-node-body.board-mobile-node-input");
    const selectedBodyRect = selectedBodyElement?.getBoundingClientRect();
    const selectedBody = selectedBodyRect
      ? {
          x: selectedBodyRect.x + selectedBodyRect.width / 2,
          y: selectedBodyRect.y + selectedBodyRect.height / 2,
          visible:
            selectedBodyRect.width > 0
            && selectedBodyRect.height > 0
            && selectedBodyRect.x < universeRect.right
            && selectedBodyRect.right > universeRect.left
            && selectedBodyRect.y < universeRect.bottom
            && selectedBodyRect.bottom > universeRect.top,
        }
      : null;
    const xs = visibleTitles.map((entry) => entry.x);
    const ys = visibleTitles.map((entry) => entry.y);
    return {
      count: visibleTitles.length,
      spanX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
      spanY: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
      selected,
      selectedBody,
      centerX: universeRect.x + universeRect.width / 2,
      centerY: universeRect.y + universeRect.height / 2,
    };
  });
  if (!composition?.selected || !composition.selectedBody?.visible) {
    throw new Error(`${mode} mobile Atlas has no selected node text anchors to evaluate.`);
  }
  const activeTextGap = Math.abs(composition.selectedBody.y - composition.selected.y);
  const minActiveTextGap = Math.min(universe.width, universe.height) * 0.12;
  const maxActiveTextGap = Math.min(universe.width, universe.height) * 0.44;
  const activeAnchorX = (composition.selected.x + composition.selectedBody.x) / 2;
  const activeAnchorY = (composition.selected.y + composition.selectedBody.y) / 2;
  const maxCenterOffsetX = universe.width * (strictCenter ? 0.08 : 0.24);
  const maxCenterOffsetY = universe.height * (strictCenter ? 0.12 : 0.3);
  if (
    composition.count < 2
    || activeTextGap < minActiveTextGap
    || activeTextGap > maxActiveTextGap
    || Math.abs(activeAnchorX - composition.centerX) > maxCenterOffsetX
    || Math.abs(activeAnchorY - composition.centerY) > maxCenterOffsetY
  ) {
    throw new Error(`${mode} mobile Atlas camera composition is too distant or off-center: ${JSON.stringify({ ...composition, activeTextGap, minActiveTextGap, maxActiveTextGap })}`);
  }
}

async function assertVariationStripHorizontalScroll(page, mode) {
  const state = await page.locator(`.${mode}-variations`).evaluate((strip) => {
    const source = strip.querySelector("button");
    if (!source) return null;
    const clones = [];
    for (let index = 0; index < 12; index += 1) {
      const clone = source.cloneNode(true);
      clone.textContent = `候補手 ${index + 1} ７六歩成`;
      clone.setAttribute("data-board-overflow-fixture", "true");
      strip.append(clone);
      clones.push(clone);
    }
    void strip.getBoundingClientRect();
    const firstStyle = getComputedStyle(clones[0]);
    const before = strip.scrollLeft;
    strip.scrollLeft = strip.scrollWidth;
    const result = {
      clientWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      clientHeight: strip.clientHeight,
      scrollHeight: strip.scrollHeight,
      before,
      after: strip.scrollLeft,
      flexShrink: firstStyle.flexShrink,
      whiteSpace: firstStyle.whiteSpace,
      writingMode: firstStyle.writingMode,
      maxButtonHeight: Math.max(...clones.map((clone) => clone.getBoundingClientRect().height)),
    };
    clones.forEach((clone) => clone.remove());
    strip.scrollLeft = before;
    return result;
  });
  if (
    !state
    || state.scrollWidth <= state.clientWidth + 8
    || state.after <= 0
    || state.scrollHeight > state.clientHeight + 2
    || state.maxButtonHeight > state.clientHeight + 2
    || state.flexShrink !== "0"
    || state.whiteSpace !== "nowrap"
    || !state.writingMode.startsWith("horizontal")
  ) {
    throw new Error(`${mode} candidate strip is not a single horizontally scrollable row: ${JSON.stringify(state)}`);
  }
}

function parseViewport(value) {
  if (!value) return null;
  const match = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid MIND_ATLAS_BOARD_VIEWPORT: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function assertBoardControlsVisible(page, mode, previewRect) {
  const panel = activeFocusPanel(page);
  const toolbar = await panel.locator(`.${mode}-viewer-toolbar`).boundingBox();
  const footprintSelector = mode === "shogi" ? ".shogi-board-shell" : mode === "chess" ? ".chess-board-frame" : ".go-board-host";
  const footprint = await panel.locator(footprintSelector).boundingBox();
  const variations = await panel.locator(`.${mode}-variations`).boundingBox();
  const firstVariation = panel.locator(`.${mode}-variations button`).first();
  if (!toolbar || !footprint || !variations || !await firstVariation.isVisible()) {
    throw new Error(`${mode} board toolbar or candidate strip is not visible.`);
  }
  await assertRectInside(previewRect, toolbar, `${mode} board toolbar`);
  await assertRectInside(previewRect, footprint, `${mode} board`);
  await assertRectInside(previewRect, variations, `${mode} candidate strip`);
  const candidateGap = variations.y - (footprint.y + footprint.height);
  if (candidateGap < -2 || candidateGap > 14) throw new Error(`${mode} candidate strip is not directly below the board: gap=${candidateGap}`);
}

async function assertMobileCandidateVisibility(page, mode) {
  const marker = mode === "shogi"
    ? page.locator(".shogi-candidate-arrow-hit").first()
    : mode === "chess"
      ? page.locator(".chess-candidate-arrows line").first()
      : page.locator(".go-point.is-candidate").first();
  const visibility = mode === "chess"
    ? await marker.evaluate((line) => {
        const style = getComputedStyle(line);
        return {
          geometry: line instanceof SVGGeometryElement,
          length: line instanceof SVGGeometryElement ? line.getTotalLength() : 0,
          stroke: line.getAttribute("stroke") || style.stroke,
          opacity: Number(line.getAttribute("opacity") || style.opacity || 1),
        };
      })
    : { geometry: await marker.isVisible(), length: 1, stroke: "visible", opacity: 1 };
  if (!visibility.geometry || visibility.length <= 0.5 || visibility.stroke === "none" || visibility.opacity <= 0) {
    throw new Error(`${mode} mobile board candidate marker is not visible: ${JSON.stringify(visibility)}`);
  }
}

async function assertRectInside(container, item, label) {
  if (!item) throw new Error(`${label} is missing.`);
  const tolerance = 2;
  if (
    item.x < container.x - tolerance
    || item.y < container.y - tolerance
    || item.x + item.width > container.x + container.width + tolerance
    || item.y + item.height > container.y + container.height + tolerance
  ) {
    throw new Error(`${label} overflows its region: container=${JSON.stringify(container)} item=${JSON.stringify(item)}`);
  }
}

async function captureScreenshot(page, name) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
}

async function chessCoordinatePositions(page) {
  return page.evaluate(() => {
    const positions = {};
    for (const coordinate of document.querySelectorAll(".chess-board-host coords.files coord")) {
      const label = coordinate.textContent?.trim();
      if (label === "a" || label === "h") positions[label] = coordinate.getBoundingClientRect().x;
    }
    return positions;
  });
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

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function dragBetween(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
