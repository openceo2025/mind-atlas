import { memo, useEffect, useRef } from 'react';
import {
  AXIS_KEYS,
  axisKeyOf,
  collapseGroup,
  deleteCards,
  dragFollowers,
  duplicate,
  expandGroup,
  axisToDetach,
  detachAxis,
  moveCards,
  openWindow,
  overrideFromPosition,
  placeAtDepth,
  select,
  set,
  settleAxisCard,
  settleGroupMembers,
  useStore,
  AXIS_NAME,
} from '../store';
import { engine } from '../lib/physics';
import { DEPTH_HIGH, DEPTH_LOW, axisEnds, axisSlotKey, cardSize, project, unproject } from '../lib/semantic';
import { dropCards, findDropTarget, overNav } from '../lib/drag';
import { t } from '../i18n';
import { Icon, KindIcon, Visual } from './Icons';
import type { Card } from '../types';
import { panState } from './panState';
import { startLinkDrag } from './linking';

/** Shift ドラッグ：この距離だけ縦に引くと、奥行きが 1 つ分変わる */
const DEPTH_DRAG_PX = 420;

const matches = (c: Card, q: string) => {
  const s = q.toLowerCase();
  return c.title.toLowerCase().includes(s) || c.tags.some((x) => x.toLowerCase().includes(s)) || c.body.toLowerCase().includes(s);
};

function CardViewImpl({ id }: { id: string }) {
  const card = useStore((s) => s.cards[id]);
  const selected = useStore((s) => s.selection.includes(id));
  const single = useStore((s) => s.selection.length === 1 && s.selection[0] === id);
  const axisKey = useStore((s) => axisKeyOf(id, s.axes));
  const dim = useStore((s) => (s.query && s.cards[id] ? !matches(s.cards[id], s.query) : false));
  const flash = useStore((s) => s.highlight.includes(id));
  const dragging = useStore((s) => s.draggingIds.includes(id));
  const relCount = useStore((s) => s.relations.reduce((n, r) => n + (!r.suggested && (r.from === id || r.to === id) ? 1 : 0), 0));
  const dropOver = useStore((s) => s.dropTarget === `group:${id}`);
  const clusterHue = useStore((s) => s.clusters?.find((c) => c.cardIds.includes(id))?.hue);
  const readOnly = useStore((s) => s.readOnly);
  const humanPlaced = useStore((s) => {
    const o = s.cards[id]?.overrides;
    return Boolean(o && AXIS_KEYS.some((k) => o[axisSlotKey(s.axes, k)] !== undefined));
  });
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = card ? cardSize(card) : { w: 0, h: 0 };

  useEffect(
    () =>
      engine.subscribe(() => {
        const b = engine.get(id);
        const el = ref.current;
        if (!b || !el) return;
        const rot = Math.max(-5, Math.min(5, b.vx * 0.006)) * b.lift;
        const s = b.s * (1 + 0.05 * b.lift);
        el.style.transform = `translate(${b.x - w / 2}px, ${b.y - h / 2 - 8 * b.lift}px) scale(${s}) rotate(${rot}deg)`;
      }),
    [id, w, h],
  );

  if (!card) return null;
  const hidden = card.place !== 'canvas';

  // Shift ドラッグ：上へ引くほど奥（右上へ寄って小さく）、下へ引くほど手前。
  // 動かさずに離したときは、これまで通り選択の切り替え。
  const startDepthDrag = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const ids = (st.selection.includes(id) ? st.selection : [id]).filter((x) => st.cards[x]?.place === 'canvas' && !axisKeyOf(x, st.axes));
    if (st.readOnly || !ids.length) return select([id], 'toggle');
    const from = ids.map((x) => {
      const c = st.cards[x];
      const u = unproject(c.x, c.y, c.depth);
      return { id: x, sx: u.sx, sy: u.sy, depth: c.depth };
    });
    const start = { x: e.clientX, y: e.clientY };
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        started = true;
        ids.forEach((x) => engine.setLift(x, true));
        set({ draggingIds: ids });
      }
      const delta = (start.y - ev.clientY) / DEPTH_DRAG_PX;
      placeAtDepth(
        from.map((b) => {
          const depth = Math.max(DEPTH_LOW, Math.min(DEPTH_HIGH, b.depth + delta));
          const p = project(b.sx, b.sy, depth);
          return { id: b.id, x: p.x, y: p.y, depth };
        }),
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!started) return select([id], 'toggle');
      ids.forEach((x) => engine.setLift(x, false));
      set({ draggingIds: [] });
      overrideFromPosition(ids);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || panState.space || panState.pinching) return;
    e.stopPropagation();
    const st = useStore.getState();
    if (e.shiftKey) return startDepthDrag(e);
    // Ctrl を押したまま：動かさずに離せば選択の切り替え、引けばこのカードだけを単独で動かす
    const ctrlAtStart = e.ctrlKey || e.metaKey;
    if (!ctrlAtStart) {
      if (!st.selection.includes(id)) select([id]);
      else set({ primary: id, radialHidden: false, selectedRelation: null });
    }
    if (st.readOnly) {
      if (ctrlAtStart) select([id], 'toggle');
      return;
    }
    let ids = ctrlAtStart ? [id] : useStore.getState().selection.filter((x) => useStore.getState().cards[x]?.place === 'canvas');
    if (!ids.includes(id)) ids = [id];
    const alt = e.altKey;
    let last = { x: e.clientX, y: e.clientY };
    const start = last;
    let started = false;
    // つかんだカードから生まれたカードも一緒に動く。Ctrl を押している間は置いていく（ドラッグ中に切り替えられる）
    let followers: string[] = [];
    const moved = new Set<string>();
    const origin = new Map<string, { x: number; y: number }>();
    let solo = ctrlAtStart;
    const nav = document.querySelector('.sidebar');
    const setSolo = (next: boolean) => {
      if (next === solo || !started) return;
      solo = next;
      followers.forEach((x) => engine.setLift(x, !solo));
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Control' || ev.key === 'Meta') setSolo(ev.type === 'keydown');
    };
    const move = (ev: PointerEvent) => {
      if (panState.pinching) return;
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        started = true;
        if (alt) {
          const dups = duplicate(ids);
          if (dups.length) {
            ids = dups;
            select(dups);
          }
        }
        followers = alt ? [] : dragFollowers(ids);
        const cards = useStore.getState().cards;
        [...ids, ...followers].forEach((x) => cards[x] && origin.set(x, { x: cards[x].x, y: cards[x].y }));
        ids.forEach((x) => engine.setLift(x, true));
        if (!solo) followers.forEach((x) => engine.setLift(x, true));
        set({ draggingIds: ids });
      }
      setSolo(ev.ctrlKey || ev.metaKey);
      const z = useStore.getState().camera.zoom;
      const group = solo ? ids : [...ids, ...followers];
      group.forEach((x) => moved.add(x));
      moveCards(group, (ev.clientX - last.x) / z, (ev.clientY - last.y) / z);
      last = { x: ev.clientX, y: ev.clientY };
      // 左のナビへ投げると削除（ダイアログと同じ）
      nav?.classList.toggle('drop-close', overNav(ev.clientX, ev.clientY));
      const target = findDropTarget(ev.clientX, ev.clientY, [...ids, ...followers]);
      if (target !== useStore.getState().dropTarget) set({ dropTarget: target });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      nav?.classList.remove('drop-close');
      if (!started) {
        if (ctrlAtStart) select([id], 'toggle');
        return;
      }
      [...ids, ...followers].forEach((x) => engine.setLift(x, false));
      set({ draggingIds: [], dropTarget: null });
      const movedFollowers = followers.filter((x) => moved.has(x));
      if (ev.type === 'pointerup' && overNav(ev.clientX, ev.clientY)) {
        // 連れてきたカードは元の場所へ戻し、つかんだカードだけを消す（元に戻すで復活できる）
        for (const x of movedFollowers) {
          const o = origin.get(x);
          const c = useStore.getState().cards[x];
          if (o && c) moveCards([x], o.x - c.x, o.y - c.y);
        }
        for (const x of ids) {
          const o = origin.get(x);
          const c = useStore.getState().cards[x];
          if (o && c) moveCards([x], o.x - c.x, o.y - c.y);
        }
        deleteCards(ids);
        return;
      }
      const target = findDropTarget(ev.clientX, ev.clientY, [...ids, ...followers]);
      const handled = target && target !== 'canvas' ? dropCards(target, ids, ev.clientX, ev.clientY) : false;
      // 軸の先端から遠くへ運んだ軸カードは、その軸から外す（軸は「意味なし」になる）
      const detached = handled ? [] : ids.map((x) => ({ id: x, key: axisToDetach(x) })).filter((entry) => entry.key);
      for (const entry of detached) detachAxis(entry.key!);
      // 残りの軸カードは軸の先端へ戻り、それ以外は「置いた場所＝いまの軸での意味」として記録する
      ids.forEach((x) => settleAxisCard(x));
      const placed = [...(handled ? [] : ids.filter((x) => !detached.some((entry) => entry.id === x))), ...movedFollowers];
      // 開いているグループの中のカード：外へ運んだらグループから外し、中なら新しい場所として覚える
      if (!handled) settleGroupMembers(placed);
      if (placed.length) overrideFromPosition(placed);
      if (detached.length) overrideFromPosition(detached.map((entry) => entry.id));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
  };

  // 右クリック（長押し）で、そのカードにできることを出す
  const onContextMenu = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    if (!selected) select([id]);
    set({ cardMenu: { ids: useStore.getState().selection.includes(id) ? useStore.getState().selection : [id], x: e.clientX, y: e.clientY } });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.kind === 'group') {
      if (readOnly) return;
      if (card.expanded) collapseGroup(id);
      else expandGroup(id);
    } else {
      openWindow('detail', [id]);
    }
  };

  // 手前のカードほど上に重なる（depth は 0=手前 … 1=奥。範囲外にもなるので下駄を履かせる）
  const layer = Math.round((2 - card.depth) * 100);
  const visual = Boolean(card.image) || (card.visual && (card.kind === 'image' || card.kind === 'idea'));
  const meaning = Math.min(5, Math.floor((card.log.length - 1 + relCount) / 2));
  const cls = [
    'card',
    selected && 'selected',
    dragging && 'lifted',
    dim && 'dim',
    flash && 'flash',
    axisKey && 'axis',
    visual && 'visual',
    card.kind === 'topic' && 'topic',
    card.kind === 'concept' && 'concept',
    card.createdBy === 'ai' && card.kind !== 'summary' && 'ai-made',
    dropOver && 'selected',
    clusterHue !== undefined && !selected && 'clustered',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      data-card-id={id}
      data-drop={card.kind === 'group' ? `group:${id}` : undefined}
      style={{
        width: w,
        height: h,
        zIndex: dragging ? 900 : selected ? 400 + layer : layer + (axisKey ? 300 : 0),
        opacity: hidden ? 0 : undefined,
        pointerEvents: hidden ? 'none' : undefined,
        ...(clusterHue !== undefined ? ({ '--cl-hue': clusterHue } as React.CSSProperties) : {}),
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={card.kind === 'group' ? t('card.groupHint') : t('card.detailHint')}
    >
      {card.kind === 'group' && !card.expanded && (
        <>
          <div className="stack" style={{ transform: 'translate(10px,-10px)', opacity: 0.45, zIndex: -2 }} />
          <div className="stack" style={{ transform: 'translate(5px,-5px)', opacity: 0.7, zIndex: -1 }} />
        </>
      )}
      {axisKey && <span className="badge axis">{t('card.axisBadge', { axis: AXIS_NAME(axisKey) })}</span>}
      {!axisKey && card.createdBy === 'ai' && <span className="badge ai">{t('card.aiBadge')}</span>}
      {visual && (
        <div className="thumb">
          {card.image ? <img src={card.image} alt="" draggable={false} /> : <Visual kind={card.visual!} id={id} />}
          <div className="thumb-shade" />
        </div>
      )}
      <Body card={card} visual={Boolean(visual)} />
      {humanPlaced && !axisKey && (
        <span className="human-mark" title={t('card.humanPlaced')}>
          <Icon name="hand" size={12} />
        </span>
      )}
      {!visual && meaning > 0 && (
        <div className="meaning-dots" title={t('card.meaning', { rel: relCount, ops: card.log.length })}>
          {Array.from({ length: meaning }).map((_, i) => (
            <i key={i} />
          ))}
        </div>
      )}
      <button
        className="card-menu"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          select([id]);
          openWindow('detail', [id]);
        }}
        title={t('card.details')}
        aria-label={t('card.details')}
      >
        <Icon name="dots" size={14} />
      </button>
      {single && !readOnly && card.kind !== 'concept' && (
        <span
          className="link-handle"
          title={t('card.linkHint')}
          onPointerDown={(e) => {
            e.stopPropagation();
            startLinkDrag(e, id);
          }}
        >
          <Icon name="link" size={12} />
        </span>
      )}
    </div>
  );
}

function Body({ card, visual }: { card: Card; visual: boolean }) {
  if (card.kind === 'topic') {
    return (
      <>
        <div className="thumb" style={{ position: 'absolute', inset: 0, borderRadius: 11, overflow: 'hidden' }}>
          {card.image ? <img src={card.image} alt="" draggable={false} /> : <Visual kind="earth" id={card.id} />}
          <div className="thumb-shade" />
        </div>
        <div className="card-inner" style={{ position: 'relative', alignItems: 'flex-end' }}>
          <div className="card-main" style={{ justifyContent: 'flex-end' }}>
            <div className="card-title" style={{ color: '#fff' }}>
              {card.title}
            </div>
            {card.subtitle && (
              <div className="card-sub" style={{ whiteSpace: 'normal', color: '#cfe0ff' }}>
                {card.subtitle}
              </div>
            )}
            <Tags tags={card.tags} />
          </div>
        </div>
      </>
    );
  }
  if (card.kind === 'concept') {
    const [lo, hi] = axisEnds(card);
    return (
      <div className="card-inner">
        <div className="concept-mark">
          <Icon name="axis" size={18} />
        </div>
        <div className="card-main" style={{ justifyContent: 'center' }}>
          <div className="card-title">{card.title}</div>
          <div className="ends">
            {lo} ⟷ {hi}
          </div>
        </div>
      </div>
    );
  }
  if (card.kind === 'person') {
    return (
      <div className="card-inner">
        <div className="initials">{card.title.charAt(0)}</div>
        <div className="card-main">
          <div className="card-title">{card.title}</div>
          {card.subtitle && <div className="card-sub">{card.subtitle}</div>}
          <Tags tags={card.tags} />
        </div>
      </div>
    );
  }
  const sub = card.kind === 'group' ? (card.expanded ? t('card.groupExpanded') : t('group.count', { n: card.members?.length ?? 0 })) : card.subtitle || firstLine(card.body);
  return (
    <div className="card-inner">
      {!visual &&
        (card.visual === 'battery' ? (
          <div className="kind-icon" style={{ overflow: 'hidden' }}>
            <Visual kind="battery" id={card.id} />
          </div>
        ) : (
          <KindIcon card={card} />
        ))}
      <div className="card-main" style={visual ? { justifyContent: 'flex-end' } : undefined}>
        <div className="card-title">
          {card.title}
          {card.kind === 'group' && <span className="count-pill">{card.members?.length}</span>}
        </div>
        {sub && <div className="card-sub">{sub}</div>}
        <Tags tags={card.tags} />
      </div>
    </div>
  );
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="tags">
      {tags.slice(0, 3).map((tag) => (
        <span key={tag} className="tag">
          #{tag.replace(/^#/, '')}
        </span>
      ))}
    </div>
  );
}

export const CardView = memo(CardViewImpl);
