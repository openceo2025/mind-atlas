// 1分版の編集。導入アニメーション → 実際の画面（見せ場だけ、止まっている所は早送り）→ 締め。
//
// 実際の画面は、字幕が出ている間を 1 場面として残し、場面と場面の間（字幕の無いつなぎ）は切る。
// 場面の中は、画面がどれだけ動いているかで速さを変える（動いている所は等速、止まっている所ほど速く）。
// 録画は画面が変わったときだけ絵が届くので、絵の届く密度がそのまま「動いている量」になる。
//   node promo/beta-launch/edit.mjs                       （日本語の導入）
//   node promo/beta-launch/edit.mjs --lang en             （英語の導入）
//   node promo/beta-launch/edit.mjs --lang en --intro-only（導入だけの短い動画）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const FPS = 30;
const read = (p) => JSON.parse(fs.readFileSync(path.join(out, p), "utf8"));
const main = read("timeline.json");
const lang = process.argv.includes("--lang") ? process.argv[process.argv.indexOf("--lang") + 1] : "ja";
const suffix = lang === "ja" ? "" : `-${lang}`;
const introOnly = process.argv.includes("--intro-only");

// ── 録画の各区切りを「動画の時刻（元の時間軸）」で扱えるようにする ──
let offset = 0;
const segs = main.segments.map((s) => {
  const seg = { name: s.name, from: offset, to: offset + (s.end - s.start), frames: s.frames.map((f) => ({ file: `frames/${f.file}`, t: offset + (f.at - s.start) })) };
  offset = seg.to;
  return seg;
});
const app = segs.find((s) => s.name === "app");
const end = segs.find((s) => s.name === "end.html");
const frameAt = (seg, t) => {
  let lo = 0;
  let hi = seg.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (seg.frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return seg.frames[lo].file;
};

// ── 場面：字幕が出ている間 ──
const caps = main.events.filter((e) => e.kind === "caption");
const scenes = [];
caps.forEach((e, i) => {
  if (!e.data) return;
  const off = caps.slice(i + 1).find((x) => !x.data);
  scenes.push({ from: e.t - 0.05, to: (off?.t ?? app.to) + 0.05, text: e.data.ja });
});

// ── 動きの量 → 速さ ──
const times = app.frames.map((f) => f.t);
const density = (t) => {
  let n = 0;
  for (const x of times) if (x >= t - 0.125 && x < t + 0.125) n++;
  return n;
};
const rawSpeed = (t) => {
  const n = density(t);
  return n >= 12 ? 1 : n >= 6 ? 1.15 : n >= 2 ? 1.7 : 2.5;
};
// 急に速さが変わらないよう、前後 0.5 秒でならす
const GRID = 0.05;
const speedAt = (() => {
  const cache = new Map();
  return (t) => {
    const key = Math.round(t / GRID);
    if (cache.has(key)) return cache.get(key);
    let sum = 0;
    let n = 0;
    for (let d = -0.5; d <= 0.5; d += GRID) {
      sum += rawSpeed(t + d);
      n++;
    }
    const v = sum / n;
    cache.set(key, v);
    return v;
  };
})();

function runScene(scene, minSeconds) {
  // まず決めた速さで走らせ、短すぎれば全体をゆっくりにする（等速より遅くはしない）
  const speeds = (scale) => (t) => {
    let s = speedAt(t) * scale;
    if (t - scene.from < 0.8) s = Math.min(s, 1.2); // 字幕が入る間は落ち着いて
    return Math.max(1, s);
  };
  const walk = (speed) => {
    const out = [];
    for (let t = scene.from; t < scene.to; t += speed(t) / FPS) out.push(t);
    return out;
  };
  let scale = 1;
  let ts = walk(speeds(scale));
  while (ts.length / FPS < minSeconds && scale > 0.2) {
    scale *= 0.9;
    ts = walk(speeds(scale));
  }
  return ts;
}

// ── 組み立て ──
function build(layout) {
  const intro = read(path.join(`intro-${layout}${suffix}`, "timeline.json"));
  const iseg = intro.segments[0];
  const iFrames = iseg.frames.map((f) => ({ file: `intro-${layout}${suffix}/frames/${f.file}`, t: f.at - iseg.start }));
  const frames = [];
  const cues = [];
  // 1) 導入（等速）
  const introLen = iseg.end - iseg.start;
  for (let i = 0; i < Math.round(introLen * FPS); i++) {
    const t = i / FPS;
    let pick = iFrames[0];
    for (const f of iFrames) if (f.t <= t) pick = f; else break;
    frames.push({ file: pick.file, kind: "intro", t });
  }
  for (const e of intro.events) cues.push({ t: e.t, kind: e.kind });
  // 2) 実際の画面（場面ごと）
  const sceneLog = [];
  (introOnly ? [] : scenes).forEach((scene, i) => {
    const start = frames.length / FPS;
    const ts = runScene(scene, i === 0 ? 2.0 : 2.6);
    for (const t of ts) frames.push({ file: frameAt(app, t), kind: "app", t });
    // 効果音の目印を、編集後の時刻へ移す
    for (const e of main.events) {
      if (!["pop", "click", "whoosh"].includes(e.kind) || e.t < scene.from || e.t >= scene.to) continue;
      const k = ts.findIndex((t) => t >= e.t);
      if (k >= 0) cues.push({ t: Number((start + k / FPS).toFixed(3)), kind: e.kind });
    }
    cues.push({ t: Number(start.toFixed(3)), kind: "cut" });
    sceneLog.push(`${scene.text.slice(0, 10)} ${(scene.to - scene.from).toFixed(1)}s→${(ts.length / FPS).toFixed(1)}s`);
  });
  // 3) 締め（等速）
  const endStart = frames.length / FPS;
  if (!introOnly) for (let i = 0; i < Math.round((end.to - end.from) * FPS); i++) frames.push({ file: frameAt(end, end.from + i / FPS), kind: "end", t: end.from + i / FPS });
  cues.push({ t: Number(endStart.toFixed(3)), kind: "end" });
  const duration = Number((frames.length / FPS).toFixed(3));
  const size = layout === "vertical" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const file = `edit-${introOnly ? "intro-" : ""}${layout}${suffix}.json`;
  fs.writeFileSync(path.join(out, file), JSON.stringify({ fps: FPS, ...size, duration, frames, cues }));
  return { duration, introLen, sceneLog, app: endStart - introLen };
}

for (const layout of ["landscape", "vertical"]) {
  const r = build(layout);
  console.log(`${layout}: ${r.duration.toFixed(1)}s = intro ${r.introLen.toFixed(1)} + app ${r.app.toFixed(1)} + end`);
  if (layout === "landscape") console.log("  " + r.sceneLog.join("\n  "));
}
