import { useEffect } from 'react';
import {
  applyAxes,
  bootSpaces,
  canvasCards,
  closeWindow,
  createCard,
  deleteCards,
  ensureConcept,
  fitView,
  get,
  group,
  openSharedSpace,
  openWindow,
  redo,
  refreshSession,
  saveToCloud,
  screenToWorld,
  select,
  set,
  toast,
  toastError,
  toggleToolWindow,
  undo,
  useStore,
} from './store';
import { AXIS_PRESETS } from './data/concepts';
import { SESSION_CHANGED_EVENT } from './lib/service';
import { idbGet, idbSet } from './lib/idb';
import { t, useI18n } from './i18n';
import { Canvas } from './components/Canvas';
import { DragGhost, ReadOnlyBanner, ShareUnavailable, Sidebar, Toasts, TopBar } from './components/Chrome';
import { CommandPalette } from './components/CommandPalette';
import { panState } from './components/panState';

const THEME_KEY = 'mindatlas-spatial-theme';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

function shareTokenFromUrl() {
  const m = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,})\/?$/);
  if (m) return m[1];
  return new URLSearchParams(window.location.search).get('share');
}

function useBoot() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await refreshSession();
      if (cancelled) return;
      const token = shareTokenFromUrl();
      if (token) {
        try {
          await openSharedSpace(token);
          return;
        } catch (e) {
          // 共有が止められたリンクで、この端末に残っている別のスペースを見せない
          toastError(e);
          window.history.replaceState(null, '', '/');
          set({ shareUnavailable: true, ready: true });
          return;
        }
      }
      await bootSpaces();
      const params = new URLSearchParams(window.location.search);
      const billing = params.get('billing');
      if (billing) {
        toast(billing === 'success' ? t('account.billingSuccess') : t('account.billingCancelled'));
        window.history.replaceState(null, '', window.location.pathname);
        if (billing === 'success') window.setTimeout(() => void refreshSession(), 2500);
      }
      if (session.authenticated && get().cloudId === undefined) void saveToCloud();
      if (!(await idbGet<boolean>('kv', 'welcomed'))) {
        void idbSet('kv', 'welcomed', true);
        window.setTimeout(() => toggleToolWindow('help'), 900);
      }
    })();
    const onSession = () => void refreshSession();
    window.addEventListener(SESSION_CHANGED_EVENT, onSession);
    const onFocus = () => void refreshSession();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_CHANGED_EVENT, onSession);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}

function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') set({ theme: saved });
    } catch {
      // 既定のテーマ
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 保存できなくても表示は切り替わる
    }
  }, [theme]);
}

function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const s = get();
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        set({ paletteOpen: !s.paletteOpen });
        return;
      }
      if (typing(e) || s.paletteOpen) return;
      const edit = !s.readOnly;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!panState.space) {
          panState.space = true;
          window.dispatchEvent(new Event('panstate'));
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (mod && key === 'g' && edit) {
        e.preventDefault();
        group(s.selection);
      } else if (mod && key === 'z' && edit) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y' && edit) {
        e.preventDefault();
        redo();
      } else if (mod && key === 'a') {
        e.preventDefault();
        select(canvasCards().map((c) => c.id));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && edit) {
        if (s.selection.length) deleteCards(s.selection);
      } else if (e.key === 'Escape') {
        const loose = [...s.windows].sort((a, b) => b.z - a.z)[0];
        if (s.selection.length || s.selectedRelation) {
          select([]);
          set({ selectedRelation: null });
        } else if (loose) closeWindow(loose.id);
        set({ query: '' });
      } else if (key === 'f' && !mod) {
        fitView(s.selection.length ? s.selection : undefined);
      } else if (key === 'n' && !mod && edit) {
        e.preventDefault();
        const { viewport } = s;
        const id = createCard({ kind: 'note', title: t('card.newTitle') }, screenToWorld(viewport.w / 2, viewport.h / 2 - 40));
        openWindow('detail', [id], { focusTitle: true });
      } else if (/^[1-6]$/.test(e.key) && !mod && edit) {
        const preset = AXIS_PRESETS[Number(e.key) - 1];
        if (preset) {
          const ids = preset.axes.map((k) => ensureConcept(k));
          applyAxes({ x: ids[0], y: ids[1], z: ids[2] });
        }
      } else if (e.key === '?') {
        toggleToolWindow('help');
      } else if (e.key === 'Enter' && s.selection.length === 1) {
        openWindow('detail', s.selection);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && panState.space) {
        panState.space = false;
        window.dispatchEvent(new Event('panstate'));
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}

function Shell() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const ready = useStore((s) => s.ready);
  return (
    <div className={`app ${sidebarOpen ? '' : 'no-sidebar'}`}>
      <Sidebar />
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => set({ sidebarOpen: false })} />}
      <main className="main">
        <TopBar />
        <ShareUnavailable />

        <ReadOnlyBanner />
        <div className="stage">
          <Canvas />
          {!ready && <div className="boot-veil">{t('common.loading')}</div>}
        </div>
      </main>
      <CommandPalette />
      <Toasts />
      <DragGhost />
    </div>
  );
}

export default function App() {
  useBoot();
  useTheme();
  useKeyboard();
  const { locale } = useI18n();
  // 言語を切り替えたら全体を描き直す（ストアの状態は保たれる）
  return <Shell key={locale} />;
}
