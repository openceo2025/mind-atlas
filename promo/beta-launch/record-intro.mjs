// 導入アニメーション（cards/intro.html）を、横 1920×1080 と縦 1080×1920 の両方で録る。
//   node promo/beta-launch/record-intro.mjs           （日本語）
//   node promo/beta-launch/record-intro.mjs --lang en （英語。out/intro-*-en に録る）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { Recorder } from "./lib/recorder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const lang = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : "ja";
const suffix = lang === "ja" ? "" : `-${lang}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });

for (const [base, width, height] of [["intro-landscape", 1920, 1080], ["intro-vertical", 1080, 1920]]) {
  const name = `${base}${suffix}`;
  const dir = path.join(here, "out", name);
  fs.rmSync(dir, { recursive: true, force: true });
  const rec = new Recorder(dir);
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`${pathToFileURL(path.join(here, "cards", "intro.html")).href}?lang=${lang}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await rec.start(page, "intro");
  await page.evaluate(() => window.startIntro());
  const lag = rec.now(); // 録画の開始から、アニメーションが動き出すまで
  const { beats, duration } = await page.evaluate(() => window.INTRO);
  for (const [kind, at] of Object.entries(beats)) rec.events.push({ t: Number((at + lag).toFixed(3)), kind: `intro-${kind}` });
  await page.waitForTimeout((duration + 0.1) * 1000);
  await rec.stop();
  const tl = rec.save();
  // 保存形式は録画と同じ。大きさだけ、この向きのものにする
  fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify({ ...tl, width, height }));
  console.log(`${name}: ${tl.duration.toFixed(2)}s, ${tl.segments[0].frames.length} frames`);
  await page.context().close();
}
await browser.close();
