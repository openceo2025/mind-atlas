// マインドアトラス（スペース）の中に埋め込まれたときの窓口。
// 惑星（ノード）に入り込むと、宇宙側がこのアプリを同じオリジンの iframe で開き、
// ここを通して「どの惑星を開くか」「宇宙へ戻る」をやり取りする。
import {
  CARD_EMBED_PARAM,
  CARD_EMBED_VALUE,
  postPlanetMessage,
  readPlanetMessage,
  type CardToUniverseMessage,
  type UniverseToCardMessage,
} from '../../../src/planet/cardBridge';

function detectEmbedded() {
  try {
    if (window.parent === window) return false;
    if (new URLSearchParams(window.location.search).get(CARD_EMBED_PARAM) !== CARD_EMBED_VALUE) return false;
    // 別オリジンの親には従わない（読めなければ例外になる）
    return window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** 宇宙の中で開かれているか */
export const EMBEDDED = detectEmbedded();

export function postToUniverse(message: CardToUniverseMessage) {
  if (!EMBEDDED) return;
  postPlanetMessage(window.parent, message);
}

export function onUniverseMessage(handler: (message: UniverseToCardMessage) => void) {
  const listener = (event: MessageEvent) => {
    const message = readPlanetMessage<UniverseToCardMessage>(event, window.parent);
    if (message) handler(message);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * 単独で開いたとき（card.mind-atlas.org など）に、マインドアトラス（スペース）を開く先。
 * カード専用のホストからは本体のドメインへ、同じオリジンで配信されているときはその入口へ。
 */
export function spaceAppUrl() {
  const host = window.location.hostname;
  if (host === 'card.mind-atlas.org' || host === 'beta.mind-atlas.org') return 'https://mind-atlas.org/';
  return '/';
}

/** 配信のベースパス（例：/card/）。共有リンクの組み立てと読み取りに使う */
export const APP_BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');
