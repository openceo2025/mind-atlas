import { chromium } from "playwright";

const baseUrl = process.env.MIND_ATLAS_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
try {
  await verifyChess(browser);
  await verifyGo(browser);
  await verifyMobileLayout(browser);
  console.log("verify:board-ui:passed chess-and-go-local-viewers");
} finally {
  await browser.close();
}

async function createPage(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
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
  return page;
}

async function importFile(page, fileName, fileContent) {
  await page.getByLabel(/Open atlas menu|Mind Atlasメニューを開く/).click();
  const input = page.locator(`input[type="file"][accept*="${fileName.slice(-3)}"]`);
  await input.setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(fileContent) });
}

async function verifyChess() {
  const page = await createPage();
  try {
    await importFile(page, "fixture.pgn", `[Event "UI"]\n\n1. e4 e5 2. Nf3 *`);
    await page.locator(".chess-viewer").waitFor();
    await page.locator(".chess-board-host.cg-wrap").waitFor();
    await assertBoardModeLayout(page, "chess", false);
    const board = await page.locator(".chess-board-host").boundingBox();
    if (!board) throw new Error("Chess board did not get a bounding box.");
    await page.mouse.move(board.x + board.width * 0.56, board.y + board.height * 0.81);
    await page.mouse.down();
    await page.mouse.move(board.x + board.width * 0.56, board.y + board.height * 0.56);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const root = JSON.parse(window.localStorage.getItem("mind-atlas-notebook-v2") ?? "null");
      const visit = (node) => node?.structuredContent?.kind === "chess-record" && node.structuredContent.role === "move"
        ? true : (node?.children ?? []).some(visit);
      return visit(root);
    });
  } finally {
    await page.close();
  }
}

async function assertBoardModeLayout(page, mode, mobile) {
  const app = page.locator(`main[data-notebook-mode="${mode}"].is-board-game-mode`);
  await app.waitFor();
  const board = await page.locator(".panel-preview-area").boundingBox();
  const text = await page.locator(".panel-text-section").boundingBox();
  if (!board || !text) throw new Error(`${mode} board layout did not render both fixed regions.`);
  if (!mobile && board.x <= text.x) throw new Error(`${mode} desktop board is not on the right of the editor.`);
  if (mobile && board.y <= page.viewportSize().height / 3) throw new Error(`${mode} mobile board is not anchored to the lower region.`);
  if (board.height < 180) throw new Error(`${mode} board region is too short: ${board.height}`);
}

async function verifyGo() {
  const page = await createPage();
  try {
    await importFile(page, "fixture.sgf", "(;GM[1]FF[4]SZ[9];B[dd];W[cc])");
    await page.locator(".go-viewer").waitFor();
    const point = page.locator(".go-point").nth(3 * 9 + 3);
    await point.click();
    await page.waitForFunction(() => {
      const root = JSON.parse(window.localStorage.getItem("mind-atlas-notebook-v2") ?? "null");
      const visit = (node) => node?.structuredContent?.kind === "go-record" && node.structuredContent.role === "move"
        ? true : (node?.children ?? []).some(visit);
      return visit(root);
    });
  } finally {
    await page.close();
  }
}

async function verifyMobileLayout() {
  const page = await createPage({ width: 390, height: 844 });
  try {
    await importFile(page, "fixture.pgn", `[Event "Mobile UI"]\n\n1. e4 e5 2. Nf3 *`);
    await page.locator(".chess-viewer").waitFor();
    await assertBoardModeLayout(page, "chess", true);
  } finally {
    await page.close();
  }
}
