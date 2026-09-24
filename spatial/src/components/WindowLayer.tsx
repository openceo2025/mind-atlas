import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore, windowScreenPos, closeWindow, focusWindow, moveWindow, togglePin, worldToScreen, lookup } from '../store';
import { engine } from '../lib/physics';
import { overNav } from '../lib/drag';
import { cardSize } from '../lib/semantic';
import type { FloatWin, WindowType } from '../types';
import { t, type MessageKey } from '../i18n';
import { Icon } from './Icons';
import { SummaryWindow } from './windows/SummaryWindow';
import { ExtractWindow } from './windows/ExtractWindow';
import { AxisWindow } from './windows/AxisWindow';
import { PreviewWindow } from './windows/PreviewWindow';
import { DetailWindow } from './windows/DetailWindow';
import { ClusterWindow } from './windows/ClusterWindow';
import { RelationsWindow } from './windows/RelationsWindow';
import { RelationWindow } from './windows/RelationWindow';
import { ChatWindow } from './windows/ChatWindow';
import { SearchWindow } from './windows/SearchWindow';
import { VoiceWindow } from './windows/VoiceWindow';
import { AccountWindow } from './windows/AccountWindow';
import { ShareWindow } from './windows/ShareWindow';
import { SpacesWindow } from './windows/SpacesWindow';
import { HelpWindow } from './windows/HelpWindow';
import { SettingsWindow } from './windows/SettingsWindow';
import { AgentWindowSlot } from './windows/AgentWindowSlot';

const META: Record<WindowType, { icon: string }> = {
  summary: { icon: 'sparkle' },
  extract: { icon: 'extract' },
  axis: { icon: 'axis' },
  preview: { icon: 'cube' },
  detail: { icon: 'info' },
  cluster: { icon: 'organize' },
  relations: { icon: 'link' },
  relation: { icon: 'link' },
  chat: { icon: 'chat' },
  search: { icon: 'globe' },
  voice: { icon: 'mic' },
  agent: { icon: 'terminal' },
  account: { icon: 'user' },
  share: { icon: 'share' },
  spaces: { icon: 'layers' },
  help: { icon: 'help' },
  settings: { icon: 'settings' },
};

// 発生源のカードと結ぶ引き出し線を描かないウィンドウ
const NO_LEADER: WindowType[] = ['axis', 'preview', 'cluster', 'account', 'share', 'spaces', 'help', 'settings', 'voice', 'agent', 'search'];

export function WindowLayer() {
  const windows = useStore((s) => s.windows);
  useStore((s) => s.camera); // カメラに追従して再描画
  const elRefs = useRef(new Map<string, HTMLDivElement>());
  const lineRefs = useRef(new Map<string, SVGGElement>());
  const latest = useRef(windows);
  latest.current = windows;

  useEffect(
    () =>
      engine.subscribe(() => {
        for (const w of latest.current) {
          const g = lineRefs.current.get(w.id);
          const el = elRefs.current.get(w.id);
          if (!g || !el) continue;
          const pos = windowScreenPos(w);
          const wh = el.offsetHeight;
          const lines = g.querySelectorAll('line');
          const dots = g.querySelectorAll('circle');
          w.cardIds.forEach((id, i) => {
            const b = engine.get(id);
            const c = lookup(id);
            const line = lines[i];
            const dot = dots[i];
            if (!b || !c || !line || !dot) return;
            const { w: cw } = cardSize(c);
            const cr = worldToScreen(b.x + (cw * b.s) / 2, b.y);
            const cl = worldToScreen(b.x - (cw * b.s) / 2, b.y);
            const cx = worldToScreen(b.x, b.y);
            const winLeft = pos.x;
            const winRight = pos.x + w.width;
            // ウィンドウとカードの位置関係で、近い辺どうしを結ぶ
            const toRight = cx.x < winLeft;
            const px = toRight ? winLeft : winRight;
            const py = Math.max(pos.y + 24, Math.min(pos.y + wh - 24, cx.y));
            const qx = toRight ? cr.x : cl.x;
            const hide = cx.x > winLeft && cx.x < winRight;
            line.setAttribute('x1', `${px}`);
            line.setAttribute('y1', `${py}`);
            line.setAttribute('x2', `${qx}`);
            line.setAttribute('y2', `${cr.y}`);
            dot.setAttribute('cx', `${qx}`);
            dot.setAttribute('cy', `${cr.y}`);
            line.style.opacity = hide ? '0' : '1';
            dot.style.opacity = hide ? '0' : '1';
          });
        }
      }),
    [],
  );

  useEffect(() => engine.notify());

  return (
    <div className="win-layer">
      <svg className="leader-svg">
        {windows
          .filter((w) => !NO_LEADER.includes(w.type))
          .map((w) => (
            <g
              key={w.id}
              ref={(el) => {
                if (el) lineRefs.current.set(w.id, el);
                else lineRefs.current.delete(w.id);
              }}
            >
              {w.cardIds.map((id) => (
                <g key={id}>
                  <line stroke="#6ae3ff" strokeWidth="1.2" strokeDasharray="3 4" opacity="0.8" />
                  <circle r="4" fill="#6ae3ff" style={{ filter: 'drop-shadow(0 0 4px #6ae3ff)' }} />
                </g>
              ))}
            </g>
          ))}
      </svg>
      <AnimatePresence>
        {windows.map((w) => (
          <Frame
            key={w.id}
            win={w}
            setEl={(el) => {
              if (el) elRefs.current.set(w.id, el);
              else elRefs.current.delete(w.id);
            }}
          >
            <Content win={w} />
          </Frame>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Content({ win }: { win: FloatWin }) {
  switch (win.type) {
    case 'summary':
      return <SummaryWindow win={win} />;
    case 'extract':
      return <ExtractWindow win={win} />;
    case 'axis':
      return <AxisWindow win={win} />;
    case 'preview':
      return <PreviewWindow win={win} />;
    case 'detail':
      return <DetailWindow win={win} />;
    case 'cluster':
      return <ClusterWindow win={win} />;
    case 'relations':
      return <RelationsWindow win={win} />;
    case 'relation':
      return <RelationWindow win={win} />;
    case 'chat':
      return <ChatWindow win={win} />;
    case 'search':
      return <SearchWindow win={win} />;
    case 'voice':
      return <VoiceWindow win={win} />;
    case 'agent':
      return <AgentWindowSlot win={win} />;
    case 'account':
      return <AccountWindow win={win} />;
    case 'share':
      return <ShareWindow win={win} />;
    case 'spaces':
      return <SpacesWindow win={win} />;
    case 'help':
      return <HelpWindow win={win} />;
    case 'settings':
      return <SettingsWindow win={win} />;
    default:
      return null;
  }
}

function subtitleOf(win: FloatWin) {
  const titles = win.cardIds.map((id) => lookup(id)?.title).filter(Boolean);
  const fixed: Partial<Record<WindowType, MessageKey>> = {
    axis: 'win.axis.sub',
    preview: 'win.preview.sub',
    cluster: 'win.cluster.sub',
    account: 'win.account.sub',
    share: 'win.share.sub',
    spaces: 'win.spaces.sub',
    help: 'win.help.sub',
    settings: 'win.settings.sub',
    voice: 'win.voice.sub',
    agent: 'win.agent.sub',
    search: 'win.search.sub',
  };
  if (fixed[win.type]) return t(fixed[win.type]!);
  if (!titles.length) return '';
  return titles.length > 1 ? t('win.moreItems', { title: titles[0]!, n: titles.length - 1 }) : titles[0]!;
}

function Frame({ win, children, setEl }: { win: FloatWin; children: ReactNode; setEl: (el: HTMLDivElement | null) => void }) {
  const pos = windowScreenPos(win);
  const vh = useStore((s) => s.viewport.h);
  const meta = META[win.type];
  const title = t(`win.${win.type}.title` as MessageKey);

  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    let last = { x: e.clientX, y: e.clientY };
    // 左ナビまで運んで手を離したら閉じる。速さは見ないので空振りしない
    const nav = document.querySelector('.sidebar');
    const move = (ev: PointerEvent) => {
      moveWindow(win.id, ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
      nav?.classList.toggle('drop-close', overNav(ev.clientX, ev.clientY));
      engine.notify();
    };
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('.fwin');
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      nav?.classList.remove('drop-close');
      const box = el?.getBoundingClientRect();
      const bar = nav?.getBoundingClientRect();
      // 手を離した所がナビの外でも、ウィンドウの半分以上がナビに潜っていれば閉じる
      const hidden = box && bar && bar.width >= 8 ? Math.max(0, Math.min(box.right, bar.right) - Math.max(box.left, bar.left)) / Math.max(1, box.width) : 0;
      if (overNav(ev.clientX, ev.clientY) || hidden >= 0.5) return closeWindow(win.id);
      if (!box || !el) return;
      // 閉じなかったときは、ナビの裏や画面の外に残さず、見える所まで跳ね戻す
      const minX = (bar && bar.width >= 8 ? bar.right : 0) + 12;
      const dx = box.left < minX ? minX - box.left : box.right > window.innerWidth - 8 ? Math.max(minX - box.left, window.innerWidth - 8 - box.right) : 0;
      const dy = box.top < 8 ? 8 - box.top : box.top > window.innerHeight - 80 ? window.innerHeight - 80 - box.top : 0;
      if (!dx && !dy) return;
      el.style.transition = 'left 0.28s cubic-bezier(.2,1.4,.4,1), top 0.28s cubic-bezier(.2,1.4,.4,1)';
      moveWindow(win.id, dx, dy);
      engine.notify();
      window.setTimeout(() => {
        el.style.transition = '';
      }, 320);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <motion.div
      ref={setEl}
      className={`fwin ${win.pinned ? 'pinned' : ''}`}
      style={{ left: pos.x, top: pos.y, width: win.width, zIndex: win.z, maxHeight: Math.max(240, vh - pos.y - 84) }}
      role="dialog"
      aria-label={title}
      initial={{ opacity: 0, scale: 0.86, x: -24, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)', transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        focusWindow(win.id);
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="fwin-head" onPointerDown={onHeadDown}>
        <div className="fwin-icon">
          <Icon name={meta.icon} size={18} />
        </div>
        <div className="fwin-title">
          <b>{title}</b>
          <small>{subtitleOf(win)}</small>
        </div>
        <button className="icon-btn" style={{ width: 28, height: 28, color: win.pinned ? 'var(--gold)' : undefined }} title={win.pinned ? t('win.unpin') : t('win.pin')}
          aria-label={win.pinned ? t('win.unpin') : t('win.pin')} onClick={() => togglePin(win.id)}>
          <Icon name="pin" size={16} />
        </button>
        <button className="icon-btn" style={{ width: 28, height: 28 }} title={t('win.close')} aria-label={t('win.close')} onClick={() => closeWindow(win.id)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {children}
    </motion.div>
  );
}
