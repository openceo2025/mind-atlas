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
  await page.evaluate(() => [...document.querySelectorAll(".sidebar .nav-item")].find((b) => /AIに質問/.test(b.textContent))?.click());
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
