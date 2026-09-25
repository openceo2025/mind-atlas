import type { ReactNode } from 'react';
import type { Card } from '../types';

const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h14V9" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  sparkle: <path d="M12 2.5c.6 4.8 2.7 6.9 7.5 7.5-4.8.6-6.9 2.7-7.5 7.5-.6-4.8-2.7-6.9-7.5-7.5 4.8-.6 6.9-2.7 7.5-7.5Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  ascend: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M6 20.5a6 6 0 0 1 3.2-5.3M18 20.5a6 6 0 0 0-3.2-5.3" />
      <path d="M12 16.5V3.5M8 7.5l4-4 4 4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="5" rx="1" />
      <path d="M5 9v10.5h14V9M10 13h4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  share: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M17 8h5M19.5 5.5v5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" />
    </>
  ),
  pin: <path d="M14.5 3.5 20.5 9.5l-3 1-4 4 .5 4-2 1-8-8 1-2 4 .5 4-4 1-3ZM8 16l-4.5 4.5" />,
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  summary: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  childCard: (
    <>
      <rect x="2.5" y="4" width="9" height="7" rx="1.6" />
      <rect x="12.5" y="13" width="9" height="7" rx="1.6" />
      <path d="M7 11v3.5A2 2 0 0 0 9 16.5h3.5" />
    </>
  ),
  expand: <path d="M12 12 5 5M12 12l7-7M12 12l-7 7M12 12l7 7M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />,
  organize: (
    <>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="7" r="2.5" />
      <circle cx="7" cy="17" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.8 20 7.3v9.4l-8 4.5-8-4.5V7.3l8-4.5Z" />
      <path d="M4 7.3l8 4.5 8-4.5M12 11.8v9.4" />
    </>
  ),
  bundle: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M7 8V5.5h10V8M9 12.5h6" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  chevronR: <path d="m9 5 7 7-7 7" />,
  chevronD: <path d="m5 9 7 7 7-7" />,
  arrowR: <path d="M4 12h15m-5-5 5 5-5 5" />,
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  axis: <path d="M5 19V4M5 19h15M5 19l9-6M3 6l2-2 2 2M18 17l2 2-2 2" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  shelf: <path d="M3 15h18v5H3zM6 15V9h4v6M12 15V6h4v9" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  chat: <path d="M4 5.5h16v10H9l-5 4v-14Z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5s-1.2 5.9-3.7 8.5c-2.5-2.6-3.7-5.4-3.7-8.5S9.5 6.1 12 3.5Z" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" />
    </>
  ),
  cloud: <path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.3 1.7A3.7 3.7 0 0 1 17.5 18.5H7Z" />,
  cloudOff: <path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.3 1.7A3.7 3.7 0 0 1 17.5 18.5H7ZM4 4l16 16" />,
  edit: <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3ZM13.5 7.5l3 3" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </>
  ),
  download: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9m-5 5 5-5 5 5M5 4h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  lang: <path d="M4 5h8M8 3v2m2.5 0c-.5 4-3 7-6.5 8.5M6 9c1 2 2.8 3.4 5 4.2M13 21l4-10 4 10M14.3 18h5.4" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  logout: <path d="M14 4.5H6.5v15H14M10 12h10m-3.5-3.5L20 12l-3.5 3.5" />,
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V4.5a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 6.5-6 6.5-2.4 0-4-1.2-5.2-3.2L4 13.8a1.5 1.5 0 0 1 2.6-1.5L8 14" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  play: <path d="M7 5v14l12-7L7 5Z" />,
  send: <path d="M4 12 20 4l-6 16-3-7-7-1Z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5v.4M12 16.5v.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.5" />
    </>
  ),
};

export function Icon({ name, size = 18, stroke = 1.7 }: { name: keyof typeof P | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name]}
    </svg>
  );
}

// ── 種別アイコン ───────────────────────────────────────
const KIND_STYLE: Record<string, { bg: string; label: string }> = {
  document: { bg: 'linear-gradient(160deg,#f4f7fc,#cfd9ea)', label: 'DOC' },
  article: { bg: 'linear-gradient(160deg,#f4f7fc,#cfd9ea)', label: 'NEWS' },
  image: { bg: 'linear-gradient(160deg,#3f8cff,#2a5cc9)', label: 'IMG' },
  dataset: { bg: 'linear-gradient(160deg,#27d0a0,#119272)', label: 'CSV' },
  company: { bg: 'linear-gradient(160deg,#27d0a0,#0f8f8a)', label: 'G' },
  person: { bg: 'linear-gradient(160deg,#2b6fff,#34c3ff)', label: '' },
  summary: { bg: 'linear-gradient(160deg,#1e6cff,#35c6ff)', label: 'AI' },
  idea: { bg: 'linear-gradient(160deg,#ffc15c,#e98a1c)', label: '案' },
  hypothesis: { bg: 'linear-gradient(160deg,#b598ff,#7a55e8)', label: '仮説' },
  issue: { bg: 'linear-gradient(160deg,#ff8a7a,#e04a5c)', label: '課題' },
  quote: { bg: 'linear-gradient(160deg,#4fd8ff,#1b8fc4)', label: '“ ”' },
  group: { bg: 'linear-gradient(160deg,#ffc15c,#e98a1c)', label: '' },
  concept: { bg: 'linear-gradient(160deg,#ffd166,#d69a1a)', label: '軸' },
  topic: { bg: 'linear-gradient(160deg,#1e6cff,#35c6ff)', label: '' },
  note: { bg: 'linear-gradient(160deg,#5b7cff,#3a4fc9)', label: '' },
  link: { bg: 'linear-gradient(160deg,#4fd8ff,#2a7bff)', label: '' },
};

const FORMAT_COLOR: Record<string, string> = {
  PDF: '#e5484d',
  NEWS: '#e5484d',
  DOC: '#2f7cf6',
  NOTE: '#e98a1c',
  WEB: '#2f7cf6',
  SHEET: '#119272',
};

export function KindIcon({ card }: { card: Card }) {
  const st = KIND_STYLE[card.kind] ?? KIND_STYLE.document;
  const paper = card.kind === 'document' || card.kind === 'article';
  const label = st.label;
  if (card.kind === 'company') {
    return (
      <div className="kind-icon" style={{ background: st.bg, borderRadius: '50%', width: 44, height: 44, alignSelf: 'center', fontSize: 22 }}>
        {card.title.charAt(0)}
      </div>
    );
  }
  if (card.kind === 'person') {
    return (
      <div className="kind-icon" style={{ background: st.bg, borderRadius: '50%', width: 36, height: 36, alignSelf: 'center', fontSize: 14 }}>
        {card.title.charAt(0)}
      </div>
    );
  }
  if (card.kind === 'group') {
    return (
      <div className="kind-icon" style={{ background: st.bg }}>
        <Icon name="bundle" size={22} />
      </div>
    );
  }
  if (card.kind === 'note' || card.kind === 'link' || card.kind === 'image') {
    return (
      <div className="kind-icon" style={{ background: st.bg }}>
        <Icon name={card.kind === 'note' ? 'edit' : card.kind === 'link' ? 'link' : 'image'} size={20} />
      </div>
    );
  }
  if (card.kind === 'summary') {
    return (
      <div className="kind-icon" style={{ background: st.bg }}>
        <Icon name="sparkle" size={22} />
      </div>
    );
  }
  return (
    <div className="kind-icon" style={{ background: st.bg, color: paper ? FORMAT_COLOR[label] ?? '#2f7cf6' : '#fff' }}>
      {paper && (
        <svg width="30" height="30" viewBox="0 0 30 30" style={{ position: 'absolute', top: 6 }}>
          <rect x="4" y="3" width="22" height="3" rx="1" fill="currentColor" opacity="0.9" />
          <rect x="4" y="10" width="16" height="2" rx="1" fill="#8a9ab5" />
          <rect x="4" y="15" width="20" height="2" rx="1" fill="#8a9ab5" />
          <rect x="4" y="20" width="12" height="2" rx="1" fill="#8a9ab5" />
        </svg>
      )}
      <span style={{ position: paper ? 'absolute' : 'static', bottom: 4, fontSize: label.length > 3 ? 8 : 10 }}>{label}</span>
    </div>
  );
}

// ── サムネイル（写真の代わりに描画） ───────────────────────
export function Visual({ kind, id }: { kind: NonNullable<Card['visual']>; id: string }) {
  const g = `g-${id}`;
  if (kind === 'wind') {
    return (
      <svg width="100%" height="100%" viewBox="0 0 220 150" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b2d5c" />
            <stop offset="0.5" stopColor="#c46a4a" />
            <stop offset="0.62" stopColor="#f2a65a" />
            <stop offset="0.63" stopColor="#23385e" />
            <stop offset="1" stopColor="#0b1830" />
          </linearGradient>
        </defs>
        <rect width="220" height="150" fill={`url(#${g})`} />
        <circle cx="150" cy="90" r="10" fill="#ffd9a0" opacity="0.9" />
        {[
          [40, 40, 1],
          [95, 58, 0.75],
          [135, 66, 0.55],
          [175, 70, 0.45],
          [70, 64, 0.6],
        ].map(([x, top, s], i) => (
          <g key={i} stroke="#0b1226" strokeWidth={2.2 * s} strokeLinecap="round">
            <line x1={x} y1={top} x2={x} y2={94} />
            <line x1={x} y1={top} x2={x - 16 * s} y2={top - 14 * s} />
            <line x1={x} y1={top} x2={x + 20 * s} y2={top - 4 * s} />
            <line x1={x} y1={top} x2={x - 3 * s} y2={top + 20 * s} />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === 'solar') {
    return (
      <svg width="100%" height="100%" viewBox="0 0 220 150" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c7be5" />
            <stop offset="0.5" stopColor="#9fd0ff" />
            <stop offset="0.5" stopColor="#1a3d7a" />
            <stop offset="1" stopColor="#0a1a3a" />
          </linearGradient>
        </defs>
        <rect width="220" height="150" fill={`url(#${g})`} />
        {[0, 1, 2, 3].map((r) =>
          Array.from({ length: 7 }).map((_, c) => (
            <polygon
              key={`${r}-${c}`}
              points={`${-20 + c * 38 + r * 10},${82 + r * 17} ${14 + c * 38 + r * 10},${82 + r * 17} ${20 + c * 38 + r * 12},${94 + r * 17} ${-14 + c * 38 + r * 12},${94 + r * 17}`}
              fill="#2a64c8"
              stroke="#8cc4ff"
              strokeWidth="0.8"
            />
          )),
        )}
      </svg>
    );
  }
  if (kind === 'earth') {
    return (
      <svg width="100%" height="100%" viewBox="0 0 250 204" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={g} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#4aa3ff" />
            <stop offset="0.55" stopColor="#1650b8" />
            <stop offset="1" stopColor="#061a44" />
          </radialGradient>
          <radialGradient id={`${g}h`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.8" stopColor="#6ae3ff" stopOpacity="0" />
            <stop offset="0.92" stopColor="#6ae3ff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#6ae3ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="250" height="204" fill="#030a1c" />
        {Array.from({ length: 30 }).map((_, i) => (
          <circle key={i} cx={(i * 83) % 250} cy={(i * 47) % 110} r={i % 3 ? 0.6 : 1} fill="#cfe3ff" opacity="0.6" />
        ))}
        <circle cx="125" cy="118" r="98" fill={`url(#${g})`} />
        <path d="M60 95c18-20 40-18 52-6s6 26 22 30 26-10 38-2 8 26-6 34-40 4-52 12-34-6-44-22-24-28-10-46Z" fill="#3fae6a" opacity="0.55" />
        <path d="M150 60c14-6 34 2 40 16s-8 18-20 14-30-22-20-30Z" fill="#3fae6a" opacity="0.5" />
        <circle cx="125" cy="118" r="108" fill={`url(#${g}h)`} />
      </svg>
    );
  }
  if (kind === 'battery') {
    return (
      <svg width="100%" height="100%" viewBox="0 0 60 60">
        <defs>
          <radialGradient id={g}>
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.25" stopColor="#6ae3ff" />
            <stop offset="1" stopColor="#0a2a66" />
          </radialGradient>
        </defs>
        <rect width="60" height="60" fill={`url(#${g})`} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <line key={i} x1={30} y1={30} x2={30 + Math.cos(a) * 28} y2={30 + Math.sin(a) * 28} stroke="#bff3ff" strokeWidth="0.8" opacity="0.7" />;
        })}
      </svg>
    );
  }
  // chart
  return (
    <svg width="100%" height="100%" viewBox="0 0 120 40" preserveAspectRatio="none">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3fa9ff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#3fa9ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 34 L12 30 L24 32 L36 24 L48 26 L60 18 L72 20 L84 12 L96 14 L108 6 L120 4 L120 40 L0 40Z" fill={`url(#${g})`} />
      <path d="M0 34 L12 30 L24 32 L36 24 L48 26 L60 18 L72 20 L84 12 L96 14 L108 6 L120 4" fill="none" stroke="#6ae3ff" strokeWidth="1.5" />
    </svg>
  );
}
