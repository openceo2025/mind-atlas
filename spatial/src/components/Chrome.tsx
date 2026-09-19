import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  canvasCards,
  createCard,
  duplicateCurrentSpace,
  focusCard,
  openSpaceById,
  openWindow,
  redo,
  renameSpace,
  screenToWorld,
  set,
  toast,
  toggleToolWindow,
  undo,
  useStore,
} from '../store';
import { HOSTED } from '../lib/service';
import { embeddingStatus, subscribeEmbeddings } from '../lib/embeddings';
import { t } from '../i18n';
import { Icon } from './Icons';

export function Sidebar() {
  const spaces = useStore((s) => s.spaces);
  const current = useStore((s) => s.spaceId);
  const open = useStore((s) => s.sidebarOpen);
  const session = useStore((s) => s.session);
  const tool = (type: Parameters<typeof toggleToolWindow>[0]) => () => {
    toggleToolWindow(type);
    if (window.innerWidth < 900) set({ sidebarOpen: false });
  };
  return (
    <aside className={`sidebar ${open ? 'open' : 'closed'}`} aria-label={t('nav.label')}>
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <b>MindAtlas</b>
          <small>{t('brand.tagline')}</small>
        </div>
        <span className="beta-pill">β</span>
      </div>
      <div className="nav-section">{t('nav.spaces')}</div>
      <div className="nav-spaces">
        {spaces
          .filter((m) => !m.cloudOnly)
          .slice(0, 7)
          .map((m) => (
            <button key={m.id} className={`nav-item ${m.id === current ? 'active' : ''}`} onClick={() => void openSpaceById(m.id)} title={m.title}>
              <Icon name={m.id === current ? 'target' : 'layers'} size={17} />
              <span className="ellipsis">{m.title}</span>
            </button>
          ))}
      </div>
      <button className="nav-item" onClick={tool('spaces')}>
        <Icon name="grid" size={17} />
        {t('nav.allSpaces')}
      </button>
      <div className="nav-section">{t('nav.tools')}</div>
      <button className="nav-item" onClick={tool('chat')}>
        <Icon name="chat" size={17} />
        {t('nav.chat')}
      </button>
      <button className="nav-item" onClick={tool('search')}>
        <Icon name="globe" size={17} />
        {t('nav.search')}
      </button>
      <button className="nav-item" onClick={tool('voice')}>
        <Icon name="mic" size={17} />
        {t('nav.voice')}
      </button>
      {!HOSTED && (
        <button className="nav-item" onClick={tool('agent')}>
          <Icon name="terminal" size={17} />
          {t('nav.agent')}
        </button>
      )}
      <button className="nav-item" onClick={tool('axis')}>
        <Icon name="axis" size={17} />
        {t('nav.axes')}
      </button>
      <div className="sidebar-foot">
        <button className="nav-item" onClick={tool('help')}>
          <Icon name="help" size={17} />
          {t('nav.help')}
        </button>
        <button className="nav-item" onClick={tool('settings')}>
          <Icon name="settings" size={17} />
          {t('nav.settings')}
        </button>
        <div className="foot-note">
          {session.mode === 'local' ? t('nav.localMode') : t('nav.beta')}
          <br />
          <a href="https://mind-atlas.org/" target="_blank" rel="noreferrer noopener">
            {t('nav.legacy')}
          </a>
        </div>
      </div>
    </aside>
  );
}

function SaveIndicator() {
  const saveState = useStore((s) => s.saveState);
  const cloudState = useStore((s) => s.cloudState);
  const authenticated = useStore((s) => s.session.authenticated);
  const readOnly = useStore((s) => s.readOnly);
  if (readOnly) return <span className="save-state">{t('save.readOnly')}</span>;
  const cloud = HOSTED && authenticated;
  const label =
    saveState === 'error'
      ? t('save.error')
      : saveState !== 'saved'
        ? t('save.saving')
        : cloud
          ? cloudState === 'syncing'
            ? t('save.syncing')
            : cloudState === 'error'
              ? t('save.cloudError')
              : t('save.cloud')
          : t('save.local');
  return (
    <span className={`save-state ${saveState === 'error' || cloudState === 'error' ? 'bad' : ''}`} title={cloud ? t('save.cloudTip') : t('save.localTip')}>
      <Icon name={cloud ? (cloudState === 'error' ? 'cloudOff' : 'cloud') : 'check'} size={13} />
      {label}
    </span>
  );
}

function SemanticIndicator() {
  const source = useStore((s) => s.scoreSource);
  const [pending, setPending] = useState(0);
  useEffect(() => subscribeEmbeddings(() => setPending(embeddingStatus().pending)), []);
  if (source === 'server' && !pending) return null;
  return (
    <span className="semantic-state" title={source === 'local' ? t('semantic.localTip') : ''}>
      <span className={pending ? 'spinner' : 'dot'} />
      {pending ? t('semantic.computing') : t('semantic.local')}
    </span>
  );
}

export function TopBar() {
  const query = useStore((s) => s.query);
  const title = useStore((s) => s.title);
  const readOnly = useStore((s) => s.readOnly);
  const session = useStore((s) => s.session);
  const theme = useStore((s) => s.theme);
  const [editing, setEditing] = useState(false);

  const jumpToMatch = () => {
    const q = query.toLowerCase();
    const hit = canvasCards().find((c) => c.title.toLowerCase().includes(q) || c.tags.some((x) => x.toLowerCase().includes(q)) || c.body.toLowerCase().includes(q));
    if (hit) focusCard(hit.id);
    else toast(t('search.noMatch'));
  };

  const newCard = () => {
    const { viewport } = useStore.getState();
    const w = screenToWorld(viewport.w / 2, viewport.h / 2 - 40);
    const id = createCard({ kind: 'note', title: t('card.newTitle') }, w);
    openWindow('detail', [id], { focusTitle: true });
  };

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={() => set((s) => ({ sidebarOpen: !s.sidebarOpen }))} aria-label={t('nav.menu')}>
        <Icon name="menu" size={18} />
      </button>
      <div className="ws-title">
        {editing && !readOnly ? (
          <input
            className="title-input"
            autoFocus
            defaultValue={title}
            onBlur={(e) => {
              renameSpace(e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h1 onDoubleClick={() => setEditing(true)} title={readOnly ? title : t('topbar.renameHint')}>
            {title}
          </h1>
        )}
        <p>
          <SaveIndicator />
          <SemanticIndicator />
        </p>
      </div>
      <label className="search">
        <Icon name="search" size={17} />
        <input
          id="global-search"
          value={query}
          placeholder={t('topbar.searchPlaceholder')}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query) jumpToMatch();
            if (e.key === 'Escape') {
              set({ query: '' });
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button className="kbd" onClick={() => set({ paletteOpen: true })} title={t('topbar.palette')}>
          Ctrl K
        </button>
      </label>
      <div className="top-actions">
        {!readOnly && (
          <>
            <button className="icon-btn hide-sm" onClick={newCard} title={t('topbar.newCard')} aria-label={t('topbar.newCard')}>
              <Icon name="plus" size={18} />
            </button>
            <button className="icon-btn hide-sm" onClick={() => undo()} title={t('topbar.undo')} aria-label={t('topbar.undo')}>
              <Icon name="undo" size={18} />
            </button>
            <button className="icon-btn hide-sm" onClick={() => redo()} title={t('topbar.redo')} aria-label={t('topbar.redo')}>
              <Icon name="redo" size={18} />
            </button>
          </>
        )}
        <button className="icon-btn hide-sm" onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })} title={theme === 'dark' ? t('settings.light') : t('settings.dark')} aria-label={t('settings.theme')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
        {readOnly ? (
          <button className="btn primary" onClick={() => void duplicateCurrentSpace()}>
            <Icon name="copy" size={15} /> {t('share.remix')}
          </button>
        ) : (
          <button className="btn" style={{ height: 34 }} onClick={() => toggleToolWindow('share')}>
            <Icon name="share" size={16} /> <span className="hide-sm">{t('topbar.share')}</span>
          </button>
        )}
        <button className="avatar-btn" onClick={() => toggleToolWindow('account')} title={t('topbar.account')} aria-label={t('topbar.account')}>
          {session.user?.pictureUrl ? <img src={session.user.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" size={18} />}
          {session.subscriptionActive && <span className="plan-dot" />}
        </button>
      </div>
    </header>
  );
}

export function ReadOnlyBanner() {
  const readOnly = useStore((s) => s.readOnly);
  if (!readOnly) return null;
  return (
    <div className="readonly-banner">
      <Icon name="info" size={14} /> {t('share.banner')}
      <button className="btn small primary" onClick={() => void duplicateCurrentSpace()}>
        {t('share.remix')}
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((x) => (
          <motion.div key={x.id} className={`toast ${x.tone === 'error' ? 'error' : ''}`} initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}>
            {x.text}
            {x.action && (
              <button className="toast-action" onClick={x.action.run}>
                {x.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function DragGhost() {
  const ghost = useStore((s) => s.ghost);
  const target = useStore((s) => s.dropTarget);
  const draggingCanvas = useStore((s) => s.draggingIds.length > 0 && !s.ghost);
  if (!ghost && !(draggingCanvas && target && target !== 'canvas')) return null;
  const [kind, arg] = (target ?? '').split(':');
  const hint =
    kind === 'axis'
      ? t('drop.axis', { axis: arg?.toUpperCase() ?? '' })
      : kind === 'slot'
        ? t('drop.slot', { axis: arg?.toUpperCase() ?? '' })
        : kind === 'shelf'
          ? t('drop.shelf')
          : kind === 'group'
            ? t('drop.group')
            : kind === 'canvas'
              ? t('drop.canvas')
              : '';
  if (!ghost) return <CursorHint text={hint} />;
  return (
    <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
      {ghost.card.title.length > 28 ? `${ghost.card.title.slice(0, 28)}…` : ghost.card.title}
      {hint && <div className="drag-hint">→ {hint}</div>}
    </div>
  );
}

function CursorHint({ text }: { text?: string }) {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  useEffect(() => {
    const m = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', m);
    return () => window.removeEventListener('pointermove', m);
  }, []);
  if (!text) return null;
  return (
    <div className="drag-ghost gold" style={{ left: pos.x + 24, top: pos.y + 28, transform: 'none' }}>
      → {text}
    </div>
  );
}
