import { t } from '../i18n';
import { get, toast } from './core';
import { toggleToolWindow } from './ui';

export type AiBlock = 'login' | 'subscribe' | 'credit' | 'bridge' | 'readonly';

/** AI（LLM）を使えるか。使えない理由も返す */
export function aiBlock(): AiBlock | null {
  const s = get();
  if (s.readOnly) return 'readonly';
  const session = s.session;
  if (session.mode === 'local') return session.bridgeOnline ? null : 'bridge';
  if (!session.authenticated) return 'login';
  if (!session.subscriptionActive) return 'subscribe';
  if (!session.aiEnabled) return 'credit';
  return null;
}

export function aiBlockMessage(block: AiBlock) {
  return t(`ai.block.${block}` as 'ai.block.login');
}

/** AI が使えなければ案内を出して false を返す */
export function requireAi() {
  const block = aiBlock();
  if (!block) return true;
  toast(aiBlockMessage(block), { tone: 'error', ms: 4500 });
  if (block === 'login' || block === 'subscribe' || block === 'credit') toggleToolWindow('account');
  return false;
}
