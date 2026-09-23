// YouTube 用のサムネイル（1280×720）。撮った映像の一コマを右に置き、左に大きな一行を載せる。
//   node promo/beta-launch/thumbnail.mjs [秒]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const timeline = JSON.parse(fs.readFileSync(path.join(out, "timeline.json"), "utf8"));
const at = Number(process.argv[2] ?? 33);

function frameAt(t) {
  let offset = 0;
  for (const s of timeline.segments) {
    const len = s.end - s.start;
    if (t < offset + len || s === timeline.segments.at(-1)) {
      const wall = s.start + (t - offset);
      let pick = s.frames[0];
      for (const f of s.frames) if (f.at <= wall) pick = f;
      else break;
      return pick.file;
    }
    offset += len;
  }
}

const shot = pathToFileURL(path.join(out, "frames", frameAt(at))).href;
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
* { margin: 0; box-sizing: border-box; }
body { width: 1280px; height: 720px; overflow: hidden; background: #040b1a; font-family: "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif; color: #fff; position: relative; }
.shot { position: absolute; right: -150px; top: 70px; width: 980px; border-radius: 18px; border: 2px solid rgba(106, 190, 255, .55);
  box-shadow: 0 30px 80px rgba(0, 0, 0, .6), 0 0 80px rgba(63, 169, 255, .35); transform: perspective(1400px) rotateY(-14deg) rotateX(4deg); }
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, #040b1a 36%, rgba(4, 11, 26, .75) 55%, rgba(4, 11, 26, 0) 80%); }
.text { position: absolute; left: 64px; top: 120px; display: flex; flex-direction: column; gap: 22px; }
h1 { font-size: 104px; font-weight: 900; line-height: 1.1; letter-spacing: .02em; text-shadow: 0 6px 40px rgba(63, 169, 255, .5); }
h1 em { font-style: normal; background: linear-gradient(90deg, #6ae3ff, #8fb7ff); -webkit-background-clip: text; color: transparent; }
p { font-size: 38px; font-weight: 800; color: #e6f0ff; }
p b { color: #6ae3ff; }
.brand { display: flex; align-items: center; gap: 14px; font: 800 40px/1 "Segoe UI", system-ui, sans-serif; margin-top: 10px; }
.orb { width: 44px; height: 44px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #9fe7ff, #2a7bff 55%, #0a2a66); box-shadow: 0 0 30px rgba(63, 169, 255, .8); }
.beta { font-size: 24px; color: #ffd166; border: 2px solid rgba(255, 209, 102, .7); border-radius: 9px; padding: 4px 9px; }
</style></head><body>
<img class="shot" src="${shot}">
<div class="fade"></div>
<div class="text">
  <h1>思考を、<br><em>空間</em>に。</h1>
  <p>AIが<b>意味</b>でカードを並べる</p>
  <div class="brand"><span class="orb"></span>MindAtlas <span class="beta">β</span></div>
</div>
</body></html>`;
fs.writeFileSync(path.join(out, "thumbnail.html"), html);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(path.join(out, "thumbnail.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, "thumbnail.png") });
await browser.close();
console.log("thumbnail:", path.join(out, "thumbnail.png"));
