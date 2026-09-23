// 横版の字幕を、字幕ごとに透明な PNG（1920×1080）として描く。
// 見た目は録画中に出していた字幕（overlay.js）と同じ。書き出しのときに映像へ重ねる。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function captionsOf(timeline) {
  const list = [];
  for (const e of timeline.events) if (e.kind === "caption" && e.data && !list.some((c) => c.ja === e.data.ja)) list.push(e.data);
  return list;
}

const html = (caption) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 1280px; height: 720px; background: transparent; overflow: hidden; }
.cap { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 13px 30px 12px; border-radius: 16px;
  background: linear-gradient(180deg, rgba(8, 20, 48, .9), rgba(5, 14, 36, .92)); border: 1px solid rgba(106, 190, 255, .38);
  box-shadow: 0 18px 60px rgba(0, 0, 0, .45), 0 0 50px rgba(63, 169, 255, .18); }
.cap b { font: 800 34px/1.25 "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif; color: #fff;
  letter-spacing: .02em; white-space: nowrap; text-shadow: 0 2px 18px rgba(63, 169, 255, .35); }
.cap b em { font-style: normal; color: #6ae3ff; }
.cap small { font: 600 15px/1.3 "Segoe UI", "Inter", system-ui, sans-serif; color: rgba(200, 225, 255, .78); letter-spacing: .03em; }
</style></head><body><div class="cap"><b>${caption.ja.replace(/【(.+?)】/g, "<em>$1</em>")}</b><small>${caption.en}</small></div></body></html>`;

export async function renderLandscapeCaptions(browser, timeline, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const captions = captionsOf(timeline);
  // 録画と同じく、1280×720 の配置を 1.5 倍（1920×1080）で描く
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  for (let i = 0; i < captions.length; i++) {
    const file = path.join(dir, `caption-${i}.html`);
    fs.writeFileSync(file, html(captions[i]));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(dir, `caption-${i}.png`), omitBackground: true });
  }
  await context.close();
  return captions;
}
