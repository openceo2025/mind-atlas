// 縦（9:16・1080×1920）版。横版と同じ録画を使い回す。
//
// 画面の真ん中の窓に、録画のうち「いま大事な所」（カーソル・窓・操作の輪・選んだカード）が
// 全部入るよう切り出して置く。ふだんは等倍、入らないときだけ少し引く（encode.html の verticalPainter）。
// 字幕は下に大きく描く。
//   node promo/beta-launch/vertical.mjs
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const dir = path.join(out, "vertical");
fs.mkdirSync(dir, { recursive: true });
const timeline = JSON.parse(fs.readFileSync(path.join(out, "timeline.json"), "utf8"));

// 字幕の並び（録画のときに記録した順）
const captions = [];
for (const e of timeline.events) if (e.kind === "caption" && e.data && !captions.some((c) => c.ja === e.data.ja)) captions.push(e.data);

// ── 1) 画面の飾り（上の見出し・下の字幕・いちばん下の URL）を、字幕ごとに一枚ずつ ──
const WINDOW = { y: 430, h: 900 };
const bg = `radial-gradient(900px 700px at 60% 30%, rgba(24,70,150,.42), transparent 70%), radial-gradient(800px 800px at 20% 90%, rgba(40,90,200,.22), transparent 70%), #040b1a`;
const page = (caption, plain) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
* { margin: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: transparent; font-family: "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif; color: #fff; }
.block { position: absolute; left: 0; width: 1080px; background: ${bg}; background-size: 1080px 1920px; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(90,150,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(90,150,255,.07) 1px, transparent 1px); background-size: 60px 60px; }
.top { top: 0; height: ${WINDOW.y}px; background-position: 0 0; }
.bottom { top: ${WINDOW.y + WINDOW.h}px; height: ${1920 - WINDOW.y - WINDOW.h}px; background-position: 0 -${WINDOW.y + WINDOW.h}px; }
.all { top: 0; height: 1920px; }
.edge { position: absolute; left: 0; width: 1080px; height: 2px; background: linear-gradient(90deg, transparent, rgba(106,227,255,.8), transparent); box-shadow: 0 0 24px rgba(63,169,255,.7); }
.brand { position: absolute; top: 70px; left: 0; width: 1080px; display: flex; justify-content: center; align-items: center; gap: 18px; font: 800 56px/1 "Segoe UI", system-ui, sans-serif; }
.orb { width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #9fe7ff, #2a7bff 55%, #0a2a66); box-shadow: 0 0 36px rgba(63,169,255,.85); }
.beta { font-size: 30px; color: #ffd166; border: 2px solid rgba(255,209,102,.7); border-radius: 11px; padding: 5px 11px; }
.head { position: absolute; top: 158px; left: 0; width: 1080px; text-align: center; font-size: 104px; font-weight: 900; letter-spacing: .03em; text-shadow: 0 6px 40px rgba(63,169,255,.45); }
.head em, .cap b em { font-style: normal; color: #6ae3ff; }
.head em { background: linear-gradient(90deg, #6ae3ff, #8fb7ff); -webkit-background-clip: text; color: transparent; }
.sub { position: absolute; top: 300px; left: 0; width: 1080px; text-align: center; font-size: 42px; font-weight: 800; color: #dce8ff; }
.cap { position: absolute; top: ${WINDOW.y + WINDOW.h + 56}px; left: 60px; width: 960px; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.cap b { font-size: 68px; line-height: 1.28; font-weight: 900; text-shadow: 0 4px 30px rgba(63,169,255,.4); word-break: keep-all; overflow-wrap: anywhere; }
.cap small { font: 600 32px/1.3 "Segoe UI", system-ui, sans-serif; color: rgba(200,225,255,.8); }
.url { position: absolute; top: 1790px; left: 50%; transform: translateX(-50%); font: 700 40px/1 "Segoe UI", system-ui, sans-serif; padding: 20px 40px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(63,169,255,.28), rgba(106,227,255,.18)); border: 2px solid rgba(106,227,255,.7); box-shadow: 0 0 40px rgba(63,169,255,.35); white-space: nowrap; }
</style></head><body>
${plain ? `<div class="block all"><div class="grid"></div></div>` : `
<div class="block top"><div class="grid"></div>
  <div class="brand"><span class="orb"></span>MindAtlas <span class="beta">β</span></div>
  <div class="head">思考を、<em>空間</em>に。</div>
  <div class="sub">AIが意味でカードを並べる</div>
</div>
<div class="block bottom"><div class="grid"></div></div>
<div class="edge" style="top:${WINDOW.y - 1}px"></div>
<div class="edge" style="top:${WINDOW.y + WINDOW.h - 1}px"></div>
${caption ? `<div class="cap"><b>${caption.ja.replace(/【(.+?)】/g, "<em>$1</em>").replace(/、/, "、<br>")}</b><small>${caption.en}</small></div>` : ""}
<div class="url">beta.mind-atlas.org</div>`}
</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const shot = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
async function render(file, html) {
  fs.writeFileSync(path.join(dir, `${file}.html`), html);
  await shot.goto(pathToFileURL(path.join(dir, `${file}.html`)).href);
  await shot.evaluate(() => document.fonts.ready);
  await shot.waitForTimeout(150);
  await shot.screenshot({ path: path.join(dir, `${file}.png`), omitBackground: true });
}
await render("plain", page(null, true));
await render("chrome-none", page(null, false));
for (let i = 0; i < captions.length; i++) await render(`chrome-${i}`, page(captions[i], false));
await shot.close();
console.log(`vertical chrome: ${captions.length} captions`);

// ── 2) Chrome の符号器で、縦版の MP4 にする（encode.html の縦の組み立てを使う） ──
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".wav": "audio/wav", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/save") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fs.writeFileSync(path.join(out, path.basename(url.searchParams.get("name"))), Buffer.concat(chunks));
      res.end("ok");
    });
    return;
  }
  const target = path.normalize(path.join(here, decodeURIComponent(url.pathname)));
  if (!target.startsWith(here) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return res.writeHead(404).end();
  res.setHeader("Content-Type", TYPES[path.extname(target)] || "application/octet-stream");
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const encoder = await browser.newPage();
encoder.on("console", (m) => console.log(m.text()));
encoder.setDefaultTimeout(30 * 60_000);
await encoder.goto(`http://127.0.0.1:${server.address().port}/encode.html`);
await encoder.waitForFunction(() => typeof window.runEncode === "function");
const result = await encoder.evaluate(
  (opts) => window.runEncode(opts),
  { name: "mindatlas-beta-vertical.mp4", layout: "vertical", window: WINDOW, captions: captions.map((c) => c.ja) },
);
console.log(JSON.stringify(result));
await browser.close();
server.close();
