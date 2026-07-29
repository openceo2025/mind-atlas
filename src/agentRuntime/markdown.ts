// Minimal CommonMark + GFM parser used by the Agent Run Workspace.
//
// Why a local parser instead of a Markdown-to-HTML library:
// the renderer never produces an HTML string, so there is no `innerHTML` path
// and therefore no sanitizer to get wrong. Raw HTML in provider output is
// treated as literal text. Only the block/inline node types listed below can
// ever be produced.

export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "emphasis"; children: MarkdownInline[] }
  | { type: "strike"; children: MarkdownInline[] }
  | { type: "link"; href: string; safe: boolean; children: MarkdownInline[] }
  | { type: "fileRef"; path: string; line: number | null };

export type MarkdownBlock =
  | { type: "heading"; depth: number; children: MarkdownInline[] }
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "code"; lang: string; value: string }
  | { type: "diff"; value: string }
  | { type: "blockquote"; blocks: MarkdownBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { type: "table"; header: MarkdownInline[][]; align: Array<"left" | "center" | "right" | null>; rows: MarkdownInline[][][] }
  | { type: "thematicBreak" };

export interface MarkdownListItem {
  checked: boolean | null;
  blocks: MarkdownBlock[];
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const MAX_INPUT_CHARS = 400_000;

/** `path/to/file.ts:42` or `src\\file.tsx:12:3` inside plain text. */
const FILE_REF = /((?:[A-Za-z]:)?[\w.\-/\\]*[\w.-]+\.[A-Za-z0-9]{1,8})(?::(\d+))(?::\d+)?/;

export function parseMarkdown(input: string): MarkdownBlock[] {
  const source = String(input ?? "").slice(0, MAX_INPUT_CHARS).replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const lang = fence[2] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index];
        const closing = new RegExp(`^\\s{0,3}${marker === "`" ? "`" : "~"}{${length},}\\s*$`);
        if (closing.test(candidate)) {
          index += 1;
          break;
        }
        body.push(candidate);
        index += 1;
      }
      const value = body.join("\n");
      const normalizedLang = lang.toLowerCase();
      blocks.push(normalizedLang === "diff" || normalizedLang === "patch"
        ? { type: "diff", value }
        : { type: "code", lang, value });
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", depth: heading[1].length, children: parseInline(heading[2].replace(/\s+#+\s*$/, "")) });
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "thematicBreak" });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && (/^\s{0,3}>/.test(lines[index]) || (lines[index].trim() && quoted.length))) {
        if (!/^\s{0,3}>/.test(lines[index]) && !lines[index].trim()) break;
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", blocks: parseBlocks(quoted) });
      continue;
    }

    const table = tryParseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d{1,9}[.)])\s+/.exec(line);
    if (listMatch) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      if (!candidate.trim()) break;
      if (/^\s{0,3}(`{3,}|~{3,})/.test(candidate)) break;
      if (/^\s{0,3}#{1,6}\s+/.test(candidate)) break;
      if (/^\s{0,3}>/.test(candidate)) break;
      if (/^(\s*)([-*+]|\d{1,9}[.)])\s+/.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }

  return blocks;
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; nextIndex: number } {
  const first = /^(\s*)([-*+]|\d{1,9}[.)])\s+/.exec(lines[start]);
  const ordered = !/^[-*+]$/.test(first?.[2] ?? "-");
  const startNumber = ordered ? Number.parseInt(first?.[2] ?? "1", 10) || 1 : 1;
  const items: MarkdownListItem[] = [];
  let index = start;
  let current: string[] | null = null;
  let currentChecked: boolean | null = null;

  const flush = () => {
    if (current === null) return;
    items.push({ checked: currentChecked, blocks: parseBlocks(current) });
    current = null;
    currentChecked = null;
  };

  while (index < lines.length) {
    const line = lines[index];
    const marker = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (marker) {
      const isOrdered = !/^[-*+]$/.test(marker[2]);
      if (isOrdered !== ordered && current !== null) break;
      flush();
      let content = marker[3];
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(content);
      if (task) {
        currentChecked = task[1].toLowerCase() === "x";
        content = task[2];
      }
      current = [content];
      index += 1;
      continue;
    }
    if (!line.trim()) {
      const next = lines[index + 1] ?? "";
      if (/^(\s*)([-*+]|\d{1,9}[.)])\s+/.test(next) || /^\s{2,}\S/.test(next)) {
        current?.push("");
        index += 1;
        continue;
      }
      break;
    }
    if (/^\s{2,}\S/.test(line) && current) {
      current.push(line.replace(/^\s{2}/, ""));
      index += 1;
      continue;
    }
    if (current) {
      current.push(line);
      index += 1;
      continue;
    }
    break;
  }
  flush();
  return { block: { type: "list", ordered, start: startNumber, items }, nextIndex: index };
}

function tryParseTable(lines: string[], start: number): { block: MarkdownBlock; nextIndex: number } | null {
  const headerLine = lines[start];
  const dividerLine = lines[start + 1];
  if (!headerLine?.includes("|") || !dividerLine) return null;
  const dividerCells = splitTableRow(dividerLine);
  if (!dividerCells.length || !dividerCells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()))) return null;

  const headerCells = splitTableRow(headerLine);
  if (headerCells.length !== dividerCells.length) return null;

  const align = dividerCells.map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) return "center" as const;
    if (right) return "right" as const;
    if (left) return "left" as const;
    return null;
  });

  const rows: MarkdownInline[][][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    const cells = splitTableRow(lines[index]);
    rows.push(cells.map((cell) => parseInline(cell.trim())));
    index += 1;
  }

  return {
    block: { type: "table", header: headerCells.map((cell) => parseInline(cell.trim())), align, rows },
    nextIndex: index,
  };
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function parseInline(input: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = "";
  let index = 0;
  const source = String(input ?? "");

  const flush = () => {
    if (!buffer) return;
    nodes.push(...splitFileReferences(buffer));
    buffer = "";
  };

  while (index < source.length) {
    const char = source[index];

    if (char === "\\" && index + 1 < source.length) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    if (char === "`") {
      const fence = /^`+/.exec(source.slice(index))?.[0] ?? "`";
      const closeIndex = source.indexOf(fence, index + fence.length);
      if (closeIndex > 0) {
        flush();
        nodes.push({ type: "code", value: source.slice(index + fence.length, closeIndex) });
        index = closeIndex + fence.length;
        continue;
      }
    }

    if (char === "[") {
      const link = matchLink(source, index);
      if (link) {
        flush();
        nodes.push(link.node);
        index = link.nextIndex;
        continue;
      }
    }

    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      const marker = source.slice(index, index + 2);
      const closeIndex = source.indexOf(marker, index + 2);
      if (closeIndex > index + 2) {
        flush();
        nodes.push({ type: "strong", children: parseInline(source.slice(index + 2, closeIndex)) });
        index = closeIndex + 2;
        continue;
      }
    }

    if (source.startsWith("~~", index)) {
      const closeIndex = source.indexOf("~~", index + 2);
      if (closeIndex > index + 2) {
        flush();
        nodes.push({ type: "strike", children: parseInline(source.slice(index + 2, closeIndex)) });
        index = closeIndex + 2;
        continue;
      }
    }

    if ((char === "*" || char === "_") && source[index + 1] !== char) {
      const closeIndex = source.indexOf(char, index + 1);
      if (closeIndex > index + 1 && source[closeIndex - 1] !== " ") {
        flush();
        nodes.push({ type: "emphasis", children: parseInline(source.slice(index + 1, closeIndex)) });
        index = closeIndex + 1;
        continue;
      }
    }

    if (char === "<") {
      const autolink = /^<((?:https?|mailto):[^\s>]+)>/.exec(source.slice(index));
      if (autolink) {
        flush();
        nodes.push({ type: "link", href: autolink[1], safe: isSafeHref(autolink[1]), children: [{ type: "text", value: autolink[1] }] });
        index += autolink[0].length;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

function matchLink(source: string, start: number) {
  let depth = 0;
  let index = start;
  for (; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "[") depth += 1;
    else if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || source[index + 1] !== "(") return null;
  const closeParen = source.indexOf(")", index + 2);
  if (closeParen < 0) return null;
  const label = source.slice(start + 1, index);
  const target = source.slice(index + 2, closeParen).trim().split(/\s+/)[0] ?? "";
  return {
    node: { type: "link", href: target, safe: isSafeHref(target), children: parseInline(label) } as MarkdownInline,
    nextIndex: closeParen + 1,
  };
}

/**
 * `javascript:`, `data:` and every other unexpected scheme is blocked. Relative
 * links are allowed because the workspace resolves them as workspace paths.
 */
export function isSafeHref(href: string) {
  const value = String(href ?? "").trim();
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      return SAFE_PROTOCOLS.has(new URL(value).protocol);
    } catch {
      return false;
    }
  }
  return !value.startsWith("//");
}

function splitFileReferences(value: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let rest = value;
  for (let guard = 0; guard < 200; guard += 1) {
    const match = FILE_REF.exec(rest);
    if (!match || match.index === undefined) break;
    if (match.index > 0) nodes.push({ type: "text", value: rest.slice(0, match.index) });
    nodes.push({ type: "fileRef", path: match[1], line: match[2] ? Number.parseInt(match[2], 10) : null });
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) nodes.push({ type: "text", value: rest });
  return nodes.length ? nodes : [{ type: "text", value }];
}

export interface DiffLine {
  kind: "meta" | "hunk" | "add" | "remove" | "context";
  text: string;
}

/** Split a unified diff into typed lines for structural rendering. */
export function parseUnifiedDiff(value: string): DiffLine[] {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) return { kind: "hunk" as const, text: line };
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
        return { kind: "meta" as const, text: line };
      }
      if (line.startsWith("+")) return { kind: "add" as const, text: line };
      if (line.startsWith("-")) return { kind: "remove" as const, text: line };
      return { kind: "context" as const, text: line };
    });
}

export function summarizeDiff(value: string) {
  const files = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const line of parseUnifiedDiff(value)) {
    if (line.kind === "meta" && line.text.startsWith("+++ ")) {
      const path = line.text.slice(4).replace(/^b\//, "").trim();
      if (path && path !== "/dev/null") files.add(path);
    }
    if (line.kind === "add" && !line.text.startsWith("+++")) added += 1;
    if (line.kind === "remove" && !line.text.startsWith("---")) removed += 1;
  }
  return { files: [...files], added, removed };
}
