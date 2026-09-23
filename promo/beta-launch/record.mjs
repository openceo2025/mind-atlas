// 宣伝動画の撮影。実際のアプリを台本どおりに操作し、その画面をそのまま録る。
//
// 相手にするのは手元のステージング用サービス（モックのログイン・課金・AI）で、本番には触れない。
// AI の答えは下の台本（scriptedTurn）で決めているので、毎回同じ流れになる。
//   PROMO_APP_URL=http://127.0.0.1:8799 node promo/beta-launch/record.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { Recorder, makeHand } from "./lib/recorder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const app = process.env.PROMO_APP_URL || "http://127.0.0.1:8799";
const origin = new URL(app).origin;

fs.rmSync(path.join(out, "frames"), { recursive: true, force: true });
const rec = new Recorder(out);
const overlay = fs.readFileSync(path.join(here, "overlay.js"), "utf8");

// 冒頭と締めは 1920×1080 でそのまま描く
const cardBrowser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });
const cardPage = await (await cardBrowser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
// アプリは 1280×720 の配置を 1.5 倍の解像度（1920×1080）で描く。スマホでも文字が読める大きさになる。
// 録画の絵を実際の画素で受け取るには、ブラウザ起動時の倍率指定でないといけない
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-device-scale-factor=1.5"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: "ja-JP", colorScheme: "dark" });
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

// ── 冒頭 ───────────────────────────────────────────────
async function card(file, seconds) {
  await cardPage.goto(pathToFileURL(path.join(here, "cards", file)).href);
  await cardPage.evaluate(() => document.fonts.ready);
  await cardPage.waitForTimeout(300);
  await rec.start(cardPage, file);
  await cardPage.evaluate(() => document.body.classList.remove("wait"));
  await cardPage.waitForTimeout(seconds * 1000);
  await rec.stop();
}
await card("title.html", 3.4);

// ── アプリの準備（ここは録らない） ─────────────────────────
// 外への通信は止める。判断モデルは使わず、AI の返事は台本どおりに返す
await page.route((url) => !url.toString().startsWith(origin) && !/^(data|blob|file):/.test(url.toString()), (route) => route.abort());
await page.route(`${origin}/api/service/session`, async (route) => {
  const response = await route.fetch();
  const json = await response.json();
  if (json.decide) json.decide.configured = false;
  await route.fulfill({ response, json });
});
await page.route(`${origin}/api/ai/text-partner-turn`, async (route) => {
  const body = route.request().postDataJSON();
  await new Promise((resolve) => setTimeout(resolve, 700)); // 考えている間
  await route.fulfill({ json: scriptedTurn(body) });
});
await context.addInitScript(overlay);

await page.goto(`${origin}/api/auth/google/start?returnTo=/`);
await wait(1800);
await page.evaluate(async () => {
  const r = await fetch("/api/billing/checkout", { method: "POST", credentials: "include" });
  const { url } = await r.json();
  await fetch(url, { credentials: "include", redirect: "manual" });
});
await page.goto(`${origin}/`);
await wait(5500);
await closeWindows();
await wait(400);

// カーソルの位置は縦版で「どこを映すか」を決めるのに使う（録画中だけ記録される）
const hand = makeHand(page, (x, y) => rec.current && rec.mark("cursor", { x: Math.round(x), y: Math.round(y) }));
await frame();
await hand.park(1150, 650);
// 字幕は映像に焼き込まず、時刻だけ記録する（書き出すときに横・縦それぞれの形で重ねる）
const caption = async (ja, en) => rec.mark("caption", { ja, en });
const hideCaption = async () => rec.mark("caption", null);

// ── 1) 意味で並ぶ ───────────────────────────────────────
await rec.start(page, "app");
rec.mark("cursor", { x: hand.pos.x, y: hand.pos.y });
await wait(300);
await caption("メモを置くだけ。AIが【意味】で並べる。", "Drop in your notes — AI lays them out by meaning.");
await wait(2800);

// ── 2) 軸を変えると、別の地図になる ─────────────────────────
await hideCaption();
await wait(250);
await caption("軸を変えれば、同じメモが【別の地図】に。", "Change the axes and the same notes become a new map.");
await wait(500);
rec.mark("whoosh");
await page.keyboard.press("2");
await wait(2300);
rec.mark("whoosh");
await page.keyboard.press("5");
await wait(2300);
await hideCaption();
await page.keyboard.press("3");
await wait(1200);

// ── 3) アイデアから、アイデアを生やす ────────────────────────
// 画面を少し流して右に空きを作り、集まりから1枚を手で運び出して、そこから子カードを生やす
const shift = 360;
await caption("ひとつの考えから、【次の考え】を。", "Grow new ideas straight from the old ones.");
await pan(shift, 600);
const seed = await pickCard();
const drop = { x: 790, y: 215 };
await hand.glide(seed.x, seed.y, 500);
await page.mouse.down();
await hand.glide(drop.x, drop.y, 800);
await page.mouse.up();
rec.mark("click");
await wait(650);
const child = await center('.radial-item[aria-label="子カード"]');
await hand.glide(child.x, child.y, 450);
await wait(250);
for (let i = 0; i < 3; i++) {
  await hand.click(child.x, child.y, 110);
  rec.mark("pop");
  await wait(450);
}
// 輪を閉じて、生えた3枚を見せる
await page.keyboard.press("Escape");
await hand.glide(drop.x - 60, drop.y + 260, 450);
await wait(1100);
await hideCaption();
await pan(-shift, 500);

// ── 4) 頼めば、AI が作ってつなぐ ─────────────────────────
await page.keyboard.press("Escape");
await wait(200);
await caption("頼むだけで、AIがカードを【作って、つなぐ】。", "Just ask — AI creates the cards and links them for you.");
const nav = await center(".sidebar .nav-item >> text=AIに質問");
await hand.click(nav.x, nav.y, 650);
await wait(600);
const input = await center(".fwin textarea.chat-input");
await hand.click(input.x, input.y, 500);
await page.keyboard.type("A案の課題を3つ、カードにしてつないで", { delay: 45 });
await wait(300);
await page.keyboard.press("Enter");
await wait(1400);
rec.mark("pop");
await wait(2600);

// ── 5) 見落としていたつながり ─────────────────────────────
await hideCaption();
await closeWindows();
await wait(450);
// 画面の真ん中あたりで見えているカードから探す（寄り直すと画面が跳ねるので）
const plan = await pickCard();
await caption("見落としていた【つながり】も、AIが見つける。", "AI surfaces the connections you missed.");
await hand.click(plan.x, plan.y, 700);
rec.mark("click");
await wait(600);
const spark = await center(".radial-center");
await hand.click(spark.x, spark.y, 450);
rec.mark("pop");
await wait(2800);

// ── 6) まとめて、ひとかたまりに ───────────────────────────
await hideCaption();
await closeWindows();
await page.keyboard.press("Escape");
await wait(400);
await caption("散らばった考えを、ひとつに【まとめる】。", "Gather scattered thoughts into one group.");
const box = await marqueePlan();
await hand.glide(box.x1, box.y1, 600);
await page.mouse.down();
await hand.glide(box.x2, box.y2, 1000);
await page.mouse.up();
await wait(600);
const groupItem = await center('.radial-item[aria-keyshortcuts="Ctrl+G"]');
await hand.glide(groupItem.x, groupItem.y, 500);
await wait(450);
await hand.click(groupItem.x, groupItem.y, 100);
rec.mark("pop");
await wait(1700);
await hideCaption();
await wait(400);
// ページが記録した「大事な場所」を、動画の時刻に直して残す
const appStart = rec.current.segment.startedAt;
const appBase = rec.videoTime;
for (const sample of await page.evaluate(() => window.__promo.roi)) {
  const t = appBase + (sample.t / 1000 - appStart);
  if (t >= appBase) rec.events.push({ t: Number(t.toFixed(3)), kind: "roi", data: sample.boxes });
}
await rec.stop();

// ── 締め ───────────────────────────────────────────────
await card("end.html", 4.6);

const timeline = rec.save();
console.log(`recorded ${timeline.segments.map((s) => `${s.name} ${(s.end - s.start).toFixed(1)}s/${s.frames.length}f`).join(", ")} — ${timeline.duration}s`);
if (errors.length) console.log("page errors:", errors.slice(0, 3));
await browser.close();
await cardBrowser.close();

// ── 道具（座標はアプリの 1280×720） ────────────────────────
/** 全体に合わせてから、カードの集まりの中心へ寄る（軸の先端は画面の外に出てよい） */
async function frame() {
  await page.keyboard.press("f");
  await wait(1400);
  const middle = await page.evaluate(() => {
    const rs = [...document.querySelectorAll(".card:not(.axis):not(.concept)")]
      .filter((el) => getComputedStyle(el).opacity !== "0")
      .map((el) => el.getBoundingClientRect());
    if (!rs.length) return { x: 740, y: 380 };
    return { x: rs.reduce((a, r) => a + r.x + r.width / 2, 0) / rs.length, y: rs.reduce((a, r) => a + r.y + r.height / 2, 0) / rs.length };
  });
  await page.mouse.move(middle.x, middle.y);
  for (const delta of [-120, -120, -90]) {
    await page.mouse.wheel(0, delta);
    await wait(350);
  }
  // 寄ったあと、集まりを画面の真ん中（サイドバーを除いた所）へ
  const after = await page.evaluate(() => {
    const rs = [...document.querySelectorAll(".card:not(.axis):not(.concept)")].map((el) => el.getBoundingClientRect());
    return { x: rs.reduce((a, r) => a + r.x + r.width / 2, 0) / rs.length, y: rs.reduce((a, r) => a + r.y + r.height / 2, 0) / rs.length };
  });
  const target = { x: 208 + (1280 - 208) / 2, y: 70 + (720 - 70 - 90) / 2 };
  await page.keyboard.down("Space");
  await page.mouse.move(after.x, after.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await wait(700);
}

function closeWindows() {
  return page.evaluate(() => document.querySelectorAll(".fwin .fwin-head button[aria-label]").forEach((b) => /閉じる|Close/.test(b.getAttribute("aria-label")) && b.click()));
}

async function center(selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 8000 });
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** 見えていて、ほかのカードに隠れていない点（そのカードの上） */
async function visibleCard(id) {
  const spot = await page.evaluate((cid) => {
    const el = document.querySelector(`[data-card-id="${cid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.45], [0.3, 0.5], [0.7, 0.5], [0.5, 0.75], [0.25, 0.3]]) {
      const x = r.x + r.width * fx;
      const y = r.y + r.height * fy;
      if (x > 180 && x < 1250 && y > 80 && y < 620 && document.elementFromPoint(x, y)?.closest("[data-card-id]") === el) return { x, y };
    }
    return null;
  }, id);
  if (spot) return spot;
  await frame();
  return visibleCard(id);
}

/** 画面を横に流す（トラックパッドの横スクロールと同じ動き）。ミニマップの上では効かないので空間の上で */
async function pan(dx, ms) {
  if (hand.pos.x > 1000 || hand.pos.y > 560) await hand.glide(660, 330, 350);
  const steps = Math.max(6, Math.round(ms / 20));
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const want = Math.round(dx * eased);
    if (want !== done) await page.mouse.wheel(want - done, 0);
    done = want;
    await wait(ms / steps);
  }
}

/** 画面に見えていて一番上にある、ふつうの大きさのカード（左寄りのものから） */
async function pickCard() {
  return page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll(".card:not(.axis):not(.concept):not(.topic)")) {
      const r = el.getBoundingClientRect();
      if (r.width > 220 || r.x < 220 || r.y < 90 || r.bottom > 560 || r.right > 760) continue;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (document.elementFromPoint(x, y)?.closest("[data-card-id]") === el) found.push({ x, y });
    }
    found.sort((p, q) => Math.hypot(p.x - 520, p.y - 300) - Math.hypot(q.x - 520, q.y - 300));
    return found[0] ?? { x: 520, y: 300 };
  });
}

/** 空いている所から、カードの集まりを囲む四角 */
async function marqueePlan() {
  return page.evaluate(() => {
    const free = (x, y) => {
      const stack = document.elementsFromPoint(x, y);
      return stack.some((el) => el.classList?.contains("canvas")) && !stack.some((el) => el.closest("[data-card-id], [data-drop], .fwin, .shelf, .minimap, .legend, .radial, .trail"));
    };
    const cards = [...document.querySelectorAll(".card:not(.axis):not(.concept)")].map((el) => el.getBoundingClientRect()).filter((r) => r.x > 180 && r.y > 80 && r.right < 1240 && r.bottom < 600);
    let best = null;
    for (let y = 90; y < 400; y += 14) {
      for (let x = 190; x < 900; x += 14) {
        if (!free(x, y)) continue;
        const x2 = Math.min(x + 380, 1230);
        const y2 = Math.min(y + 230, 590);
        const n = cards.filter((r) => r.x >= x && r.y >= y && r.right <= x2 && r.bottom <= y2).length;
        if (n >= 3 && free(x2, y2) && (!best || n > best.n)) best = { x1: x, y1: y, x2, y2, n };
      }
    }
    return best ?? { x1: 220, y1: 110, x2: 600, y2: 340, n: 0 };
  });
}

/** AI の返事の台本 */
function scriptedTurn(body) {
  const messages = body.messages ?? [];
  const asked = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  const base = { provider: body.provider || "openai", model: body.model || "gpt-6-sol" };
  // 関係の種類を判定する問い
  if (asked.includes("Candidate pairs:")) {
    const pairs = [...asked.matchAll(/\[([^\]]+)\]→\[([^\]]+)\]/g)].map((m) => [m[1], m[2]]);
    const titles = new Map([...String(body.contextText ?? "").matchAll(/\[([^\]]+)\]\s*([^\n]+)/g)].map((m) => [m[1], m[2].trim()]));
    const plan = [
      ["supports", (a, b) => `「${a}」は「${b}」を後押しする材料になる`],
      ["related", () => "同じテーマを別の角度から扱っている"],
      ["contradicts", (a, b) => `「${a}」は「${b}」のリスクになりうる`],
      ["derived", (a, b) => `「${b}」は「${a}」から導かれる`],
      ["related", () => "論点が重なっている"],
      ["supports", (a, b) => `「${a}」が「${b}」の根拠になる`],
    ];
    const relations = pairs.map(([from, to], i) => {
      const [type, reason] = plan[i % plan.length];
      const a = (titles.get(from) ?? from).slice(0, 14);
      const b = (titles.get(to) ?? to).slice(0, 14);
      return { from, to, type, reason: reason(a, b) };
    });
    return { ...base, text: JSON.stringify({ relations }), toolCalls: [] };
  }
  // チャット：1回目で道具を使い、2回目で報告する
  if (messages.some((m) => m.role === "tool")) {
    return {
      ...base,
      text: "A案につながる課題を3枚置きました。\n\n- **港湾整備が前提** — 基地港が足りず着工が遅れる恐れ\n- **漁業との合意形成** — 調整に時間がかかる\n- **台風・塩害への耐久性** — 保守費用が膨らむ可能性",
      toolCalls: [],
    };
  }
  if (Array.isArray(body.tools) && body.tools.length) {
    const near = "A案：大規模な洋上風力";
    return {
      ...base,
      text: "",
      toolCalls: [
        {
          callId: "promo_1",
          name: "create_cards",
          arguments: JSON.stringify({
            cards: [
              { title: "港湾整備が前提", body: "建設用の基地港が足りず、着工が遅れる恐れがある。", kind: "issue", tags: ["風力", "インフラ"], near },
              { title: "漁業との合意形成", body: "漁業権との調整に時間がかかる。", kind: "issue", tags: ["風力", "地域"], near },
              { title: "台風・塩害への耐久性", body: "設備の保守費用が想定を超える可能性。", kind: "issue", tags: ["風力", "リスク"], near },
            ],
          }),
        },
      ],
    };
  }
  return { ...base, text: "{}", toolCalls: [] };
}
