// できあがった MP4 そのものから絵を取り出して並べる（書き出しの確認用）
//   node promo/beta-launch/lib/check-mp4.mjs [ファイル名] [秒,秒,...]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const file = process.argv[2] || "mindatlas-beta.mp4";
const times = (process.argv[3] || "0.5,2,3.4,5,8,12,16,20,25,30,35,40,44,48,50,52").split(",").map(Number);

const server = http.createServer((req, res) => {
  const name = path.basename(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const target = path.join(out, name);
  if (!fs.existsSync(target)) return res.writeHead(404).end();
  if (name.endsWith(".html")) return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fs.readFileSync(target));
  const size = fs.statSync(target).size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(target, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": size, "Accept-Ranges": "bytes" });
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
// 縦の動画は細い枠で 8 列に並べる
const tall = /vertical/.test(file);
const cols = tall ? 8 : 4;
const tw = tall ? 240 : 480;
const th = tall ? 427 : 270;
fs.writeFileSync(path.join(out, "check.html"), `<body style="margin:0;background:#111"><canvas id=c width=${cols * tw} height=${Math.ceil(times.length / cols) * th}></canvas></body>`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: cols * tw, height: Math.ceil(times.length / cols) * th } });
await page.goto(`http://127.0.0.1:${port}/check.html`);
const info = await page.evaluate(async ({ src, times, cols, tw, th }) => {
  const v = document.createElement("video");
  v.muted = true;
  // 画面に置かないと、次の絵が描かれた合図（requestVideoFrameCallback）が来ない
  v.style.cssText = "position:fixed;right:0;bottom:0;width:160px;height:90px;opacity:.01";
  document.body.appendChild(v);
  v.src = src;
  await new Promise((ok, ng) => { v.onloadeddata = ok; v.onerror = () => ng(new Error("load failed")); });
  const g = document.getElementById("c").getContext("2d");
  for (let i = 0; i < times.length; i++) {
    v.currentTime = times[i];
    await new Promise((ok) => { v.onseeked = ok; });
    await Promise.race([new Promise((ok) => v.requestVideoFrameCallback(() => ok())), new Promise((ok) => setTimeout(ok, 400))]);
    const x = (i % cols) * tw;
    const y = Math.floor(i / cols) * th;
    g.drawImage(v, x, y, tw, th);
    g.fillStyle = "#000a";
    g.fillRect(x + 4, y + 4, 60, 22);
    g.fillStyle = "#fff";
    g.font = "15px sans-serif";
    g.fillText(`${times[i]}s`, x + 10, y + 20);
  }
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
}, { src: `/${file}`, times, cols, tw, th });
await page.screenshot({ path: path.join(out, "check.png") });
console.log(JSON.stringify(info), "→", path.join(out, "check.png"));
await browser.close();
server.close();
