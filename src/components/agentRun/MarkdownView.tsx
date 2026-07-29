// Structural Markdown renderer for agent answers.
//
// Mode: local-only (Agent Run Workspace).
//
// The parser in `src/agentRuntime/markdown.ts` produces a closed node union and
// this component maps it to React elements. There is no `dangerouslySetInnerHTML`
// anywhere in this file, so provider output can never inject markup. Unsafe
// link schemes are rendered as plain text with an explicit note.

import { Fragment, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import {
  parseMarkdown,
  parseUnifiedDiff,
  type MarkdownBlock,
  type MarkdownInline,
} from "../../agentRuntime/markdown";

const LONG_CODE_LINES = 24;

export function MarkdownView({ source, emptyLabel = "" }: { source: string; emptyLabel?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (!source.trim()) {
    return emptyLabel ? <p className="agent-md-empty">{emptyLabel}</p> : null;
  }
  return (
    <div className="agent-md">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case "heading": {
      const depth = Math.min(6, Math.max(1, block.depth));
      const Tag = (`h${depth}`) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className={`agent-md-heading agent-md-h${depth}`}>
          <InlineView nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="agent-md-paragraph">
          <InlineView nodes={block.children} />
        </p>
      );
    case "code":
      return <CodeBlock lang={block.lang} value={block.value} />;
    case "diff":
      return <DiffBlock value={block.value} />;
    case "blockquote":
      return (
        <blockquote className="agent-md-quote">
          {block.blocks.map((child, index) => (
            <BlockView key={index} block={child} />
          ))}
        </blockquote>
      );
    case "thematicBreak":
      return <hr className="agent-md-rule" />;
    case "list":
      return block.ordered ? (
        <ol className="agent-md-list" start={block.start}>
          {block.items.map((item, index) => (
            <ListItemView key={index} item={item} />
          ))}
        </ol>
      ) : (
        <ul className="agent-md-list">
          {block.items.map((item, index) => (
            <ListItemView key={index} item={item} />
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="agent-md-table-scroll">
          <table className="agent-md-table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                    <InlineView nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                      <InlineView nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

function ListItemView({ item }: { item: { checked: boolean | null; blocks: MarkdownBlock[] } }) {
  return (
    <li className={item.checked === null ? "agent-md-item" : "agent-md-item agent-md-task"}>
      {item.checked === null ? null : (
        <input type="checkbox" checked={item.checked} readOnly aria-hidden tabIndex={-1} />
      )}
      <div className="agent-md-item-body">
        {item.blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
      </div>
    </li>
  );
}

function InlineView({ nodes }: { nodes: MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <Fragment key={index}>{node.value}</Fragment>;
          case "code":
            return (
              <code key={index} className="agent-md-inline-code">
                {node.value}
              </code>
            );
          case "strong":
            return (
              <strong key={index}>
                <InlineView nodes={node.children} />
              </strong>
            );
          case "emphasis":
            return (
              <em key={index}>
                <InlineView nodes={node.children} />
              </em>
            );
          case "strike":
            return (
              <s key={index}>
                <InlineView nodes={node.children} />
              </s>
            );
          case "fileRef":
            return (
              <span key={index} className="agent-md-file-ref" title={node.path}>
                {node.path}
                {node.line === null ? "" : `:${node.line}`}
              </span>
            );
          case "link":
            if (!node.safe) {
              // Blocked scheme: show the text, never a clickable target.
              return (
                <span key={index} className="agent-md-link-blocked" title="Blocked link scheme">
                  <InlineView nodes={node.children} /> (blocked link)
                </span>
              );
            }
            return (
              <a
                key={index}
                className="agent-md-link"
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                title={node.href}
              >
                <InlineView nodes={node.children} />
              </a>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const lines = value.split("\n");
  const long = lines.length > LONG_CODE_LINES;
  const [expanded, setExpanded] = useState(!long);
  const shown = expanded ? lines : lines.slice(0, LONG_CODE_LINES);
  return (
    <div className="agent-md-code">
      <div className="agent-md-code-head">
        <span className="agent-md-code-lang">{lang || "text"}</span>
        <div className="agent-md-code-actions">
          {long ? (
            <button type="button" className="agent-md-mini" onClick={() => setExpanded((current) => !current)}>
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {expanded ? "Collapse" : `Show all ${lines.length} lines`}
            </button>
          ) : null}
          <CopyButton value={value} />
        </div>
      </div>
      <pre className="agent-md-pre">
        <code>{shown.join("\n")}</code>
      </pre>
      {expanded || !long ? null : <div className="agent-md-code-more">{lines.length - LONG_CODE_LINES} more lines</div>}
    </div>
  );
}

export function DiffBlock({ value }: { value: string }) {
  const lines = useMemo(() => parseUnifiedDiff(value), [value]);
  if (!value.trim()) return null;
  return (
    <div className="agent-md-code agent-diff">
      <div className="agent-md-code-head">
        <span className="agent-md-code-lang">unified diff</span>
        <CopyButton value={value} />
      </div>
      <pre className="agent-md-pre">
        {lines.map((line, index) => (
          <div key={index} className={`agent-diff-line agent-diff-${line.kind}`}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="agent-md-mini"
      onClick={async () => {
        try {
          // Copies the Markdown/diff source, never the rendered output.
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}
