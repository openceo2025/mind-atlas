// AIアシスタント（左ナビ）の会話。スペースごとにずっと覚えておき、長くなったら古いやり取りを要約して
// 「記憶」に畳む。畳んだやり取りも画面には残し、AI には要約と、それ以降のやり取りだけを渡す。
// サークルメニューの「AIに質問」は、この会話を使わない（毎回まっさらな会話）。
import { idbGet, idbSet } from './idb';
import { compactConversation } from './ai';
import type { AiTurnMessage } from './service';

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

export interface AssistantLog {
  messages: AssistantTurn[];
  /** これより前のやり取りは summary に畳んである */
  compactedUpTo: number;
  summary: string;
  compactedAt?: number;
}

export const emptyLog = (): AssistantLog => ({ messages: [], compactedUpTo: 0, summary: '' });

/** AI に毎回送る会話の長さ（文字数）がこれを超えたら、圧縮を勧める */
export const SUGGEST_COMPACT_CHARS = 14000;
/** これを超えたら、裏で自動的に圧縮する */
export const AUTO_COMPACT_CHARS = 26000;
/** 圧縮しても、最後のこれだけのやり取りはそのまま残す */
const KEEP_TURNS = 4;

const key = (spaceId: string) => `assistant:${spaceId}`;

export async function loadAssistant(spaceId: string): Promise<AssistantLog> {
  if (!spaceId) return emptyLog();
  const saved = await idbGet<AssistantLog>('kv', key(spaceId)).catch(() => undefined);
  return saved?.messages ? { ...emptyLog(), ...saved } : emptyLog();
}

export async function saveAssistant(spaceId: string, log: AssistantLog) {
  if (!spaceId) return;
  await idbSet('kv', key(spaceId), log).catch(() => undefined);
}

/** AI に渡すやり取り（要約より後のもの） */
export function activeTurns(log: AssistantLog): AiTurnMessage[] {
  return log.messages.slice(log.compactedUpTo).map((m) => ({ role: m.role, content: m.content }));
}

/** AI に毎回送る会話の長さ */
export function activeChars(log: AssistantLog) {
  return log.summary.length + log.messages.slice(log.compactedUpTo).reduce((n, m) => n + m.content.length, 0);
}

/** 要約に畳めるやり取りがあるか */
export function canCompact(log: AssistantLog, keep = KEEP_TURNS) {
  return compactPoint(log, keep) > log.compactedUpTo;
}

/** 畳む境目。最後の keep 件は残し、境目は利用者の発言の直前にそろえる */
function compactPoint(log: AssistantLog, keep: number) {
  let cut = Math.max(log.compactedUpTo, log.messages.length - keep);
  while (cut > log.compactedUpTo && log.messages[cut]?.role !== 'user') cut -= 1;
  return cut;
}

/** 古いやり取りを要約に畳む。keep=0 なら全部を畳む（/compact を明示したとき） */
export async function compactLog(log: AssistantLog, opts: { keep?: number; instruction?: string } = {}): Promise<{ log: AssistantLog; folded: number }> {
  const keep = opts.keep ?? KEEP_TURNS;
  const cut = keep === 0 ? log.messages.length : compactPoint(log, keep);
  const turns = log.messages.slice(log.compactedUpTo, cut);
  if (!turns.length) return { log, folded: 0 };
  const summary = await compactConversation(log.summary, turns, opts.instruction);
  return { log: { ...log, summary: summary || log.summary, compactedUpTo: cut, compactedAt: Date.now() }, folded: turns.length };
}
