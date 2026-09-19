// カードの「物理感」を担う軽量バネエンジン。
// React の再レンダリングを経由せず、毎フレーム購読者に通知して DOM を直接更新する。

export type MotionMode = 'drag' | 'layout' | 'soft' | 'instant';

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  s: number;
  vs: number;
  ts: number;
  lift: number; // 0..1 つかんでいる度合い
  tlift: number;
  mode: MotionMode;
  pending?: { at: number; x: number; y: number; s: number; mode: MotionMode };
}

const SPRING: Record<MotionMode, { k: number; c: number }> = {
  drag: { k: 700, c: 42 },
  layout: { k: 52, c: 12.5 },
  soft: { k: 150, c: 22 },
  instant: { k: 0, c: 0 },
};

type Listener = () => void;

class Engine {
  bodies = new Map<string, Body>();
  private listeners = new Set<Listener>();
  private raf = 0;
  private timer = 0;
  private scheduled = false;
  private last = 0;

  get(id: string) {
    return this.bodies.get(id);
  }

  place(id: string, x: number, y: number, s = 1) {
    const b = this.bodies.get(id);
    if (b) {
      Object.assign(b, { x, y, tx: x, ty: y, vx: 0, vy: 0, s, ts: s, vs: 0, pending: undefined });
    } else {
      this.bodies.set(id, { x, y, tx: x, ty: y, vx: 0, vy: 0, s, ts: s, vs: 0, lift: 0, tlift: 0, mode: 'soft' });
    }
    this.kick();
  }

  setTarget(id: string, x: number, y: number, s: number, mode: MotionMode, delay = 0) {
    const b = this.bodies.get(id);
    if (!b) return this.place(id, x, y, s);
    if (mode === 'instant') return this.place(id, x, y, s);
    if (delay > 0) {
      b.pending = { at: performance.now() + delay, x, y, s, mode };
    } else {
      b.pending = undefined;
      Object.assign(b, { tx: x, ty: y, ts: s, mode });
    }
    this.kick();
  }

  setLift(id: string, on: boolean) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.tlift = on ? 1 : 0;
    this.kick();
  }

  remove(id: string) {
    this.bodies.delete(id);
  }

  /** スペースを切り替えるときに全て捨てる */
  clear() {
    this.bodies.clear();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn();
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** 購読者に即時通知（カメラ変更時など） */
  notify() {
    this.listeners.forEach((l) => l());
  }

  private kick() {
    if (this.scheduled) return;
    this.last = performance.now();
    this.schedule();
  }

  // 描画されない状態（非表示タブなど）では rAF が止まるので、タイマーでも進める
  private schedule() {
    this.scheduled = true;
    this.raf = requestAnimationFrame(this.tick);
    this.timer = window.setTimeout(() => this.tick(performance.now()), 80);
  }

  private tick = (now: number) => {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.scheduled = false;
    // rAF のタイムスタンプは kick 時の performance.now() より前になりうる
    const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.1));
    this.last = now;
    let active = false;
    const steps = Math.max(1, Math.ceil(dt * 180));
    const h = dt / steps;
    for (const b of this.bodies.values()) {
      if (b.pending) {
        active = true;
        if (now >= b.pending.at) {
          Object.assign(b, { tx: b.pending.x, ty: b.pending.y, ts: b.pending.s, mode: b.pending.mode });
          b.pending = undefined;
        }
      }
      const { k, c } = SPRING[b.mode];
      for (let i = 0; i < steps; i++) {
        b.vx += (k * (b.tx - b.x) - c * b.vx) * h;
        b.vy += (k * (b.ty - b.y) - c * b.vy) * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.vs += (180 * (b.ts - b.s) - 24 * b.vs) * h;
        b.s += b.vs * h;
      }
      b.lift += (b.tlift - b.lift) * Math.min(1, dt * 14);
      const moving =
        Math.abs(b.tx - b.x) > 0.3 ||
        Math.abs(b.ty - b.y) > 0.3 ||
        Math.abs(b.vx) > 0.5 ||
        Math.abs(b.vy) > 0.5 ||
        Math.abs(b.ts - b.s) > 0.002 ||
        Math.abs(b.tlift - b.lift) > 0.01;
      if (moving) active = true;
      else {
        b.x = b.tx;
        b.y = b.ty;
        b.vx = b.vy = 0;
        b.s = b.ts;
      }
    }
    this.listeners.forEach((l) => l());
    if (active) this.schedule();
  };
}

export const engine = new Engine();
