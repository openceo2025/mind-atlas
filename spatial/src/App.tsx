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
  openPlanet,
  importMovedSpace,
  loadSpaceIndex,
  openSharedSpace,
  openWindow,
  announceFiredReminders,
  startReminderTicker,
  redo,
  refreshSession,
  saveNow,
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
import { normalizeLocale, setLocale, t, useI18n, getLocale } from './i18n';
import { APP_BASE, EMBEDDED, onUniverseMessage, postToUniverse } from './lib/embed';
import type { UniverseToCardMessage } from '../../src/planet/cardBridge';
import { Canvas } from './components/Canvas';
import { CardMenu, CostConfirm, DragGhost, LegacyMoveBanner, ReadOnlyBanner, ShareUnavailable, Sidebar, Toasts, TopBar } from './components/Chrome';
import { clearMoveParam, isMoveTarget, receiveSpaces } from './lib/legacyMove';
import { CommandPalette } from './components/CommandPalette';
import { panState } from './components/panState';

const THEME_KEY = 'mindatlas-spatial-theme';

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

/** 焦点が空間そのものにあるか（ボタンや窓の中に残っていないか） */
const onCanvas = () => {
  const el = document.activeElement as HTMLElement | null;
  return !el || el === document.body || el.classList.contains('canvas') || el.tagName === 'MAIN';
};

function shareTokenFromUrl() {
  const path = APP_BASE && window.location.pathname.startsWith(`${APP_BASE}/`) ? window.location.pathname.slice(APP_BASE.length) : window.location.pathname;
  const m = path.match(/^\/s\/([A-Za-z0-9_-]{8,})\/?$/);
  if (m) return m[1];
  return new URLSearchParams(window.location.search).get('share');
}

/** 宇宙からの設定（言語・背景）を、この画面に写す */
function applyUniverseSettings(message: { locale?: string; theme?: 'dark' | 'light' }) {
  const locale = normalizeLocale(message.locale);
  if (locale && locale !== getLocale()) void setLocale(locale);
  if (message.theme === 'dark' || message.theme === 'light') set({ theme: message.theme });
}

/**
 * 宇宙の中に埋め込まれたときの起動。スペース一覧から前回の空間を開くのではなく、
 * 宇宙が「この惑星を開いて」と言うのを待つ。惑星を開き終えたら宇宙に知らせ、
 * 宇宙はそこでホワイトアウトを晴らす。
 */
function useEmbeddedBoot() {
  useEffect(() => {
    if (!EMBEDDED) return;
    let queue = Promise.resolve();
    const handle = (message: UniverseToCardMessage) => {
      if (message.type === 'settings') {
        applyUniverseSettings(message);
        return;
      }
      if (message.type === 'reminders-fired') {
        announceFiredReminders(message.entries);
        return;
      }
      if (message.type !== 'open-planet') return;
      applyUniverseSettings(message);
      const planet = message.planet;
      // 続けて別の惑星に入ったときも、順番に開く
      queue = queue.then(async () => {
        try {
          const spaceId = await openPlanet(planet);
          postToUniverse({ type: 'planet-opened', planetId: planet.planetId, spaceId });
          if (get().session.authenticated && get().cloudId === undefined) void saveToCloud();
        } catch (error) {
          postToUniverse({ type: 'planet-failed', planetId: planet.planetId, message: error instanceof Error ? error.message : String(error) });
          toastError(error);
        }
      });
    };
    const stop = onUniverseMessage(handle);
    void refreshSession().finally(() => postToUniverse({ type: 'card-ready' }));
    const onSession = () => void refreshSession();
    window.addEventListener(SESSION_CHANGED_EVENT, onSession);
    return () => {
      stop();
      window.removeEventListener(SESSION_CHANGED_EVENT, onSession);
    };
  }, []);
}

function useBoot() {
  useEffect(() => {
    if (EMBEDDED) return;
    let cancelled = false;
    const stopTicker = startReminderTicker();
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
          window.history.replaceState(null, '', `${APP_BASE}/`);
          set({ shareUnavailable: true, ready: true });
          return;
        }
      }
      await bootSpaces();
      if (isMoveTarget()) {
        // 旧 β の画面から開かれた：この端末のスペースを受け取る
        void receiveSpaces(importMovedSpace)
          .then(async ({ moved }) => {
            await loadSpaceIndex();
            toast(t('move.received', { n: moved }));
          })
          .catch(() => toast(t('move.failed'), { tone: 'error', ms: 6000 }))
          .finally(clearMoveParam);
      }
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
      stopTicker();
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
      // 書いている途中でも効く。保存は自動だが、押した手にはすぐ答える
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (typing(e) || s.paletteOpen) return;
      // 日本語入力の途中（変換前の文字）は、空間の操作にしない（N で新しいカードができてしまう）
      if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
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
      } else if (e.key === 'Enter' && s.selection.length === 1 && onCanvas()) {
        // ボタンに焦点が残っているときの Enter は、そのボタンを押すためのもの。
        // 空間そのものを見ているときだけ、選んだカードを開く。
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
        <LegacyMoveBanner />
        <div className="stage">
          <Canvas />
          {!ready && <div className="boot-veil">{t('common.loading')}</div>}
        </div>
      </main>
      <CommandPalette />
      <CardMenu />
      <CostConfirm />
      <Toasts />
      <DragGhost />
    </div>
  );
}

export default function App() {
  useBoot();
  useEmbeddedBoot();
  useTheme();
  useKeyboard();
  const { locale } = useI18n();
  // 言語を切り替えたら全体を描き直す（ストアの状態は保たれる）
  return <Shell key={locale} />;
}
