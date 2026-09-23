// 撮影中のページに差し込む演出：見える矢印カーソル、クリックの波紋、字幕。
// ヘッドレスの Chrome にはマウスカーソルが映らないので、自前で描く。
(() => {
  if (window.__promo) return;
  const css = `
    #promo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none;
      transform: translate(-200px, -200px); transition: transform 0s; filter: drop-shadow(0 3px 6px rgba(0,0,0,.45)); }
    #promo-cursor svg { width: 22px; height: 22px; }
    .toasts { visibility: hidden !important; } /* 字幕と取り合わないよう、通知は映さない */
    .promo-ripple { position: fixed; z-index: 2147483646; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
      border: 3px solid rgba(106, 227, 255, .95); pointer-events: none; animation: promo-ripple .55s ease-out forwards; }
    @keyframes promo-ripple { from { transform: scale(.4); opacity: 1 } to { transform: scale(3.2); opacity: 0 } }
    #promo-caption { position: fixed; left: 50%; bottom: 26px; z-index: 2147483645; pointer-events: none;
      transform: translate(-50%, 24px); opacity: 0; transition: opacity .45s ease, transform .55s cubic-bezier(.2,.8,.2,1);
      display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 13px 30px 12px; border-radius: 16px;
      background: linear-gradient(180deg, rgba(8, 20, 48, .82), rgba(5, 14, 36, .86)); border: 1px solid rgba(106, 190, 255, .38);
      box-shadow: 0 18px 60px rgba(0, 0, 0, .45), 0 0 50px rgba(63, 169, 255, .18); backdrop-filter: blur(14px); }
    #promo-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #promo-caption b { font: 800 34px/1.25 "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif; color: #fff;
      letter-spacing: .02em; white-space: nowrap; text-shadow: 0 2px 18px rgba(63, 169, 255, .35); }
    #promo-caption b em { font-style: normal; color: #6ae3ff; }
    #promo-caption small { font: 600 15px/1.3 "Segoe UI", "Inter", system-ui, sans-serif; color: rgba(200, 225, 255, .78); letter-spacing: .03em; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  const cursor = document.createElement('div');
  cursor.id = 'promo-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 2.5 19.5 13l-7 1.3L9 21.5 4 2.5Z" fill="#fff" stroke="#0b1a33" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const caption = document.createElement('div');
  caption.id = 'promo-caption';
  caption.innerHTML = '<b></b><small></small>';

  const mount = () => {
    if (!document.body) return requestAnimationFrame(mount);
    document.head.appendChild(style);
    document.body.appendChild(cursor);
    document.body.appendChild(caption);
  };
  mount();

  addEventListener('mousemove', (e) => {
    cursor.style.transform = `translate(${e.clientX - 5}px, ${e.clientY - 3}px)`;
  }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.className = 'promo-ripple';
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }, true);

  // 縦版の「どこを映すか」のために、大事な場所（カーソル・窓・操作の輪・選択中や生まれたての
  // カード・範囲選択）を 0.1 秒ごとに記録しておく
  const roi = [];
  let pointer = null;
  addEventListener('mousemove', (e) => { pointer = [e.clientX - 20, e.clientY - 20, 40, 40]; }, true);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return r.width && r.height ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null;
  };
  setInterval(() => {
    const boxes = [];
    if (pointer) boxes.push([...pointer, 'cursor']);
    for (const el of document.querySelectorAll('.fwin')) { const b = rect(el); if (b) boxes.push([...b, 'window']); }
    for (const el of document.querySelectorAll('.radial-ring')) { const b = rect(el); if (b) boxes.push([...b, 'ring']); }
    for (const el of document.querySelectorAll('.marquee')) { const b = rect(el); if (b) boxes.push([...b, 'marquee']); }
    const picked = [...document.querySelectorAll('.card.selected, .card.flash, .card.lifted')].slice(0, 4);
    for (const el of picked) { const b = rect(el); if (b) boxes.push([...b, 'card']); }
    roi.push({ t: Date.now(), boxes });
  }, 100);

  window.__promo = {
    roi,
    /** 字幕を出す。ja の中の【】で囲んだ語は色を変える */
    caption(ja, en) {
      const [b, small] = caption.children;
      b.innerHTML = ja.replace(/【(.+?)】/g, '<em>$1</em>');
      small.textContent = en || '';
      caption.classList.add('on');
    },
    hide() {
      caption.classList.remove('on');
    },
    cursor(show) {
      cursor.style.display = show ? '' : 'none';
    },
  };
})();
