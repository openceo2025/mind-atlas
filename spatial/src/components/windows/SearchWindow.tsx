import { useState } from 'react';
import { addRelationRaw, createCard, get, lookup, requireAi, toast, updateWindowData, useStore } from '../../store';
import { webSearch, type WebSearchResult } from '../../lib/service';
import { t } from '../../i18n';
import type { FloatWin } from '../../types';
import { Icon } from '../Icons';
import { AiNotice, Spinner, useAiBlock } from './common';
import { Markdownish } from './Markdownish';
import { RequestCancelled, confirmRequestCost, reportUsage } from '../../lib/cost';

/** Web 検索して、結果と出典をカードとして空間に置く */
export function SearchWindow({ win }: { win: FloatWin }) {
  const readOnly = useStore((s) => s.readOnly);
  const [query, setQuery] = useState((win.data?.query as string) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = win.data?.result as (WebSearchResult & { query: string }) | undefined;
  const block = useAiBlock();
  const result0 = win.data?.result as { about?: string[] } | undefined;
  // 結果をカードにしたら、検索したときに選んでいたカードとつなぐ
  const contextIds = win.cardIds.length ? win.cardIds : result0?.about ?? [];

  const run = async () => {
    const q = query.trim();
    if (!q || !requireAi()) return;
    setBusy(true);
    setError('');
    try {
      // 入力された文は、そのまま検索語になる。「これ」「こっち」が何を指すか分かるよう、
      // 選んでいるカードがあれば背景として添える（検索するのは入力した問いのほう）
      const about = get()
        .selection.map((id) => lookup(id))
        .filter((c) => c && c.kind !== 'concept')
        .slice(0, 4) as NonNullable<ReturnType<typeof lookup>>[];
      const background = about.map((c) => `- ${c.title}${c.body ? `: ${c.body.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`).join('\n');
      const input = background ? `${q}\n\n---\nBackground (the user's own notes, only to understand what the question refers to; search for the question above):\n${background}`.slice(0, 990) : q;
      await confirmRequestCost({ chars: input.length, outputTokens: 512 });
      const r = await webSearch(input);
      reportUsage(r.usage);
      updateWindowData(win.id, { result: { ...r, query: q, about: about.map((c) => c.id) }, query: q });
    } catch (e) {
      // やめたのはエラーではない
      if (!(e instanceof RequestCancelled)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sources = result ? [...(result.citations ?? []), ...(result.sources ?? [])].filter((s, i, arr) => s.url && arr.findIndex((x) => x.url === s.url) === i) : [];

  const saveResult = () => {
    if (!result) return;
    const id = createCard({
      kind: 'article',
      title: result.query,
      subtitle: t('search.cardSubtitle'),
      body: [result.text, ...sources.slice(0, 6).map((s) => `- ${s.title ?? s.url}: ${s.url}`)].join('\n'),
      tags: ['web'],
      url: sources[0]?.url,
      createdBy: 'ai',
    });
    contextIds.forEach((cid) => lookup(cid) && addRelationRaw(cid, id, 'related'));
    toast(t('search.saved'));
  };

  const saveSource = (s: { url: string; title?: string }) => {
    const id = createCard({ kind: 'link', title: s.title || s.url, url: s.url, subtitle: new URL(s.url).hostname, tags: ['web'], createdBy: 'ai' });
    contextIds.forEach((cid) => lookup(cid) && addRelationRaw(cid, id, 'related'));
  };

  return (
    <>
      <div className="fwin-body">
        <div className="row-gap">
          <input
            className="input"
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.stopPropagation();
              void run();
            }}
            autoFocus
          />
          <button className="btn primary" disabled={!query.trim() || busy || Boolean(block)} onClick={() => void run()}>
            <Icon name="search" size={14} />
          </button>
        </div>
        {block && <AiNotice block={block} compact />}
        {busy && <Spinner label={t('search.searching')} />}
        {error && <div className="ai-note warn">{error}</div>}
        {result && !busy && (
          <>
            <div className="sec-title">{t('search.result', { query: result.query })}</div>
            <Markdownish text={result.text} />
            {sources.length > 0 && (
              <>
                <div className="sec-title">{t('search.sources', { n: sources.length })}</div>
                {sources.slice(0, 8).map((s) => (
                  <div key={s.url} className="src-row">
                    <Icon name="link" size={14} />
                    <a className="ellipsis" href={/^https?:\/\//.test(s.url) ? s.url : undefined} target="_blank" rel="noreferrer noopener">
                      {s.title || s.url}
                    </a>
                    {!readOnly && (
                      <button className="btn small ghost" onClick={() => saveSource(s)} title={t('search.saveSource')}>
                        <Icon name="plus" size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
      {result && !readOnly && (
        <div className="fwin-foot">
          <button className="btn small primary" style={{ marginInlineStart: 'auto' }} onClick={saveResult}>
            <Icon name="plus" size={12} /> {t('search.saveResult')}
          </button>
        </div>
      )}
    </>
  );
}
