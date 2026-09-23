import { useEffect, useRef, useState } from 'react';
import { aiBlock, aiBlockMessage, toggleToolWindow, useStore, type AiBlock } from '../../store';
import { startLogin } from '../../lib/service';
import { t } from '../../i18n';
import { RequestCancelled } from '../../lib/cost';
import { Icon } from '../Icons';

/** AI が使えないときの案内（ログイン／購読／ブリッジ起動） */
export function AiNotice({ block, compact }: { block: AiBlock; compact?: boolean }) {
  return (
    <div className={`ai-note warn ${compact ? 'compact' : ''}`}>
      <Icon name="info" size={16} />
      <div style={{ flex: 1 }}>
        <div>{aiBlockMessage(block)}</div>
        {block === 'login' && (
          <button className="btn small primary" style={{ marginTop: 6 }} onClick={startLogin}>
            {t('account.login')}
          </button>
        )}
        {(block === 'subscribe' || block === 'credit') && (
          <button className="btn small primary" style={{ marginTop: 6 }} onClick={() => toggleToolWindow('account')}>
            {t('account.open')}
          </button>
        )}
      </div>
    </div>
  );
}

/** セッションや読み取り専用の変化に追従して、AI が使えない理由を返す */
export function useAiBlock() {
  useStore((s) => s.session);
  useStore((s) => s.readOnly);
  return aiBlock();
}

/** 依存が変わるたびに非同期処理を走らせ、結果・読み込み中・エラーを返す */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: enabled });
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false });
      return;
    }
    const n = ++seq.current;
    setState((s) => ({ data: s.data, loading: true }));
    fn()
      .then((data) => n === seq.current && setState({ data, loading: false }))
      .catch((e: unknown) => {
        if (n !== seq.current) return;
        // 確認ダイアログでやめたのはエラーではない
        if (e instanceof RequestCancelled) setState({ loading: false });
        else setState({ error: e instanceof Error ? e.message : String(e), loading: false });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  return state;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-row">
      <span className="spinner" />
      {label ?? t('common.thinking')}
    </div>
  );
}

/** AI が書いているように少しずつ表示する */
export function useTyping(text: string, key: unknown, speed = 14) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 2)), speed);
    return () => window.clearInterval(id);
  }, [text, key, speed]);
  return { shown: text.slice(0, n), done: n >= text.length };
}
