import { Fragment, type ReactElement } from 'react';

/** AI の回答を読みやすく表示する最小限の Markdown（見出し・箇条書き・太字・リンク） */
export function Markdownish({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactElement[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    out.push(
      <ul key={`ul-${out.length}`}>
        {list.map((l, i) => (
          <li key={i}>{inline(l)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*・]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(<h4 key={i}>{inline(h[1])}</h4>);
    else out.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="md">{out}</div>;
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      );
    if (/^https?:\/\//.test(p))
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer noopener">
          {p}
        </a>
      );
    return <Fragment key={i}>{p}</Fragment>;
  });
}
