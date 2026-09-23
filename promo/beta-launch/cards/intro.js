// 導入のアニメーション。横（1920×1080）でも縦（1080×1920）でも同じ台本で動く。
//
//   1) AIをフル活用している人ほど      … AI への依頼がどんどん積み上がる
//   2) 認知と判断で、脳機能の消耗が激しい … 画面があふれ、思考の余力が減っていく
//   3) AI時代の、新しい思考整理ツール    … 混沌が点に縮み、X/Y/Z の軸にそって整列する
//   4) マインドアトラス                   … 名前。最後に光の輪が広がって実際の画面へ
//
// 時刻はすべて startIntro() からの経過秒で決まるので、何度撮っても同じ動きになる。
(() => {
  const W = innerWidth;
  const H = innerHeight;
  const portrait = H > W;
  const S = Math.min(W, H) / 1080;
  const root = document.documentElement.style;
  root.setProperty('--size', `${(portrait ? 86 : 90) * S}px`);
  root.setProperty('--name', `${(portrait ? 108 : 150) * S}px`);
  root.setProperty('--brand', `${(portrait ? 56 : 60) * S}px`);
  root.setProperty('--meter', `${(portrait ? 760 : 820) * S}px`);

  // 音づくり（music.py）と合わせる区切り
  const B = { ai: 0.45, drain: 3.9, collapse: 7.55, order: 8.15, name: 11.7, out: 14.55, end: 15.3 };
  window.INTRO = { beats: B, duration: B.end };

  const $ = (id) => document.getElementById(id);
  const br = portrait ? '<br>' : '';
  $('l1').innerHTML = `AIを<em>フル活用</em>${br}している人ほど`;
  $('l2').innerHTML = `認知と判断で、<br>脳機能の<em class="warn">消耗</em>が激しい。`;
  $('l3').innerHTML = `AI時代の、<br>新しい<em>思考整理</em>ツール`;

  const canvas = $('fx');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── 道具 ──────────────────────────────────────────────
  let seed = 7;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (v) => 1 - Math.pow(1 - clamp(v), 3);
  const easeIn = (v) => Math.pow(clamp(v), 2);
  const mix = (a, b, k) => a + (b - a) * k;
  const rgb = (a, b, k) => `rgb(${Math.round(mix(a[0], b[0], k))},${Math.round(mix(a[1], b[1], k))},${Math.round(mix(a[2], b[2], k))})`;
  function round(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ── 1〜2) AI への依頼の吹き出し ─────────────────────────
  const PROMPTS = ['要約して', '比較して', '次の案は？', 'レビューお願い', '英訳して', '表にまとめて', 'メールの下書き', '議事録を作って', 'コードを直して',
    'もっと短く', '根拠は？', '別の視点で', '企画のたたき台', '市場を調べて', 'リスクを洗い出して', 'やっぱり元に戻して', 'A案とB案どっち？', 'ToDoにして',
    'グラフにして', '要点だけ', 'もう一度考えて', 'さっきの続き', '反論を出して', '優先順位は？', '数字で示して', '言い換えて'];
  const FONT = `700 ${Math.round(30 * S)}px "Yu Gothic UI", "Meiryo", sans-serif`;
  ctx.font = FONT;
  const bubbles = [];
  let spawned = 0;
  const rate = (t) => (t < B.ai ? 0 : t < B.drain ? 3 + ((t - B.ai) / (B.drain - B.ai)) * 9 : t < B.collapse ? 12 + ((t - B.drain) / (B.collapse - B.drain)) * 26 : 0);
  const quiet = portrait ? [0.36 * H, 0.66 * H] : [0.33 * H, 0.67 * H]; // 言葉の帯には、はじめは出さない
  function spawn(t) {
    const text = PROMPTS[Math.floor(rnd() * PROMPTS.length)];
    const w = ctx.measureText(text).width + 50 * S;
    const h = 60 * S;
    const crowded = t > B.drain + 1.3;
    let y = rnd() * (H - h);
    if (!crowded) {
      const band = rnd() < 0.5 ? [0.04 * H, quiet[0] - h] : [quiet[1], 0.96 * H - h];
      y = mix(band[0], band[1], rnd());
    }
    bubbles.push({ text, w, h, x: rnd() * (W - w), y, vx: (rnd() - 0.5) * 22 * S, vy: (rnd() - 0.5) * 16 * S, born: t, seed: rnd() * 100 });
    if (bubbles.length > 240) bubbles.shift();
  }

  // ── 3) 整列：軸と、並んだカード ─────────────────────────
  const area = portrait
    ? { x1: 0.12 * W, x2: 0.9 * W, y1: 0.16 * H, y2: 0.6 * H }
    : { x1: 0.2 * W, x2: 0.8 * W, y1: 0.1 * H, y2: 0.6 * H };
  const origin = { x: area.x1, y: area.y2 };
  const cols = portrait ? 5 : 7;
  const rows = portrait ? 6 : 4;
  const COLORS = ['#3fa9ff', '#2fd08a', '#a98bff', '#ff9f43', '#ff5d73', '#6ae3ff'];
  const cards = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const depth = rnd();
      const k = (1.08 - depth * 0.32) * (portrait ? 1.35 : 1); // 奥ほど小さく（縦は画面に対して大きめに）
      const gx = mix(area.x1 + 90 * S, area.x2 - 60 * S, (c + 0.5) / cols) + (rnd() - 0.5) * 30 * S + depth * 34 * S;
      const gy = mix(area.y1 + 30 * S, area.y2 - 60 * S, (r + 0.5) / rows) + (rnd() - 0.5) * 22 * S - depth * 22 * S;
      cards.push({ x: gx, y: gy, k, depth, color: COLORS[Math.floor(rnd() * COLORS.length)], delay: rnd() * 0.7 });
    }
  }
  cards.sort((a, b) => b.depth - a.depth); // 奥から描く

  function drawCard(c, x, y, scale, alpha) {
    const w = 118 * S * c.k * scale;
    const h = 50 * S * c.k * scale;
    if (w < 1) return;
    ctx.globalAlpha = alpha;
    round(x - w / 2, y - h / 2, w, h, 8 * S * c.k);
    ctx.fillStyle = 'rgba(14,32,70,.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(106,190,255,.55)';
    ctx.lineWidth = 1.2 * S;
    ctx.stroke();
    const s = h * 0.56;
    round(x - w / 2 + h * 0.2, y - s / 2, s, s, 4 * S);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.fillStyle = 'rgba(220,235,255,.8)';
    ctx.fillRect(x - w / 2 + h * 0.2 + s + 8 * S, y - h * 0.18, w * 0.42, h * 0.12);
    ctx.fillStyle = 'rgba(170,200,240,.45)';
    ctx.fillRect(x - w / 2 + h * 0.2 + s + 8 * S, y + h * 0.08, w * 0.3, h * 0.1);
    ctx.globalAlpha = 1;
  }

  function drawAxes(p, alpha) {
    if (p <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#6ae3ff';
    ctx.fillStyle = '#6ae3ff';
    ctx.lineWidth = 3 * S;
    ctx.shadowColor = 'rgba(106,227,255,.8)';
    ctx.shadowBlur = 14 * S;
    const ends = [
      { x: area.x2 + 30 * S, y: origin.y, label: 'X' },
      { x: origin.x, y: area.y1 - 30 * S, label: 'Y' },
      { x: origin.x + (area.x2 - area.x1) * 0.42, y: origin.y - (area.y2 - area.y1) * 0.9, label: 'Z' },
    ];
    ends.forEach((e, i) => {
      const k = ease((p - i * 0.12) / 0.7);
      if (k <= 0) return;
      const x = mix(origin.x, e.x, k);
      const y = mix(origin.y, e.y, k);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      const a = Math.atan2(y - origin.y, x - origin.x);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 14 * S, y + Math.sin(a) * 14 * S);
      ctx.lineTo(x + Math.cos(a + 2.5) * 14 * S, y + Math.sin(a + 2.5) * 14 * S);
      ctx.lineTo(x + Math.cos(a - 2.5) * 14 * S, y + Math.sin(a - 2.5) * 14 * S);
      ctx.fill();
      if (k > 0.95) {
        ctx.font = `800 ${Math.round(30 * S)}px "Segoe UI", sans-serif`;
        ctx.fillText(e.label, x + Math.cos(a) * 30 * S - 8 * S, y + Math.sin(a) * 30 * S + 10 * S);
      }
    });
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 6 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.font = FONT;
  }

  // ── 言葉 ─────────────────────────────────────────────
  function line(el, tIn, tOut, t, extra = '') {
    const a = clamp((t - tIn) / 0.5);
    const b = clamp((t - tOut) / 0.35);
    const k = ease(a);
    el.style.opacity = String(k * (1 - b));
    el.style.filter = `blur(${(1 - k) * 10 + b * 8}px)`;
    el.style.transform = `translateY(calc(-50% + ${(1 - k) * 28 - b * 16}px)) ${extra}`;
  }

  // ── 絵を描く ──────────────────────────────────────────
  let t0 = null;
  let last = 0;
  let collapsed = null;
  function frame(now) {
    const t = t0 === null ? 0 : (now - t0) / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;

    // 吹き出しを出す
    if (t0 !== null && t < B.collapse) {
      spawned += rate(t) * dt;
      while (spawned >= 1) {
        spawn(t);
        spawned -= 1;
      }
    }

    // 背景：あふれるほど暗く、赤みを帯び、わずかに揺れる
    const strain = clamp((t - B.drain) / (B.collapse - B.drain));
    const calm = clamp((t - B.order) / 1.2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#040b1a';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.6, H * 0.45, 0, W * 0.6, H * 0.45, Math.max(W, H) * 0.7);
    glow.addColorStop(0, strain > 0 && calm === 0 ? `rgba(${Math.round(mix(24, 90, strain))},${Math.round(mix(70, 30, strain))},${Math.round(mix(150, 50, strain))},.45)` : 'rgba(24,70,150,.4)');
    glow.addColorStop(1, 'rgba(4,11,26,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90,150,255,.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 60 * S) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 60 * S) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const shake = t < B.collapse ? easeIn(strain) * 5 * S : 0;
    ctx.setTransform(1, 0, 0, 1, (rnd() - 0.5) * shake, (rnd() - 0.5) * shake);

    // 1〜2) 吹き出し
    if (t < B.collapse) {
      ctx.font = FONT;
      for (const b of bubbles) {
        const age = t - b.born;
        const jit = strain * 6 * S;
        const x = b.x + b.vx * age + Math.sin(t * 21 + b.seed) * jit;
        const y = b.y + b.vy * age + Math.cos(t * 17 + b.seed) * jit;
        ctx.globalAlpha = clamp(age / 0.25) * 0.92;
        round(x, y, b.w, b.h, b.h / 2);
        ctx.fillStyle = rgb([20, 44, 90], [70, 22, 30], strain);
        ctx.fill();
        ctx.strokeStyle = rgb([106, 190, 255], [255, 110, 80], strain);
        ctx.lineWidth = 1.5 * S;
        ctx.stroke();
        ctx.fillStyle = rgb([106, 227, 255], [255, 150, 110], strain);
        ctx.beginPath();
        ctx.arc(x + 22 * S, y + b.h / 2, 6 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#eef5ff';
        ctx.fillText(b.text, x + 36 * S, y + b.h / 2 + 10 * S);
      }
      ctx.globalAlpha = 1;
      // 周りから暗くなる
      if (strain > 0) {
        const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, `rgba(0,0,0,${0.55 * strain})`);
        ctx.fillStyle = v;
        ctx.fillRect(-20, -20, W + 40, H + 40);
      }
    }

    // 3) 縮んで点になり、軸にそって整列する
    if (t >= B.collapse && t < B.out + 0.2) {
      if (!collapsed) {
        // 最後に出ていた吹き出しを、並べるカードの数だけ選んで出発点にする
        const recent = bubbles.slice(-cards.length);
        collapsed = cards.map((c, i) => {
          const b = recent[i % Math.max(1, recent.length)];
          const age = B.collapse - (b?.born ?? B.collapse);
          return b ? { x: b.x + b.vx * age + b.w / 2, y: b.y + b.vy * age + b.h / 2 } : { x: W / 2, y: H / 2 };
        });
      }
      const shrink = ease((t - B.collapse) / 0.5);
      const nameDim = t > B.name ? 1 - 0.75 * ease((t - B.name) / 0.8) : 1;
      const zoom = t > B.name ? 1 + 0.08 * ((t - B.name) / (B.out - B.name)) : 1;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H / 2);
      drawAxes(clamp((t - B.order - 0.15) / 1.1), nameDim);
      cards.forEach((c, i) => {
        const from = collapsed[i];
        const fly = ease((t - B.order - c.delay * 0.6) / 0.9);
        const x = mix(from.x, c.x, fly);
        const y = mix(from.y, c.y, fly);
        if (fly <= 0) {
          // まだ点のまま（吹き出しが縮んでいく）
          ctx.globalAlpha = 0.9 * nameDim;
          ctx.fillStyle = '#6ae3ff';
          ctx.beginPath();
          ctx.arc(x, y, mix(10, 4, shrink) * S, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          return;
        }
        const grow = ease((t - B.order - c.delay * 0.6 - 0.7) / 0.4);
        if (grow <= 0) {
          ctx.globalAlpha = nameDim;
          ctx.fillStyle = '#6ae3ff';
          ctx.shadowColor = '#6ae3ff';
          ctx.shadowBlur = 12 * S;
          ctx.beginPath();
          ctx.arc(x, y, 4 * S, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        } else {
          drawCard(c, x, y, grow, nameDim * (0.55 + 0.45 * (1 - c.depth)));
        }
      });
      ctx.restore();
      // 集まっていた吹き出しが消えていく名残
      if (t < B.collapse + 0.5) {
        ctx.globalAlpha = 1 - shrink;
        for (const b of bubbles.slice(0, -cards.length)) {
          const age = B.collapse - b.born;
          ctx.fillStyle = 'rgba(255,120,90,.5)';
          ctx.beginPath();
          ctx.arc(b.x + b.vx * age + b.w / 2, b.y + b.vy * age + b.h / 2, mix(8, 1, shrink) * S, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // 4) 名前の上の光の玉。最後に広がって、実際の画面へつなぐ
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const orbY = portrait ? H * 0.5 - 250 * S : H * 0.5 - 205 * S;
    if (t >= B.name - 0.1) {
      const k = ease((t - B.name + 0.1) / 0.8);
      const pulse = 1 + Math.sin((t - B.name) * 4) * 0.04;
      const out = ease((t - B.out) / (B.end - B.out - 0.15));
      const r = t < B.out ? 46 * S * k * pulse : mix(46 * S, Math.hypot(W, H), out);
      const g = ctx.createRadialGradient(W / 2 - r * 0.3, orbY - r * 0.35, r * 0.05, W / 2, orbY, r);
      // 広がりきったときに、実際の画面と同じ夜空の色で終わるようにする
      const fade = t < B.out ? 0 : out;
      g.addColorStop(0, rgb([159, 231, 255], [4, 11, 26], fade));
      g.addColorStop(0.55, rgb([42, 123, 255], [4, 11, 26], fade));
      g.addColorStop(1, rgb([10, 42, 102], [4, 11, 26], fade));
      ctx.shadowColor = 'rgba(63,169,255,.9)';
      ctx.shadowBlur = 60 * S * (1 - out);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(W / 2, t < B.out ? orbY : mix(orbY, H / 2, out), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (t >= B.out) {
        ctx.strokeStyle = `rgba(106,227,255,${0.9 * (1 - out)})`;
        ctx.lineWidth = 6 * S * (1 - out) + 1;
        ctx.stroke();
      }
    }

    // 言葉と、思考の余力
    line($('l1'), B.ai, B.drain - 0.35, t);
    const shiver = t > B.drain + 1.8 && t < B.collapse ? `translateX(${(rnd() - 0.5) * 6 * strain * S}px)` : '';
    line($('l2'), B.drain, B.collapse - 0.1, t, shiver);
    const l3 = $('l3');
    l3.style.top = portrait ? '76%' : '79%';
    line(l3, B.order + 0.2, B.name - 0.35, t);
    const name = $('l4');
    const nk = ease((t - B.name) / 0.7);
    const nOut = ease((t - B.out) / 0.3);
    name.style.opacity = String(nk * (1 - nOut));
    name.style.letterSpacing = `${mix(0.3, 0.08, nk)}em`;
    name.style.filter = `blur(${(1 - nk) * 12}px) drop-shadow(0 6px 36px rgba(63,169,255,.55))`;
    name.style.transform = `translateY(-50%) scale(${mix(1.08, 1, nk)})`;
    const brand = $('brand');
    const bk = ease((t - B.name - 0.65) / 0.6);
    brand.style.opacity = String(bk * (1 - nOut));
    brand.style.top = `${H * 0.5 + (portrait ? 120 : 130) * S}px`;
    brand.style.transform = `translateY(${(1 - bk) * 20}px)`;
    const meter = $('meter');
    const mk = clamp((t - B.drain - 0.3) / 0.4) * (1 - clamp((t - B.collapse + 0.2) / 0.3));
    meter.style.opacity = String(mk);
    meter.style.top = `${H * 0.5 + (portrait ? 190 : 170) * S}px`;
    const left = Math.round(mix(100, 8, easeIn((t - B.drain - 0.3) / (B.collapse - B.drain - 0.5))));
    $('pct').textContent = `${left}%`;
    const hue = mix(190, 6, clamp((100 - left) / 92));
    $('fill').style.width = `${left}%`;
    $('fill').style.background = `linear-gradient(90deg, hsl(${hue} 90% 55%), hsl(${hue + 12} 95% 62%))`;
    $('pct').style.color = `hsl(${hue} 95% 70%)`;

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.startIntro = () => {
    t0 = performance.now();
    last = 0;
  };
})();
