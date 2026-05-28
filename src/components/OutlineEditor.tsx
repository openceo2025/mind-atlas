import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, ListTree, Plus, Save, Trash2, X } from "lucide-react";
import { CSSProperties, KeyboardEvent, useMemo, useRef, useState } from "react";
import {
  createOutlineDraftFromAtlas,
  findOutlineNodePath,
  indentOutlineNode,
  insertOutlineChild,
  insertOutlineSiblingAfter,
  moveOutlineSibling,
  outlineDraftToInput,
  OUTLINE_UNTITLED_TITLE,
  outdentOutlineNode,
  removeOutlineNode,
  updateOutlineNode,
  type OutlineDraftNode,
} from "../outline/atlasOutline";
import type { AtlasNode } from "../types";

type OutlineEditorProps = {
  root: AtlasNode;
  onCancel: () => void;
  onSave: (rootId: string, outline: ReturnType<typeof outlineDraftToInput>) => void;
};

export function OutlineEditor({ root, onCancel, onSave }: OutlineEditorProps) {
  const [draftRoot, setDraftRoot] = useState(() => createOutlineDraftFromAtlas(root));
  const [activeKey, setActiveKey] = useState(draftRoot.key);
  const activePath = useMemo(() => findOutlineNodePath(draftRoot, activeKey), [activeKey, draftRoot]);
  const activeDepth = activePath?.length ?? 0;

  const run = (operation: (root: OutlineDraftNode, key: string) => { root: OutlineDraftNode; key?: string } | OutlineDraftNode) => {
    setDraftRoot((current) => {
      const result = operation(current, activeKey);
      if ("root" in result) {
        if (result.key) setActiveKey(result.key);
        return result.root;
      }
      return result;
    });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Tab") {
      event.preventDefault();
      run((current, key) => (event.shiftKey ? outdentOutlineNode(current, key) : indentOutlineNode(current, key)));
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      run((current, key) => moveOutlineSibling(current, key, -1));
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      run((current, key) => moveOutlineSibling(current, key, 1));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      run((current, key) => (event.shiftKey ? insertOutlineChild(current, key) : insertOutlineSiblingAfter(current, key)));
    }
  };

  return (
    <div className="outline-editor-shell" onKeyDown={handleKeyDown}>
      <header className="outline-editor-header">
        <div>
          <span className="outline-editor-kicker">
            <ListTree size={16} /> Outline Editor
          </span>
          <h2>{root.title || OUTLINE_UNTITLED_TITLE}</h2>
        </div>
        <div className="outline-editor-actions">
          <button type="button" onClick={onCancel}>
            <X size={17} /> Cancel
          </button>
          <button className="is-primary" type="button" onClick={() => onSave(root.id, outlineDraftToInput(draftRoot))} aria-label="Save outline">
            <Save size={17} /> Save
          </button>
        </div>
      </header>

      <main className="outline-editor-body" aria-label="Mind Atlas outline editor">
        <OutlineNodeEditor
          node={draftRoot}
          depth={0}
          activeKey={activeKey}
          onActivate={setActiveKey}
          onUpdate={(key, patch) => setDraftRoot((current) => updateOutlineNode(current, key, (node) => ({ ...node, ...patch })))}
          onCommand={(command, key) => {
            setActiveKey(key);
            run((current) => runOutlineCommand(current, key, command));
          }}
        />
      </main>

      <nav className="outline-mobile-toolbar" aria-label="Outline edit controls">
        <button type="button" onClick={() => run((current, key) => outdentOutlineNode(current, key))} disabled={activeDepth <= 1} aria-label="Outdent node">
          <ArrowLeft size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => indentOutlineNode(current, key))} disabled={activeDepth === 0} aria-label="Indent node">
          <ArrowRight size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => moveOutlineSibling(current, key, -1))} disabled={activeDepth === 0} aria-label="Move node up">
          <ArrowUp size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => moveOutlineSibling(current, key, 1))} disabled={activeDepth === 0} aria-label="Move node down">
          <ArrowDown size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => insertOutlineSiblingAfter(current, key))} disabled={activeDepth === 0} aria-label="Add sibling node">
          <Plus size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => insertOutlineChild(current, key))} aria-label="Add child node">
          <Plus size={18} className="outline-toolbar-child-plus" />
        </button>
        <button className="is-primary" type="button" onClick={() => onSave(root.id, outlineDraftToInput(draftRoot))} aria-label="Save outline">
          <Check size={18} />
        </button>
      </nav>
    </div>
  );
}

function OutlineNodeEditor({
  node,
  depth,
  activeKey,
  onActivate,
  onUpdate,
  onCommand,
}: {
  node: OutlineDraftNode;
  depth: number;
  activeKey: string;
  onActivate: (key: string) => void;
  onUpdate: (key: string, patch: Partial<OutlineDraftNode>) => void;
  onCommand: (command: OutlineCommand, key: string) => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const isActive = activeKey === node.key;
  const hiddenCount = node.collapsed ? countDraftDescendants(node) : 0;
  const bodyHidden = node.collapsed;

  return (
    <section className={`outline-node-row ${isActive ? "is-active" : ""}`} data-depth={depth}>
      <div className="outline-title-row" onFocusCapture={() => onActivate(node.key)}>
        <div className="outline-indent-gutter" aria-hidden="true" style={{ "--outline-depth": depth } as CSSProperties} />
        <button
          className="outline-fold-button"
          type="button"
          onClick={() => onUpdate(node.key, { collapsed: !node.collapsed })}
          aria-label={node.collapsed ? "Show node body" : "Hide node body"}
        >
          {node.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <span className="outline-title-marker">#</span>
        <input
          value={node.title}
          onFocus={() => onActivate(node.key)}
          onChange={(event) => onUpdate(node.key, { title: event.target.value })}
          aria-label="Node title"
        />
        <div className="outline-line-actions">
          <button type="button" onClick={() => onCommand("outdent", node.key)} disabled={depth <= 1} aria-label="Outdent node">
            <ArrowLeft size={14} />
          </button>
          <button type="button" onClick={() => onCommand("indent", node.key)} disabled={depth === 0} aria-label="Indent node">
            <ArrowRight size={14} />
          </button>
          <button type="button" onClick={() => onCommand("up", node.key)} disabled={depth === 0} aria-label="Move node up">
            <ArrowUp size={14} />
          </button>
          <button type="button" onClick={() => onCommand("down", node.key)} disabled={depth === 0} aria-label="Move node down">
            <ArrowDown size={14} />
          </button>
          <button type="button" onClick={() => onCommand("sibling", node.key)} disabled={depth === 0} aria-label="Add sibling">
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => onCommand("child", node.key)} aria-label="Add child">
            <Plus size={14} />
          </button>
          <button type="button" onClick={() => onCommand("delete", node.key)} disabled={depth === 0} aria-label="Delete node">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {node.collapsed ? (
        <div className="outline-collapsed-note" style={{ "--outline-depth": depth } as CSSProperties}>
          body hidden{hiddenCount ? ` / ${hiddenCount} child node${hiddenCount === 1 ? "" : "s"} still editable` : ""}
        </div>
      ) : null}
      <>
        {bodyHidden ? null : (
          <div className="outline-body-row" onFocusCapture={() => onActivate(node.key)}>
            <div className="outline-indent-gutter" aria-hidden="true" style={{ "--outline-depth": depth } as CSSProperties} />
            <textarea
              ref={bodyRef}
              value={node.body}
              onFocus={() => onActivate(node.key)}
              onChange={(event) => onUpdate(node.key, { body: event.target.value })}
              onInput={() => autoSizeTextarea(bodyRef.current)}
              onBlur={() => autoSizeTextarea(bodyRef.current)}
              placeholder="Body"
              aria-label="Node body"
              rows={Math.max(2, node.body.split("\n").length)}
            />
          </div>
        )}
        <div className={`outline-children ${bodyHidden ? "is-title-only" : ""}`}>
          {node.children.map((child) => (
            <OutlineNodeEditor
              key={child.key}
              node={child}
              depth={depth + 1}
              activeKey={activeKey}
              onActivate={onActivate}
              onUpdate={onUpdate}
              onCommand={onCommand}
            />
          ))}
        </div>
      </>
    </section>
  );
}

type OutlineCommand = "indent" | "outdent" | "up" | "down" | "sibling" | "child" | "delete";

function runOutlineCommand(root: OutlineDraftNode, key: string, command: OutlineCommand): { root: OutlineDraftNode; key?: string } | OutlineDraftNode {
  switch (command) {
    case "indent":
      return indentOutlineNode(root, key);
    case "outdent":
      return outdentOutlineNode(root, key);
    case "up":
      return moveOutlineSibling(root, key, -1);
    case "down":
      return moveOutlineSibling(root, key, 1);
    case "sibling":
      return insertOutlineSiblingAfter(root, key);
    case "child":
      return insertOutlineChild(root, key);
    case "delete":
      return removeOutlineNode(root, key);
  }
}

function countDraftDescendants(node: OutlineDraftNode): number {
  return node.children.reduce((count, child) => count + 1 + countDraftDescendants(child), 0);
}

function autoSizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}
