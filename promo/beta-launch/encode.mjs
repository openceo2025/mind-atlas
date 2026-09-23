// out/ の絵と音から MP4 を作る。Chrome を符号器として使うので、ffmpeg などは要らない。
//   node promo/beta-launch/encode.mjs [出力ファイル名]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { renderLandscapeCaptions } from "./lib/captions.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const name = process.argv[2] || "mindatlas-beta.mp4";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".wav": "audio/wav", ".css": "text/css" };

// このフォルダだけを、自分の機械の中だけに見せる
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/save") {
    const file = path.basename(url.searchParams.get("name") || name);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fs.writeFileSync(path.join(out, file), Buffer.concat(chunks));
      res.end("ok");
    });
    return;
  }
  const target = path.normalize(path.join(here, decodeURIComponent(url.pathname)));
  if (!target.startsWith(here) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("Content-Type", TYPES[path.extname(target)] || "application/octet-stream");
  fs.createReadStream(target).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch({ channel: "chrome", headless: true });
// 字幕は映像に焼き込んでいないので、字幕ごとの絵を先に作っておく
const timeline = JSON.parse(fs.readFileSync(path.join(out, "timeline.json"), "utf8"));
const captions = await renderLandscapeCaptions(browser, timeline, path.join(out, "landscape"));
const page = await browser.newPage();
page.on("console", (m) => console.log(m.text()));
page.setDefaultTimeout(30 * 60_000);
await page.goto(`http://127.0.0.1:${port}/encode.html`);
await page.waitForFunction(() => typeof window.runEncode === "function");
const result = await page.evaluate((opts) => window.runEncode(opts), { name, layout: "landscape", captions: captions.map((c) => c.ja) });
console.log(JSON.stringify(result));
await browser.close();
server.close();
