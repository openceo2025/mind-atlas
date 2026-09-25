// 旧 β（beta.mind-atlas.org）の端末内データを、新しい場所へ移す。
//
// ブラウザの保存領域はドメインごとに分かれているので、β で「この端末に保存」していた
// スペースは card.mind-atlas.org や mind-atlas.org からは読めない。β の画面から移し先を
// 新しい窓で開き、窓どうしのメッセージでスペースを手渡す（サーバーは通さない）。
// ログインしてクラウドに保存していたスペースは、どこからでも開けるので移す必要はない。
import type { Space } from '../types';

export const LEGACY_ORIGIN = 'https://beta.mind-atlas.org';
export const MOVE_TARGETS = {
  space: 'https://mind-atlas.org',
  card: 'https://card.mind-atlas.org',
} as const;
const MOVE_PARAM = 'import-from';
const MOVE_SOURCE = 'mind-atlas-legacy-move';

type MoveMessage =
  | { type: 'ready' }
  | { type: 'spaces'; spaces: Space[] }
  | { type: 'done'; moved: number; skipped: number };

const envelope = (message: MoveMessage) => ({ ...message, source: MOVE_SOURCE });

function read(event: MessageEvent): MoveMessage | null {
  const data = event.data as (MoveMessage & { source?: string }) | null;
  if (!data || typeof data !== 'object' || data.source !== MOVE_SOURCE) return null;
  return data;
}

export function isLegacyHost() {
  return window.location.origin === LEGACY_ORIGIN;
}

/** β の側：移し先を開き、準備ができたらこの端末のスペースを渡す */
export function sendSpacesTo(target: keyof typeof MOVE_TARGETS, spaces: Space[]): Promise<{ moved: number; skipped: number }> {
  const origin = MOVE_TARGETS[target];
  const win = window.open(`${origin}/card/?${MOVE_PARAM}=beta`, '_blank');
  if (!win) return Promise.reject(new Error('popup-blocked'));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('timeout'));
    }, 60_000);
    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.source !== win) return;
      const message = read(event);
      if (!message) return;
      if (message.type === 'ready') win!.postMessage(envelope({ type: 'spaces', spaces }), origin);
      if (message.type === 'done') {
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        resolve({ moved: message.moved, skipped: message.skipped });
      }
    }
    window.addEventListener('message', onMessage);
  });
}

/** 移し先の側：β から開かれたなら、スペースを受け取る */
export function isMoveTarget() {
  return new URLSearchParams(window.location.search).get(MOVE_PARAM) === 'beta' && Boolean(window.opener);
}

export function receiveSpaces(importOne: (space: Space) => Promise<boolean>): Promise<{ moved: number; skipped: number }> {
  return new Promise((resolve, reject) => {
    const opener = window.opener as Window | null;
    if (!opener) {
      reject(new Error('no-opener'));
      return;
    }
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('timeout'));
    }, 60_000);
    async function onMessage(event: MessageEvent) {
      if (event.origin !== LEGACY_ORIGIN || event.source !== opener) return;
      const message = read(event);
      if (!message || message.type !== 'spaces' || !Array.isArray(message.spaces)) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      let moved = 0;
      let skipped = 0;
      for (const space of message.spaces.slice(0, 500)) {
        try {
          if (await importOne(space)) moved += 1;
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      }
      opener!.postMessage(envelope({ type: 'done', moved, skipped }), LEGACY_ORIGIN);
      resolve({ moved, skipped });
    }
    window.addEventListener('message', onMessage);
    opener.postMessage(envelope({ type: 'ready' }), LEGACY_ORIGIN);
  });
}

export function clearMoveParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete(MOVE_PARAM);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
