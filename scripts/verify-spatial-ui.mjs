// 空間UI の操作まわりの検査：グループ化・Ctrl+S・入力欄の Enter・送信前の確認ダイアログ。
//
// 1) 静的な検査（いつでも走る）：処理が一か所にまとまっていること、イベントの止め方。
// 2) ブラウザでの検査（MIND_ATLAS_SPATIAL_URL を渡したときだけ）：実際に押して確かめる。
//    ステージングのモック（MIND_ATLAS_STAGING_MOCK_AUTH / _BILLING / _PROVIDERS）で動いている
//    サービスを指すこと。外部への通信はすべて止める。
//      MIND_ATLAS_SPATIAL_URL=http://127.0.0.1:8799 npm run verify:spatial-ui
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ── 1) 静的な検査 ──────────────────────────────────────────
const app = read("spatial/src/App.tsx");
const radial = read("spatial/src/components/RadialMenu.tsx");
const palette = read("spatial/src/components/CommandPalette.tsx");
const chrome = read("spatial/src/components/Chrome.tsx");
const chat = read("spatial/src/components/windows/ChatWindow.tsx");
const spaces = read("spatial/src/store/spaces.ts");

// グループ化は store の group() 一つだけ。輪・Ctrl+G・パレットが同じものを呼ぶ
assert.ok(/key: 'bundle'[\s\S]{0,400}run: \(\) => group\(selection\)/.test(radial), "the ring's group item should call store group()");
assert.ok(/shortcut: 'Ctrl\+G'/.test(radial), "the ring should show Ctrl+G on the group item");
assert.ok(/key === 'g'[\s\S]{0,80}group\(s\.selection\)/.test(app), "Ctrl+G should call store group()");
assert.ok(/id: 'grp'[\s\S]{0,120}group\(selection\)/.test(palette), "the palette should call store group()");
assert.equal((read("spatial/src/store/cards.ts").match(/export function group\(/g) ?? []).length, 1, "there should be exactly one group implementation");

// 輪のボタンは押したら焦点を手放す（残ると次の Enter でもう一度実行される）
assert.ok(/onClick=\{\(e\) => \{[\s\S]{0,160}e\.currentTarget\.blur\(\);[\s\S]{0,40}it\.run\(\)/.test(radial), "ring items should release focus after running");

// Ctrl+S：入力中でも効き、ブラウザの保存ダイアログを出さない
const ctrlS = app.indexOf("=== 's'");
assert.ok(ctrlS > 0, "Ctrl+S should be handled");
assert.ok(ctrlS < app.indexOf("if (typing(e)"), "Ctrl+S should be handled before the typing guard");
assert.ok(/=== 's'\) \{\s*e\.preventDefault\(\);\s*void saveNow\(\);/.test(app), "Ctrl+S should prevent the browser dialog and save");
assert.ok(/export async function saveNow\(\)[\s\S]{0,400}await flushSave\(\)/.test(spaces), "saveNow should reuse the autosave path");

// Enter で選んだカードを開くのは、焦点が空間にあるときだけ
assert.ok(/e\.key === 'Enter' && s\.selection\.length === 1 && onCanvas\(\)/.test(app), "the Enter shortcut should only act when the canvas has focus");

// 入力欄の Enter は外へ渡さない。Shift+Enter は改行、Enter / Ctrl+Enter は送信
assert.ok(/e\.key !== 'Enter' \|\| e\.nativeEvent\.isComposing\) return;\s*[\s\S]{0,120}e\.stopPropagation\(\);\s*if \(e\.shiftKey\) return;/.test(chat), "the chat input should keep Enter to itself and leave Shift+Enter as a newline");

// 確認ダイアログ：capture で受けて止める。ボタンに autoFocus しない（Enter が二度走る）
const confirm = chrome.slice(chrome.indexOf("export function CostConfirm"), chrome.indexOf("export function ShareUnavailable"));
assert.ok(confirm.includes("window.addEventListener('keydown', onKey, true)"), "the dialog should listen in the capture phase");
assert.ok(/e\.key === 'Enter'[\s\S]{0,400}e\.stopPropagation\(\);\s*answer\(true\)/.test(confirm), "Enter in the dialog should confirm and stop there");
assert.ok(/e\.key === 'Escape'[\s\S]{0,80}e\.stopPropagation\(\);\s*answer\(false\)/.test(confirm), "Escape in the dialog should cancel and stop there");
assert.ok(/e\.key === 'Tab'/.test(confirm), "Tab should stay inside the dialog");
assert.equal(/autoFocus/.test(confirm), false, "dialog buttons must not autofocus");
assert.ok(/role="alertdialog"[\s\S]{0,80}aria-modal="true"/.test(confirm), "the dialog should be announced as a modal");
assert.ok(/before\?\.focus/.test(confirm), "focus should return where it was when the dialog closes");

// ── 「今日やること」の改善（2026-09-24） ───────────────────────
const cards = read("spatial/src/store/cards.ts");
const layout = read("spatial/src/store/layout.ts");
const cardView = read("spatial/src/components/CardView.tsx");
const windowLayer = read("spatial/src/components/WindowLayer.tsx");
const semantic = read("spatial/src/lib/semantic.ts");
const tools = read("spatial/src/lib/spaceTools.ts");
const ai = read("spatial/src/lib/ai.ts");

// 子カードの起点はいつも親の真横（作った数だけ下へずらさない）
assert.ok(/const home = \{ x: [^;]+, y: parent\.y \};/.test(cards), "children should start beside the parent, not below the older siblings");
// AI が作ったカードは親の横に置き、意味の位置へは移さない
assert.ok(/export function spawnDrafts[\s\S]{0,1600}childSpots\(src[\s\S]{0,1600}overrideFromPosition\(ids/.test(cards), "AI cards should be placed beside the parent and pinned there");
// 打ちかけの文章では意味を計算しない
assert.ok(/frozenText\.get\(card\.id\) \?\? liveText\(card\)/.test(semantic), "cardText should use the text from before typing began");
assert.ok(/onFocus=\{beginEdit\}/.test(read("spatial/src/components/windows/DetailWindow.tsx")) && /beginTextEdit\(id\)/.test(read("spatial/src/components/windows/DetailWindow.tsx")), "detail inputs should freeze the meaning text while typing");
// ドラッグ：生まれたカードも連れていく／Ctrl で単独／左ナビへ投げると削除
assert.ok(/dragFollowers\(ids\)/.test(cardView) && /setSolo\(ev\.ctrlKey \|\| ev\.metaKey\)/.test(cardView), "dragging should bring derived cards along, and Ctrl should switch to a solo drag");
assert.ok(/overNav\(ev\.clientX, ev\.clientY\)\) \{[\s\S]{0,700}deleteCards\(ids\)/.test(cardView), "throwing a card onto the nav should delete it");
// ダイアログ：半分以上ナビに潜ったら閉じ、閉じなければ見える所へ戻す
assert.ok(/hidden >= 0\.5\) return closeWindow/.test(windowLayer) && /moveWindow\(win\.id, dx, dy\)/.test(windowLayer), "a window half under the nav should close, otherwise spring back into view");
// グループ：中での場所を覚え、開いたグループの中身は意味配置で動かさない。外へ出したら外れる
assert.ok(/groupOffset/.test(cards) && /inOpenGroup/.test(layout), "group members should keep their place inside the group");
assert.ok(/export function removeFromGroup/.test(cards) && /settleGroupMembers\(placed\)/.test(cardView), "members should be removable from a group");
// AI：周りのカードとつながりを渡し、空間を読む道具とネット検索を持たせる
for (const name of ["read_card", "get_related_cards", "list_cards", "web_search"]) assert.ok(tools.includes(`name: '${name}'`), `AI should have the ${name} tool`);
assert.ok(/neighborhood\(picked, 2/.test(chat), "chat should send the cards around the selected ones");
assert.ok(/relationsContext\(cards\)/.test(ai) && /\{ web: true \}/.test(ai), "AI requests should carry connections and be able to search the web");

// ── 「AIに質問」と「AIアシスタント」（2026-09-25） ─────────────────
// カードはタイトルと本文を別の欄で渡し、本文が全文か途中までかを書く
assert.ok(/`title: \$\{c\.title\}`/.test(ai) && /body \(complete, /.test(ai) && /body \(truncated: /.test(ai), "card context should label title and body separately and say whether the body is complete");
assert.ok(/never use the title in place of the body/.test(ai) && /wantsExactText\(said\)/.test(ai), "the AI should be told to copy card text exactly when asked to join/quote it");
// 左ナビは「AIアシスタント」（スペースごとに会話を覚える）、サークルメニューは毎回まっさら
assert.ok(/onClick=\{tool\('assistant'\)\}/.test(chrome), "the nav should open the AI assistant");
assert.ok(/const assistant = win\.type === 'assistant'/.test(chat) && /memory: assistant \? logRef\.current\.summary : undefined/.test(chat), "only the assistant carries the space's conversation");
assert.ok(/\/\^\\\/compact\\b\/i/.test(chat) && /AUTO_COMPACT_CHARS/.test(chat), "the assistant should compact on /compact and automatically");
// 開いたら質問欄へ焦点。日本語入力中のキーは空間の操作にしない
assert.ok(/inputRef\.current\?\.focus/.test(chat), "the chat input should take focus when the window opens");
assert.ok(/e\.isComposing \|\| e\.key === 'Process'/.test(app), "space shortcuts should ignore keys while composing text");

console.log("verify:spatial-ui static checks passed");

// ── 2) ブラウザでの検査 ────────────────────────────────────
const base = process.env.MIND_ATLAS_SPATIAL_URL;
if (!base) {
  console.log("verify:spatial-ui browser checks skipped (set MIND_ATLAS_SPATIAL_URL to a staging-mock service)");
  process.exit(0);
}

const { chromium } = await import("@playwright/test");
const browser = await launchBrowser();
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok " : "  NG "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "ja-JP" });
  const page = await context.newPage();
  const origin = new URL(base).origin;
  await page.route((url) => !url.toString().startsWith(origin) && !/^(data|blob):/.test(url.toString()), (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let turns = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/ai/text-partner-turn")) turns += 1;
  });
  const wait = (ms) => page.waitForTimeout(ms);
  const cards = () => page.locator(".card").count();
  const groups = () => page.locator('.card[data-drop^="group:"]').count();
  const windows = () => page.locator(".fwin").count();
  const closeWindows = () => page.evaluate(() => document.querySelectorAll(".fwin .fwin-head button[aria-label]").forEach((b) => /閉じる|Close/.test(b.getAttribute("aria-label")) && b.click()));
  const boot = async () => {
    await page.goto(`${origin}/`);
    await wait(4500);
    await closeWindows();
    await wait(500);
  };

  // モックのログインと購読
  await page.goto(`${origin}/api/auth/google/start?returnTo=/`);
  await wait(2000);
  await page.evaluate(async () => {
    const r = await fetch("/api/billing/checkout", { method: "POST", credentials: "include" });
    const { url } = await r.json();
    await fetch(url, { credentials: "include", redirect: "manual" });
  });
  await boot();

  // 空いている所から囲んで、カードを何枚か選ぶ
  const marquee = async (w, h) => {
    await page.keyboard.press("Escape");
    const start = await page.evaluate(() => {
      const free = (x, y) => {
        const stack = document.elementsFromPoint(x, y);
        return stack.some((el) => el.classList?.contains("canvas")) && !stack.some((el) => el.closest("[data-card-id], [data-drop], .fwin, .shelf, .minimap, .legend, .radial, .trail"));
      };
      for (let y = 120; y < 700; y += 20) for (let x = 260; x < 1200; x += 20) if (free(x, y)) return { x, y };
      return null;
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + w, start.y + h, { steps: 12 });
    await page.mouse.up();
    await wait(700);
    return page.locator(".card.selected").count();
  };

  // 1) 輪からグループ化
  const picked = await marquee(520, 360);
  const groupItem = page.locator('.radial-item[aria-keyshortcuts="Ctrl+G"]');
  const enabled = picked >= 2 && (await groupItem.count()) === 1 && !(await groupItem.isDisabled());
  check(enabled, "multi-select shows an enabled group item in the ring", `${picked} selected`);
  const g0 = await groups();
  if (enabled) await groupItem.click();
  await wait(900);
  check((await groups()) === g0 + 1, "the ring's group item creates one group");

  // 2) Ctrl+G も同じ結果
  await page.keyboard.press("Control+z");
  await wait(700);
  const again = await marquee(520, 360);
  const g1 = await groups();
  await page.keyboard.press("Control+g");
  await wait(900);
  check(again >= 2 && (await groups()) === g1 + 1, "Ctrl+G creates one group the same way");
  await page.keyboard.press("Control+z");
  await wait(600);

  // 3) Ctrl+S：ブラウザの保存を止め、アプリが答える
  await page.evaluate(() => {
    window.__ctrlS = null;
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey)) window.__ctrlS = e.defaultPrevented;
    });
  });
  await page.keyboard.press("Control+s");
  await wait(800);
  const saveToast = (await page.locator(".toasts").innerText().catch(() => "")).replace(/\s+/g, " ");
  check((await page.evaluate(() => window.__ctrlS)) === true, "Ctrl+S prevents the browser save dialog");
  check(/保存しました|自動で保存/.test(saveToast), "Ctrl+S tells the user the space is saved", saveToast.slice(0, 40));
  await page.keyboard.press("Escape");
  await page.keyboard.press("n");
  await wait(700);
  const title = page.locator(".fwin .title-input").last();
  await title.focus();
  await page.keyboard.press("Control+s");
  await wait(500);
  check((await page.evaluate(() => window.__ctrlS)) === true, "Ctrl+S also works while typing");

  // 4) 入力欄の Enter で余計なカードができない
  const beforeTitle = await cards();
  await title.fill("入力欄の確認");
  await page.keyboard.press("Enter");
  await wait(700);
  check((await cards()) === beforeTitle, "Enter in a card title does not create a card");
  await closeWindows();
  await wait(400);

  // 5) 輪のボタンを押したあとの Enter は、もう一度押さない
  const spot = await page.evaluate(() => {
    for (const el of document.querySelectorAll(".card:not(.axis)")) {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (r.x > 260 && r.y > 90 && document.elementFromPoint(x, y)?.closest("[data-card-id]") === el) return { x, y };
    }
    return null;
  });
  await page.keyboard.press("Escape");
  await page.mouse.click(spot.x, spot.y);
  await wait(700);
  const c0 = await cards();
  const w0 = await windows();
  await page.locator(".radial-item").nth(1).click(); // 子カード
  await wait(800);
  await page.keyboard.press("Enter");
  await wait(800);
  check((await cards()) === c0 + 1, "Enter after a ring button does not run it again", `${c0} -> ${await cards()}`);
  const opened = await page.evaluate(() => [...document.querySelectorAll(".fwin")].map((w) => w.getAttribute("aria-label")));
  check((await windows()) <= w0 + 1, "Enter after a ring button opens at most the selected card's details", opened.join(", "));

  // 6) チャット：改行と送信
  await page.evaluate(() => localStorage.setItem("mindatlas-spatial-cost-notice", "1"));
  await boot();
  await page.evaluate(() => [...document.querySelectorAll(".sidebar .nav-item")].find((b) => /AIアシスタント/.test(b.textContent))?.click());
  await wait(1000);
  const input = page.locator(".fwin textarea.chat-input").last();
  await input.click();
  await input.type("一行目");
  await page.keyboard.press("Shift+Enter");
  await input.type("二行目");
  check((await input.inputValue()).includes("\n"), "Shift+Enter inserts a newline in the chat");

  // 7) 確認ダイアログ：Enter は「送信」だけ
  const cardsBefore = await cards();
  const windowsBefore = await windows();
  const turnsBefore = turns;
  await page.keyboard.press("Enter");
  await wait(600);
  check(await page.locator(".ask-box").isVisible(), "sending asks for confirmation when the estimate is on");
  await wait(300);
  await page.keyboard.press("Enter");
  await wait(2500);
  check(!(await page.locator(".ask-box").count()), "Enter confirms and closes the dialog");
  check(turns - turnsBefore === 1, "the message is sent exactly once", `${turns - turnsBefore} request(s)`);
  check((await cards()) === cardsBefore && (await windows()) === windowsBefore, "confirming does not create cards or open windows behind the dialog");
  check((await page.evaluate(() => document.activeElement?.classList.contains("chat-input"))) === true, "focus returns to the chat input");

  // 8) Ctrl+Enter でも送れる → そのダイアログで Escape
  await input.type("もう一つ");
  const turns2 = turns;
  await page.keyboard.press("Control+Enter");
  await wait(700);
  check(await page.locator(".ask-box").isVisible(), "Ctrl+Enter sends too");
  await wait(300);
  // Tab は箱の中を回る
  await page.keyboard.press("Tab");
  const firstTab = await page.evaluate(() => Boolean(document.activeElement?.closest(".ask-box")));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const stillInside = await page.evaluate(() => Boolean(document.activeElement?.closest(".ask-box")));
  check(firstTab && stillInside, "Tab stays inside the dialog");
  await page.keyboard.press("Escape");
  await wait(600);
  check(!(await page.locator(".ask-box").count()) && turns === turns2, "Escape cancels without sending");
  check((await input.inputValue()) === "もう一つ", "cancelling puts the text back in the input");
  check((await windows()) === windowsBefore, "Escape in the dialog does not also close the chat window");

  // 9) マウス：いいえ／外側／はい
  await input.fill("マウスで確認");
  await page.keyboard.press("Enter");
  await wait(700);
  const openedForCancel = await page.locator(".ask-box").isVisible();
  await page.locator(".ask-box .btn:not(.primary)").click();
  await wait(500);
  check(openedForCancel && !(await page.locator(".ask-box").count()) && turns === turns2, "the cancel button cancels");
  await input.focus();
  await page.keyboard.press("Enter");
  await wait(700);
  const openedForOutside = await page.locator(".ask-box").isVisible();
  await page.mouse.click(40, 40);
  await wait(500);
  check(openedForOutside && !(await page.locator(".ask-box").count()) && turns === turns2, "clicking outside cancels");
  await input.focus();
  await page.keyboard.press("Enter");
  await wait(700);
  await page.locator(".ask-box .btn.primary").click();
  await wait(2500);
  check(turns === turns2 + 1, "the send button sends");

  // 10) AIアシスタントはスペースごとに会話を覚える（閉じても、読み込み直しても残る）
  const userMsgs = () => page.locator(".fwin .msg.user").count();
  const kept = await userMsgs();
  await closeWindows();
  await wait(400);
  await page.evaluate(() => localStorage.removeItem("mindatlas-spatial-cost-notice"));
  await boot();
  await page.evaluate(() => [...document.querySelectorAll(".sidebar .nav-item")].find((b) => /AIアシスタント/.test(b.textContent))?.click());
  await wait(1200);
  check(kept >= 2 && (await userMsgs()) === kept, "the assistant remembers the conversation after a reload", `${kept} -> ${await userMsgs()}`);
  check((await page.evaluate(() => document.activeElement?.classList.contains("chat-input"))) === true, "the assistant's input has focus when it opens");

  // 11) /compact で要約に畳み、/clear で最初から
  const assistantInput = page.locator(".fwin textarea.chat-input").last();
  const turns3 = turns;
  await assistantInput.fill("/compact");
  await page.keyboard.press("Enter");
  await wait(3000);
  check(turns === turns3 + 1 && (await page.locator(".fwin .compact-divider").count()) === 1, "/compact summarizes the conversation into one request", `${turns - turns3} request(s)`);
  check((await page.locator(".fwin .msg.compacted").count()) >= 2, "summarized turns stay visible, dimmed");
  await assistantInput.fill("/clear");
  await page.keyboard.press("Enter");
  await wait(600);
  check((await userMsgs()) === 0 && turns === turns3 + 1, "/clear starts over without calling the AI");
  await page.locator(".toast button").filter({ hasText: "元に戻す" }).first().click();
  await wait(400);
  check((await userMsgs()) === kept, "undo brings the cleared conversation back");

  // 12) サークルメニューの「AIに質問」：開いたらすぐ質問欄。打った文字でカードは増えない。過去の会話は持ち込まない
  await closeWindows();
  await wait(400);
  await page.locator(".card").first().click();
  await wait(500);
  const cardsBeforeAsk = await cards();
  await page.locator(".radial-item").filter({ hasText: "質問" }).first().click();
  await wait(900);
  const focused = await page.evaluate(() => document.activeElement?.classList.contains("chat-input"));
  await page.keyboard.type("nando");
  await wait(400);
  const ask = page.locator(".fwin textarea.chat-input").last();
  check(focused === true, "the ring's ask window focuses its input when it opens");
  check((await cards()) === cardsBeforeAsk && (await ask.inputValue()) === "nando", "typing right away goes into the question, not into new cards", `cards ${cardsBeforeAsk} -> ${await cards()}`);
  check((await page.locator(".fwin .msg").count()) === 0, "the ring's ask starts without the assistant's history");

  // 13) 日本語入力の途中のキーは空間の操作にしない（N で新しいカードができない）
  await closeWindows();
  await wait(400);
  await page.mouse.click(40, 400);
  const cardsBeforeIme = await cards();
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "n", keyCode: 229, isComposing: true, bubbles: true })));
  await wait(400);
  check((await cards()) === cardsBeforeIme, "keys while composing Japanese do not create cards");

  check(!errors.length, "no page errors", errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`verify:spatial-ui failed: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("verify:spatial-ui browser checks passed");

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ headless: true }),
    () => chromium.launch({ channel: "chrome", headless: true }),
    () => chromium.launch({ channel: "msedge", headless: true }),
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
