import type { Card, Space } from '../types';
import { relSentence } from './relStyle';

export function download(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60) || 'space';

export function exportJson(space: Space) {
  const { cloudId: _c, cloudUpdatedAt: _u, readOnly: _r, shareToken: _s, ...rest } = space;
  download(`${safeName(space.title)}.mindatlas-space.json`, JSON.stringify(rest, null, 2));
}

export function exportMarkdown(space: Space) {
  const cards = Object.values(space.cards).filter((c) => c.kind !== 'concept' && c.place !== 'library');
  const byId = space.cards;
  const lines = [`# ${space.title}`, ''];
  for (const c of cards) {
    lines.push(`## ${c.title}`);
    if (c.subtitle) lines.push(`_${c.subtitle}_`);
    if (c.tags.length) lines.push(c.tags.map((t) => `#${t}`).join(' '));
    if (c.url) lines.push(c.url);
    if (c.body) lines.push('', c.body);
    const rels = space.relations.filter((r) => r.from === c.id && byId[r.to]);
    if (rels.length) {
      lines.push('');
      for (const r of rels) lines.push(`- ${relSentence(r, { from: c.title, to: byId[r.to].title })}${r.label ? ` (${r.label})` : ''}`);
    }
    lines.push('');
  }
  download(`${safeName(space.title)}.md`, lines.join('\n'), 'text/markdown');
}

export type ImportDraft = Partial<Card> & { title: string; parent?: number };

/**
 * テキスト／Markdown をカードに分ける。
 * 見出しは親子（包含）関係をつくり、箇条書きは1項目1枚、段落は1段落1枚にする。
 */
export function parseText(text: string): ImportDraft[] {
  const drafts: ImportDraft[] = [];
  const stack: { level: number; index: number }[] = [];
  let para: string[] = [];
  const parentIndex = () => stack[stack.length - 1]?.index;
  const flushPara = () => {
    const body = para.join('\n').trim();
    para = [];
    if (!body) return;
    const first = body.split('\n')[0];
    drafts.push({ kind: 'note', title: first.length > 70 ? `${first.slice(0, 70)}…` : first, body: body.length > first.length ? body : '', parent: parentIndex() });
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      drafts.push({ kind: level === 1 ? 'topic' : 'note', title: h[2].trim(), parent: parentIndex() });
      stack.push({ level, index: drafts.length - 1 });
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*・•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flushPara();
      const content = bullet[1].trim();
      drafts.push({ kind: 'note', title: content.length > 70 ? `${content.slice(0, 70)}…` : content, body: content.length > 70 ? content : '', parent: parentIndex() });
      continue;
    }
    if (!line.trim()) flushPara();
    else para.push(line);
  }
  flushPara();
  return drafts.slice(0, 300);
}

export async function readFileText(file: File) {
  return await file.text();
}
