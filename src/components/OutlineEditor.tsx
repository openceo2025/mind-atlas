import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Copy,
  GitBranchPlus,
  ListPlus,
  ListTree,
  Trash2,
  X,
} from "lucide-react";
import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildContextCopy, CONTEXT_COPY_PRESETS, copyContextMarkdown, formatContextCopyStats, type ContextCopyPreset } from "../context/contextCopy";
import {
  createOutlineDraftFromAtlas,
  findOutlineNodePath,
  indentOutlineNode,
  insertOutlineChild,
  insertOutlineSiblingAfter,
  moveOutlineSibling,
  outlineDraftToInput,
  outdentOutlineNode,
  removeOutlineNode,
  updateOutlineNode,
  type OutlineDraftNode,
} from "../outline/atlasOutline";
import type { AtlasNode } from "../types";
import { I18nText } from "../i18n/I18nProvider";
import { formatAppMessage } from "../i18n/format";

type OutlineEditorProps = {
  root: AtlasNode;
  selectedNodeId: string;
  onClose: () => void;
  onFocusNode: (id: string) => void;
  onApplyOutline: (rootId: string, outline: ReturnType<typeof outlineDraftToInput>, options?: { focusKey?: string }) => void;
  onUpdateNodeLive: (id: string, patch: Partial<Pick<AtlasNode, "title" | "body" | "summary">>, options?: { history?: boolean }) => void;
};

export function OutlineEditor({ root, selectedNodeId, onClose, onFocusNode, onApplyOutline, onUpdateNodeLive }: OutlineEditorProps) {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [activeKey, setActiveKey] = useState(selectedNodeId);
  const [copyStatus, setCopyStatus] = useState("");
  const liveEditHistoryNodeIdsRef = useRef<Set<string>>(new Set());
  const draftRoot = useMemo(() => applyCollapsedState(createOutlineDraftFromAtlas(root), collapsedNodeIds), [collapsedNodeIds, root]);
  const collapseRootOnCollapseAll = root.kind !== "root";
  const activePath = useMemo(() => findOutlineNodePath(draftRoot, activeKey), [activeKey, draftRoot]);
  const activeDepth = activePath?.length ?? 0;

  useEffect(() => {
    if (selectedNodeId !== activeKey) {
      setActiveKey(selectedNodeId);
      setCollapsedNodeIds((current) => expandPath(root, selectedNodeId, current));
    }
  }, [activeKey, root, selectedNodeId]);

  useEffect(() => {
    const element = document.querySelector(`[data-outline-node-id="${CSS.escape(activeKey)}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [activeKey, draftRoot]);

  const applyDraft = (nextRoot: OutlineDraftNode, nextKey = activeKey) => {
    onApplyOutline(root.id, outlineDraftToInput(nextRoot), { focusKey: nextKey });
    setActiveKey(nextKey);
    if (!nextKey.startsWith("outline-draft-")) onFocusNode(nextKey);
  };

  const run = (operation: (root: OutlineDraftNode, key: string) => { root: OutlineDraftNode; key?: string; nextKey?: string } | OutlineDraftNode) => {
    const result = operation(draftRoot, activeKey);
    if ("root" in result) {
      applyDraft(result.root, result.key ?? result.nextKey ?? activeKey);
      return;
    }
    applyDraft(result);
  };

  const toggleCollapsed = (key: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const activateNode = (key: string) => {
    setActiveKey(key);
    if (!key.startsWith("outline-draft-")) onFocusNode(key);
  };

  const updateExistingNodeLive = (key: string, patch: Partial<Pick<AtlasNode, "title" | "body">>) => {
    const nodePath = findAtlasNodePath(root, key);
    const node = nodePath?.at(-1);
    if (!node) return;
    const nextPatch = {
      ...patch,
      summary: patch.body !== undefined ? patch.body.split("\n").find(Boolean) ?? "Empty notebook node." : node.summary,
    };
    const history = !liveEditHistoryNodeIdsRef.current.has(key);
    liveEditHistoryNodeIdsRef.current.add(key);
    onUpdateNodeLive(key, nextPatch, { history });
  };

  const endLiveEdit = (key: string) => {
    liveEditHistoryNodeIdsRef.current.delete(key);
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
            <ListTree size={16} /> {<I18nText id="ui.outlineEditor.textEditor.7ce32d9" />}</span>
          <h2>{root.title || formatAppMessage("node.untitled")}</h2>
          {copyStatus ? <p>{copyStatus}</p> : null}
        </div>
        <div className="outline-editor-actions">
          <button type="button" onClick={onClose}>
            <X size={17} /> {<I18nText id="ui.outlineEditor.close.b15eba1" />}</button>
          <button type="button" onClick={() => setCollapsedNodeIds(new Set())}>
            <ChevronsDown size={17} /> {<I18nText id="ui.outlineEditor.expandAll.01dc620" />}</button>
          <button type="button" onClick={() => setCollapsedNodeIds(new Set(collectCollapsibleOutlineIds(draftRoot, collapseRootOnCollapseAll)))}>
            <ChevronsUp size={17} /> {<I18nText id="ui.outlineEditor.collapseAll.f5e2a42" />}</button>
        </div>
      </header>

      <main className="outline-editor-body" aria-label={formatAppMessage("ui.outlineEditor.mindAtlasOutlineEditor.9063b07")}>
        <OutlineNodeEditor
          node={draftRoot}
          root={root}
          depth={0}
          activeKey={activeKey}
          onActivate={activateNode}
          onUpdate={(key, patch) => {
            if (!key.startsWith("outline-draft-") && (patch.title !== undefined || patch.body !== undefined)) {
              updateExistingNodeLive(key, patch);
              return;
            }
            applyDraft(updateOutlineNode(draftRoot, key, (node) => ({ ...node, ...patch })), key);
          }}
          onEndEdit={endLiveEdit}
          onToggleCollapsed={toggleCollapsed}
          onCopy={(key, preset) => {
            void copyContextMarkdown(root, key, preset)
              .then((result) => setCopyStatus(formatAppMessage("status.copy.copied", { stats: formatContextCopyStats(result) })))
              .catch((error) => setCopyStatus(error instanceof Error ? error.message : "Copy failed."));
          }}
          onCommand={(command, key) => {
            setActiveKey(key);
            run((current) => runOutlineCommand(current, key, command));
          }}
        />
      </main>

      <nav className="outline-mobile-toolbar" aria-label={formatAppMessage("ui.outlineEditor.outlineEditControls.a18584b")}>
        <button type="button" onClick={() => run((current, key) => outdentOutlineNode(current, key))} disabled={activeDepth <= 1} aria-label={formatAppMessage("ui.outlineEditor.outdentNode.30df0cf")}>
          <ArrowLeft size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => indentOutlineNode(current, key))} disabled={activeDepth === 0} aria-label={formatAppMessage("ui.outlineEditor.indentNode.cea22b8")}>
          <ArrowRight size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => moveOutlineSibling(current, key, -1))} disabled={activeDepth === 0} aria-label={formatAppMessage("ui.outlineEditor.moveNodeUp.3ecda81")}>
          <ArrowUp size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => moveOutlineSibling(current, key, 1))} disabled={activeDepth === 0} aria-label={formatAppMessage("ui.outlineEditor.moveNodeDown.4e79f57")}>
          <ArrowDown size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => insertOutlineSiblingAfter(current, key))} disabled={activeDepth === 0} aria-label={formatAppMessage("ui.outlineEditor.addSiblingNode.4b7e5f1")}>
          <ListPlus size={18} />
        </button>
        <button type="button" onClick={() => run((current, key) => insertOutlineChild(current, key))} aria-label={formatAppMessage("ui.outlineEditor.addChildNode.9ac1af1")}>
          <GitBranchPlus size={18} />
        </button>
        <button className="is-primary" type="button" onClick={() => onClose()} aria-label={formatAppMessage("ui.outlineEditor.closeOutline.1c6a641")}>
          <Check size={18} />
        </button>
      </nav>
    </div>
  );
}

function OutlineNodeEditor({
  node,
  root,
  depth,
  activeKey,
  onActivate,
  onUpdate,
  onEndEdit,
  onToggleCollapsed,
  onCopy,
  onCommand,
}: {
  node: OutlineDraftNode;
  root: AtlasNode;
  depth: number;
  activeKey: string;
  onActivate: (key: string) => void;
  onUpdate: (key: string, patch: Partial<OutlineDraftNode>) => void;
  onEndEdit: (key: string) => void;
  onToggleCollapsed: (key: string) => void;
  onCopy: (key: string, preset: ContextCopyPreset) => void;
  onCommand: (command: OutlineCommand, key: string) => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const isActive = activeKey === node.key;
  const hasChildren = node.children.length > 0;
  const hiddenCount = node.collapsed ? countDraftDescendants(node) : 0;
  const subtreeHidden = node.collapsed;

  return (
    <section className={`outline-node-row ${isActive ? "is-active" : ""}`} data-depth={depth} data-outline-node-id={node.id ?? node.key}>
      <div className="outline-title-row" onFocusCapture={() => onActivate(node.key)}>
        <div className="outline-indent-gutter" aria-hidden="true" style={{ "--outline-depth": depth } as CSSProperties} />
        <button
          className="outline-fold-button"
          type="button"
          onClick={() => {
            if (hasChildren) onToggleCollapsed(node.key);
          }}
          disabled={!hasChildren}
          aria-label={node.collapsed ? formatAppMessage("ui.outlineEditor.expandNode.1352475") : formatAppMessage("ui.outlineEditor.collapseNode.a715f06")}
          aria-expanded={hasChildren ? !node.collapsed : undefined}
        >
          {node.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <span className="outline-title-marker">#</span>
        <input
          value={node.title}
          onFocus={() => onActivate(node.key)}
          onChange={(event) => onUpdate(node.key, { title: event.target.value })}
          onBlur={() => onEndEdit(node.key)}
          placeholder={formatAppMessage("node.untitled")}
          aria-label={formatAppMessage("ui.outlineEditor.nodeTitle.0a17b46")}
        />
        <div className="outline-line-actions">
          <button type="button" onClick={() => onCommand("outdent", node.key)} disabled={depth <= 1} aria-label={formatAppMessage("ui.outlineEditor.outdentNode.30df0cf")}>
            <ArrowLeft size={14} />
          </button>
          <button type="button" onClick={() => onCommand("indent", node.key)} disabled={depth === 0} aria-label={formatAppMessage("ui.outlineEditor.indentNode.cea22b8")}>
            <ArrowRight size={14} />
          </button>
          <button type="button" onClick={() => onCommand("up", node.key)} disabled={depth === 0} aria-label={formatAppMessage("ui.outlineEditor.moveNodeUp.3ecda81")}>
            <ArrowUp size={14} />
          </button>
          <button type="button" onClick={() => onCommand("down", node.key)} disabled={depth === 0} aria-label={formatAppMessage("ui.outlineEditor.moveNodeDown.4e79f57")}>
            <ArrowDown size={14} />
          </button>
          <button type="button" onClick={() => onCommand("sibling", node.key)} disabled={depth === 0} aria-label={formatAppMessage("ui.outlineEditor.addSibling.d0210ae")}>
            <ListPlus size={14} />
          </button>
          <button type="button" onClick={() => onCommand("child", node.key)} aria-label={formatAppMessage("ui.outlineEditor.addChild.eb18105")}>
            <GitBranchPlus size={14} />
          </button>
          <div className="outline-copy-menu">
            <Copy size={14} />
            <select
              value=""
              onChange={(event) => {
                const preset = event.target.value as ContextCopyPreset;
                if (preset) onCopy(node.id ?? node.key, preset);
                event.currentTarget.value = "";
              }}
              aria-label={formatAppMessage("ui.outlineEditor.copyWithContext.b148fa6")}
              title={formatContextCopyStats(buildContextCopy(root, node.id ?? node.key, "ancestors"))}
            >
              <option value="">{<I18nText id="ui.outlineEditor.copy.48a22f3" />}</option>
              {CONTEXT_COPY_PRESETS.map((preset) => {
                const preview = buildContextCopy(root, node.id ?? node.key, preset.id);
                return (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} ({formatContextCopyStats(preview)})
                  </option>
                );
              })}
            </select>
          </div>
          <button type="button" onClick={() => onCommand("delete", node.key)} disabled={depth === 0} aria-label={formatAppMessage("ui.outlineEditor.deleteNode.1c01e20")}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {node.collapsed ? (
        <div className="outline-collapsed-note" style={{ "--outline-depth": depth } as CSSProperties}>
          {<I18nText id="ui.outlineEditor.collapsed.19114ba" />}{hiddenCount ? formatAppMessage("dynamic.collapsedDescendants", { count: hiddenCount }) : ""}
        </div>
      ) : null}
      <>
        {subtreeHidden ? null : (
          <div className="outline-body-row" onFocusCapture={() => onActivate(node.key)}>
            <div className="outline-indent-gutter" aria-hidden="true" style={{ "--outline-depth": depth } as CSSProperties} />
            <textarea
              ref={bodyRef}
              value={node.body}
              onFocus={() => onActivate(node.key)}
              onChange={(event) => onUpdate(node.key, { body: event.target.value })}
              onInput={() => autoSizeTextarea(bodyRef.current)}
              onBlur={() => {
                autoSizeTextarea(bodyRef.current);
                onEndEdit(node.key);
              }}
              placeholder={formatAppMessage("ui.outlineEditor.body.3b37e9a")}
              aria-label={formatAppMessage("ui.outlineEditor.nodeBody.68bf85f")}
              rows={Math.max(2, node.body.split("\n").length)}
            />
          </div>
        )}
        {subtreeHidden ? null : (
          <div className="outline-children">
            {node.children.map((child) => (
              <OutlineNodeEditor
                key={child.key}
                node={child}
                root={root}
                depth={depth + 1}
                activeKey={activeKey}
                onActivate={onActivate}
                onUpdate={onUpdate}
                onEndEdit={onEndEdit}
                onToggleCollapsed={onToggleCollapsed}
                onCopy={onCopy}
                onCommand={onCommand}
              />
            ))}
          </div>
        )}
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

function applyCollapsedState(node: OutlineDraftNode, collapsedNodeIds: Set<string>): OutlineDraftNode {
  return {
    ...node,
    collapsed: collapsedNodeIds.has(node.id ?? node.key),
    children: node.children.map((child) => applyCollapsedState(child, collapsedNodeIds)),
  };
}

function collectCollapsibleOutlineIds(node: OutlineDraftNode, includeSelf = true): string[] {
  const self = includeSelf && node.children.length ? [node.id ?? node.key] : [];
  return [...self, ...node.children.flatMap((child) => collectCollapsibleOutlineIds(child))];
}

function expandPath(root: AtlasNode, nodeId: string, collapsedNodeIds: Set<string>) {
  const path = findAtlasNodePath(root, nodeId);
  if (!path) return collapsedNodeIds;
  const next = new Set(collapsedNodeIds);
  path.slice(0, -1).forEach((node) => next.delete(node.id));
  return next;
}

function findAtlasNodePath(root: AtlasNode, nodeId: string): AtlasNode[] | null {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const path = findAtlasNodePath(child, nodeId);
    if (path) return [root, ...path];
  }
  return null;
}

function autoSizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}
