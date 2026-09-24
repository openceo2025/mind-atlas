import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  aiBlock,
  collapseGroup,
  createChild,
  expandGroup,
  get,
  group,
  isAxisCard,
  layoutCards,
  openWindow,
  openWindowAtScreen,
  proposeClusters,
  removeFromGroup,
  requireAi,
  select,
  set,
  setBusy,
  spawnDrafts,
  suggestRelations,
  toast,
  toastError,
  useStore,
  worldToScreen,
} from '../store';
import { engine } from '../lib/physics';
import { cardSize } from '../lib/semantic';
import { expand } from '../lib/ai';
import { neighborhood } from '../lib/spaceTools';
import { t } from '../i18n';
import { Icon } from './Icons';

const R = 84;

interface Item {
  key: string;
  label: string;
  icon: string;
  tip: string;
  /** 同じことをする鍵盤の手 */
  shortcut?: string;
  disabled?: boolean;
  busy?: boolean;
  run: () => void;
}

export function RadialMenu() {
  const primary = useStore((s) => s.primary);
  const selection = useStore((s) => s.selection);
  const card = useStore((s) => (s.primary ? s.cards[s.primary] : undefined));
  const dragging = useStore((s) => s.draggingIds.length > 0);
  const linking = useStore((s) => Boolean(s.linking));
  const hiddenByWindow = useStore((s) => s.radialHidden);
  const readOnly = useStore((s) => s.readOnly);
  const busy = useStore((s) => s.busy);
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<string | null>(null);
  // 子カードを作った直後は輪を薄くして、生まれたカードと作業の邪魔をしない。
  // 続けて作るならそのまま押せるし、輪へマウスを戻せば元の濃さに戻る
  const [faded, setFaded] = useState(false);
  const [below, setBelow] = useState(false);
  useEffect(() => setFaded(false), [primary]);

  // 線を引いている間は、輪が相手のカードを隠さないように消える
  const visible = !!card && card.place === 'canvas' && selection.length > 0 && !dragging && !linking && !hiddenByWindow && !readOnly;

  useLayoutEffect(() => {
    if (!visible || !primary) return;
    return engine.subscribe(() => {
      const b = engine.get(primary);
      const el = ref.current;
      const st = get();
      const c = st.cards[primary];
      if (!b || !el || !c) return;
      // 輪はカードの上・中央に出す。右側はつなぐ線のつまみと、子カードの生まれる場所なので空けておく
      const { h } = cardSize(c);
      const top = worldToScreen(b.x, b.y - (h * b.s) / 2);
      const bottom = worldToScreen(b.x, b.y + (h * b.s) / 2);
      const room = top.y - R - 44 > R + 28;
      const x = Math.max(R + 40, Math.min(st.viewport.w - R - 40, top.x));
      const y = room ? top.y - R - 44 : bottom.y + R + 44;
      if (room === below) setBelow(!room);
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }, [visible, primary, below]);

  if (!card) return null;
  const n = selection.length;
  const isGroup = card.kind === 'group';
  const aiOk = !aiBlock();

  const items: Item[] = [
    {
      key: 'summary',
      label: t('radial.summary'),
      icon: 'summary',
      tip: n > 1 ? t('radial.summaryTipMany', { n }) : t('radial.summaryTip'),
      run: () => openWindow('summary', selection),
    },
    {
      key: 'child',
      label: t('radial.child'),
      icon: 'childCard',
      tip: t('radial.childTip'),
      disabled: card.kind === 'concept' || isAxisCard(card.id),
      // 押すたびに、親につながった空のカードが隣へ増えていく
      run: () => {
        createChild(card.id);
        setFaded(true);
      },
    },
    {
      key: 'chat',
      label: t('radial.ask'),
      icon: 'chat',
      tip: t('radial.askTip'),
      run: () => openWindow('chat', selection.slice(0, 12)),
    },
    // グループの中のカードなら、同じ場所が「グループから外す」になる
    card.groupId
      ? {
          key: 'ungroup',
          label: t('radial.ungroup'),
          icon: 'bundle',
          tip: t('radial.ungroupTip'),
          run: () => removeFromGroup(selection.filter((x) => get().cards[x]?.groupId)),
        }
      : {
          key: 'bundle',
          label: t('radial.bundle'),
          icon: 'bundle',
          // Ctrl+G とまったく同じ処理（store の group）を呼ぶ
          tip: n < 2 ? t('radial.bundleNeedTwo') : t('radial.bundleTip'),
          shortcut: 'Ctrl+G',
          disabled: n < 2,
          run: () => group(selection),
        },
    {
      key: 'expand',
      label: isGroup ? (card.expanded ? t('radial.collapse') : t('radial.open')) : t('radial.expand'),
      icon: 'expand',
      busy: busy.expand,
      tip: isGroup ? (card.expanded ? t('radial.collapseTip') : t('radial.openTip')) : aiOk ? t('radial.expandTip') : t(`ai.block.${aiBlock() ?? 'login'}` as 'ai.block.login'),
      run: () => {
        if (isGroup) return card.expanded ? collapseGroup(card.id) : expandGroup(card.id);
        if (!requireAi()) return;
        // 背景として、つながっているカードを先に渡す（足りなければ画面のカードで埋める）
        const near = neighborhood([card.id], 2, 12).filter((c) => c.id !== card.id);
        const neighbors = [...near, ...layoutCards().filter((c) => c.id !== card.id && c.kind !== 'concept' && !near.includes(c))].slice(0, 12);
        setBusy('expand', true);
        void expand(card, neighbors)
          .then((drafts) => {
            const ids = spawnDrafts(card.id, drafts);
            if (ids.length) {
              select(ids);
              toast(t('toast.expanded', { n: ids.length, title: card.title }));
            }
          })
          .catch(toastError)
          .finally(() => setBusy('expand', false));
      },
    },
    {
      key: 'relayout',
      label: t('radial.axes'),
      icon: 'cube',
      tip: isAxisCard(card.id) ? t('radial.axesTip') : t('radial.axesTipCard'),
      run: () => {
        const st = get();
        const existing = st.windows.find((w) => w.type === 'axis');
        if (existing) set({ windows: st.windows.filter((w) => w.id !== existing.id) });
        const el = ref.current?.getBoundingClientRect();
        const canvas = document.querySelector('.canvas')?.getBoundingClientRect();
        const x = (el?.left ?? 0) - (canvas?.left ?? 0) + R + 30;
        const y = (el?.top ?? 0) - (canvas?.top ?? 0) - 160;
        openWindowAtScreen('axis', [card.id], { x, y });
      },
    },
    {
      key: 'extract',
      label: t('radial.extract'),
      icon: 'extract',
      tip: t('radial.extractTip'),
      disabled: !card.body || isGroup,
      run: () => openWindow('extract', [card.id]),
    },
    {
      key: 'organize',
      label: t('radial.organize'),
      icon: 'organize',
      tip: t('radial.organizeTip'),
      run: () => {
        void proposeClusters(aiOk);
        openWindow('cluster', [card.id]);
      },
    },
  ];

  return (
    <AnimatePresence>
      {visible && (
        <div
          ref={ref}
          className={`radial${faded ? ' faded' : ''}`}
          role="menu"
          aria-label={n > 1 ? t('radial.selected', { n }) : card.title}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => setFaded(false)}
        >
          <motion.div
            key={primary}
            initial={{ scale: 0.4, opacity: 0, rotate: -40 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            style={{ position: 'absolute' }}
          >
            <div className="radial-ring" style={{ width: R * 2 + 70, height: R * 2 + 70, left: -R - 35, top: -R - 35 }} />
            {items.map((it, i) => {
              const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
              return (
                <button
                  key={it.key}
                  className={`radial-item ${it.busy ? 'busy' : ''}`}
                  style={{ left: Math.cos(a) * R, top: Math.sin(a) * R }}
                  disabled={it.disabled || it.busy}
                  onMouseEnter={() => setTip(it.tip)}
                  onMouseLeave={() => setTip(null)}
                  onClick={(e) => {
                    setTip(null);
                    // 焦点を残すと、次に押した Enter がこのボタンをもう一度押してしまう
                    e.currentTarget.blur();
                    it.run();
                  }}
                  onFocus={() => setTip(it.tip)}
                  onBlur={() => setTip(null)}
                  role="menuitem"
                  aria-keyshortcuts={it.shortcut}
                  aria-label={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
                >
                  <Icon name={it.icon} size={19} />
                  <span className="radial-label">{it.label}</span>
                  {it.shortcut && <kbd className="radial-kbd">{it.shortcut}</kbd>}
                </button>
              );
            })}
            <button
              className={`radial-center ${busy.relations ? 'busy' : ''}`}
              title={t('radial.discover')}
              aria-label={t('radial.discover')}
              onMouseEnter={() => setTip(t('radial.discoverTip'))}
              onMouseLeave={() => setTip(null)}
              onClick={(e) => {
                e.currentTarget.blur();
                setBusy('relations', true);
                openWindow('relations', selection);
                void suggestRelations(selection, aiOk)
                  .then((k) => {
                    if (!k) toast(t('toast.noNewRelations'));
                  })
                  .finally(() => setBusy('relations', false));
              }}
            >
              <Icon name="sparkle" size={24} />
            </button>
            <div className="radial-tip" style={{ ...(below ? { top: R + 44 } : { top: 'auto', bottom: R + 44 }), opacity: tip ? 1 : 0.85 }}>
              <span className="radial-count">{n > 1 ? t('radial.selected', { n }) : card.title}</span>
              {tip && <span className="radial-hint">{tip}</span>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
