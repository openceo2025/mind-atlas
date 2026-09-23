// ページの描画をそのまま JPEG で受け取り、時刻つきで保存する（Chrome DevTools の screencast）。
// 動いていない間は絵が来ないので、つなぐときは「その時刻までで最新の絵」を使う。
import fs from "node:fs";
import path from "node:path";

export class Recorder {
  constructor(outDir) {
    this.outDir = outDir;
    this.framesDir = path.join(outDir, "frames");
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.segments = [];
    this.events = [];
    this.count = 0;
    this.videoTime = 0; // これまでの区切りの長さの合計（秒）
  }

  /** 区切りの録画を始める。止めるまでのページの描画がすべて入る */
  async start(page, name) {
    const cdp = await page.context().newCDPSession(page);
    const segment = { name, frames: [], startedAt: 0, endedAt: 0 };
    const pending = [];
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const file = `f${String(this.count++).padStart(6, "0")}.jpg`;
      segment.frames.push({ file, at: metadata.timestamp });
      pending.push(fs.promises.writeFile(path.join(this.framesDir, file), Buffer.from(data, "base64")));
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    segment.startedAt = Date.now() / 1000;
    this.current = { segment, cdp, pending };
    return segment;
  }

  /** いまの区切りの中での、動画全体の時刻（秒） */
  now() {
    if (!this.current) return this.videoTime;
    return this.videoTime + (Date.now() / 1000 - this.current.segment.startedAt);
  }

  /** 効果音を置く目印（音づくりで使う） */
  mark(kind) {
    this.events.push({ t: Number(this.now().toFixed(3)), kind });
  }

  async stop() {
    const { segment, cdp, pending } = this.current;
    segment.endedAt = Date.now() / 1000;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(pending);
    await cdp.detach().catch(() => {});
    this.videoTime += segment.endedAt - segment.startedAt;
    this.segments.push(segment);
    this.current = null;
    return segment;
  }

  save() {
    const timeline = {
      fps: 30,
      width: 1920,
      height: 1080,
      duration: Number(this.videoTime.toFixed(3)),
      segments: this.segments.map((s) => ({
        name: s.name,
        start: s.startedAt,
        end: s.endedAt,
        frames: s.frames,
      })),
      events: this.events,
    };
    fs.writeFileSync(path.join(this.outDir, "timeline.json"), JSON.stringify(timeline));
    return timeline;
  }
}

/** なめらかに動くカーソル（始めと終わりをゆっくり） */
export function makeHand(page) {
  const pos = { x: 1700, y: 980 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const glide = async (x, y, ms = 650) => {
    const from = { ...pos };
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      await page.waitForTimeout(ms / steps);
    }
    pos.x = x;
    pos.y = y;
  };
  const click = async (x, y, ms) => {
    await glide(x, y, ms);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  };
  const park = async (x, y) => {
    pos.x = x;
    pos.y = y;
    await page.mouse.move(x, y);
  };
  return { glide, click, park, pos };
}
