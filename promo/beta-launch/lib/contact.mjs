// 撮った映像の見本（決めた時刻の絵を並べた一枚）を作る。仕上がりの確認用
//   node promo/beta-launch/lib/contact.mjs [秒,秒,...] [out の中のフォルダ（既定は out そのもの）]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(here, "out");
const dir = path.join(out, process.argv[3] ?? "");
const timeline = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8"));
const times = (process.argv[2] ?? "1,3,6,9,12,15,19,23,27,31,35,39,43,47,51,56").split(",").map(Number);

/** 動画の時刻 t（秒）に映っている絵 */
export function frameAt(tl, t) {
  let offset = 0;
  for (const s of tl.segments) {
    const len = s.end - s.start;
    if (t < offset + len || s === tl.segments.at(-1)) {
      const wall = s.start + (t - offset);
      let pick = s.frames[0];
      for (const f of s.frames) if (f.at <= wall) pick = f; else break;
      return pick?.file;
    }
    offset += len;
  }
}

const tall = (timeline.height ?? 1080) > (timeline.width ?? 1920);
const cols = tall ? 7 : 4;
const tw = tall ? 270 : 480;
const th = tall ? 480 : 270;
const tiles = times.map((t) => ({ t, file: frameAt(timeline, t) }));
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:4px;font:14px sans-serif;color:#fff">
${tiles.map((x) => `<div style="position:relative"><img src="${pathToFileURL(path.join(dir, "frames", x.file)).href}" style="width:${tw}px;height:${th}px;display:block"><span style="position:absolute;left:6px;top:4px;background:#000a;padding:2px 6px">${x.t}s</span></div>`).join("")}</body>`;
fs.writeFileSync(path.join(out, "contact.html"), html);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: cols * (tw + 4), height: Math.ceil(tiles.length / cols) * (th + 4) } });
await page.goto(pathToFileURL(path.join(out, "contact.html")).href);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, "contact.png"), fullPage: true });
await browser.close();
console.log("contact sheet:", path.join(out, "contact.png"));
