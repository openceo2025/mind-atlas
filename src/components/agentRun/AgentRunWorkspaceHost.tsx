// Attaches the Agent Run Workspace to a run that was dispatched through the
// normal command dock flow.
//
// The store only knows its own client run id; the runtime assigns the durable
// run id. This host resolves one to the other, retrying briefly because the
// manifest is written a moment after the request leaves the browser.
//
// Mode: local-only.

import { PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acknowledgeAgentRuntimeRuns, findAgentRunByClientId, isAgentRuntimeAvailable, listAgentRuns } from "../../agentRuntime/runtimeClient";
import type { AgentApprovalRequest, AgentRunManifest } from "../../agentRuntime/types";
import { findNode, useAtlasStore } from "../../store/atlasStore";
import type { AtlasNode } from "../../types";
import { AgentRunWorkspace } from "./AgentRunWorkspace";

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting_for_approval", "waiting_for_user_input"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "interrupted"]);
const LAST_RUN_STORAGE_KEY = "mind-atlas-agent-workspace-last-run-v1";

export function AgentRunWorkspaceHost() {
  const clientRunId = useAtlasStore((state) => state.agentWorkspaceRunId);
  const selectedRunId = useAtlasStore((state) => state.agentWorkspaceSelectedRunId);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const visible = useAtlasStore((state) => state.agentWorkspaceVisible);
  const selectAgentWorkspaceRun = useAtlasStore((state) => state.selectAgentWorkspaceRun);
  const openAgentWorkspaceRun = useAtlasStore((state) => state.openAgentWorkspaceRun);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const hideAgentWorkspace = useAtlasStore((state) => state.hideAgentWorkspace);
  const injection = useAtlasStore((state) => state.agentWorkspaceInjection);
  const recordAgentApprovalRequest = useAtlasStore((state) => state.recordAgentApprovalRequest);
  const recordAgentApprovalResponse = useAtlasStore((state) => state.recordAgentApprovalResponse);
  const [resolvedClientRunId, setResolvedClientRunId] = useState("");
  const [failed, setFailed] = useState(false);
  // Parallel supervision: runs started in other repositories stay reachable
  // instead of being replaced by whichever run started last.
  const [runs, setRuns] = useState<AgentRunManifest[]>([]);
  const [lastStoredRunId, setLastStoredRunId] = useState(() => readLastRunId());

  const refreshRuns = useCallback(async () => {
    if (!isAgentRuntimeAvailable()) return;
    try {
      const result = await listAgentRuns(30);
      setRuns(result.runs ?? []);
    } catch {
      // The bridge may be restarting; the switcher simply stays as it was.
    }
  }, []);

  useEffect(() => {
    if (!isAgentRuntimeAvailable()) return undefined;
    void refreshRuns();
    const timer = setInterval(() => void refreshRuns(), 5000);
    return () => clearInterval(timer);
  }, [refreshRuns]);

  useEffect(() => {
    setResolvedClientRunId("");
    setFailed(false);
    if (!clientRunId || !isAgentRuntimeAvailable()) return undefined;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      attempt += 1;
      try {
        const manifest = await findAgentRunByClientId(clientRunId);
        if (cancelled) return;
        if (manifest?.runId) {
          setResolvedClientRunId(manifest.runId);
          rememberRunId(manifest.runId);
          setLastStoredRunId(manifest.runId);
          openAgentWorkspaceRun(manifest.runId);
          void refreshRuns();
          return;
        }
      } catch {
        // The bridge may still be starting; keep retrying within the budget.
      }
      if (attempt >= 20) {
        setFailed(true);
        return;
      }
      timer = setTimeout(poll, 500);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [clientRunId, openAgentWorkspaceRun, refreshRuns]);

  const knownRunIds = useMemo(() => new Set(runs.map((entry) => entry.runId)), [runs]);
  const shownRunId =
    selectedRunId
    || resolvedClientRunId
    || (lastStoredRunId && knownRunIds.has(lastStoredRunId) ? lastStoredRunId : "")
    || runs[0]?.runId
    || "";
  const activeCount = runs.filter((entry) => ACTIVE_STATUSES.has(entry.status)).length;
  const unreadRuns = useMemo(
    () => runs.filter((entry) => TERMINAL_STATUSES.has(entry.status) && !entry.acknowledgedAt),
    [runs],
  );
  const unreadCount = unreadRuns.length;
  const backgroundRunIds = useMemo(() => {
    const ids = [shownRunId, ...runs.filter((entry) => ACTIVE_STATUSES.has(entry.status)).map((entry) => entry.runId)];
    return [...new Set(ids.filter(Boolean))].slice(0, 10);
  }, [runs, shownRunId]);
  const selectedNode = useMemo(() => findNode(atlasRoot, selectedNodeId), [atlasRoot, selectedNodeId]);
  const selectedNodeRunId = useMemo(
    () => findRunIdForNode(selectedNode, runs),
    [runs, selectedNode],
  );
  const previousSyncState = useRef({ selectedNodeId, shownRunId, visible });

  // Reconcile both directions in one effect so simultaneous updates cannot
  // fight. A run change wins first and focuses its request node. A later node
  // change may select a linked run; unrelated notes leave the current run as-is.
  useEffect(() => {
    const previous = previousSyncState.current;
    const runChanged = Boolean(shownRunId && shownRunId !== previous.shownRunId);
    const nodeChanged = selectedNodeId !== previous.selectedNodeId;
    const workspaceOpened = visible && !previous.visible;
    previousSyncState.current = { selectedNodeId, shownRunId, visible };

    if (visible && (runChanged || workspaceOpened)) {
      // Completion of a different background run must never move the Atlas
      // selection while the Code dock has an active field or prompt draft.
      // The run remains selectable from the workspace launcher.
      if (commandInputEditing) return;
      if (selectedNodeRunId === shownRunId) return;
      const manifest = runs.find((entry) => entry.runId === shownRunId);
      const linkedNodeId = manifest ? findNodeIdForRun(atlasRoot, manifest) : "";
      if (linkedNodeId && linkedNodeId !== selectedNodeId) focusNode(linkedNodeId);
      return;
    }

    if (nodeChanged && selectedNodeRunId && selectedNodeRunId !== shownRunId) {
      rememberRunId(selectedNodeRunId);
      setLastStoredRunId(selectedNodeRunId);
      selectAgentWorkspaceRun(selectedNodeRunId);
    }
  }, [atlasRoot, commandInputEditing, focusNode, runs, selectAgentWorkspaceRun, selectedNodeId, selectedNodeRunId, shownRunId, visible]);

  const selectRunFromWorkspace = useCallback((nextRunId: string) => {
    rememberRunId(nextRunId);
    setLastStoredRunId(nextRunId);
    openAgentWorkspaceRun(nextRunId);
  }, [openAgentWorkspaceRun]);

  const handleApprovalRequested = useCallback((runId: string, approval: AgentApprovalRequest, manifest: AgentRunManifest | null) => {
    const provider = manifest?.provider ?? runs.find((entry) => entry.runId === runId)?.provider;
    if (provider !== "codex" && provider !== "claude") return;
    recordAgentApprovalRequest({
      ...approval,
      runId,
      provider,
      requestNodeId: manifest?.requestNodeId,
      sourceNodeId: manifest?.sourceNodeId,
    });
  }, [recordAgentApprovalRequest, runs]);

  const handleApprovalResolved = useCallback((runId: string, requestId: string, decision: string, detail?: string) => {
    recordAgentApprovalResponse(runId, requestId, decision, detail);
  }, [recordAgentApprovalResponse]);

  const markRunsRead = useCallback(async (runIds: string[]) => {
    const wanted = runIds.filter(Boolean);
    if (!wanted.length) return;
    try {
      await acknowledgeAgentRuntimeRuns(wanted);
      await refreshRuns();
    } catch {
      // Acknowledgement is a housekeeping step; a failure just leaves the
      // badge as it was and retention keeps the run until next time.
    }
  }, [refreshRuns]);

  // A finished run the user is actually looking at has been read. Without this
  // the badge only ever grew and retention could never reclaim a run, because
  // it deletes acknowledged runs only.
  useEffect(() => {
    if (!visible || !shownRunId) return;
    const shown = runs.find((entry) => entry.runId === shownRunId);
    if (!shown || !TERMINAL_STATUSES.has(shown.status) || shown.acknowledgedAt) return;
    void markRunsRead([shownRunId]);
  }, [markRunsRead, runs, shownRunId, visible]);

  if (!isAgentRuntimeAvailable()) return null;

  if (!visible) {
    return (
      <>
        <button
          type="button"
          className="agent-workspace-launcher"
          onClick={() => openAgentWorkspaceRun(shownRunId)}
          aria-label="Open Agent runs"
          title={shownRunId ? "Open recent and running agent sessions" : "No agent run has been recorded yet"}
        >
          <PanelRightOpen size={15} />
          <span>Agent runs</span>
          {activeCount ? <b>{activeCount} running</b> : unreadCount ? <b>{unreadCount} unread</b> : null}
        </button>
        {/* Keep the SSE listeners alive while the panel is hidden. Approval
            must still become an Atlas node when the user is looking elsewhere. */}
        {backgroundRunIds.map((backgroundRunId) => (
          <div key={backgroundRunId} hidden>
            <AgentRunWorkspace
              runId={backgroundRunId}
              onClose={() => {}}
              onApprovalRequested={handleApprovalRequested}
              onApprovalResolved={handleApprovalResolved}
            />
          </div>
        ))}
      </>
    );
  }

  if (!shownRunId) {
    return (
      <div className="agent-workspace-backdrop" role="presentation" onPointerDown={hideAgentWorkspace}>
        <div className="agent-workspace-dialog" onPointerDown={(event) => event.stopPropagation()}>
          <section className="agent-workspace agent-workspace-pending">
            <p>{failed ? "This run is not tracked by the streaming runtime; it used the fallback route." : clientRunId ? "Attaching to the run..." : "No agent runs are available yet."}</p>
            <button type="button" className="agent-btn agent-btn-ghost" onClick={hideAgentWorkspace}>
              Close
            </button>
          </section>
        </div>
      </div>
    );
  }

  const switchable = runs
    .filter((entry) => ACTIVE_STATUSES.has(entry.status) || TERMINAL_STATUSES.has(entry.status) || entry.runId === shownRunId)
    .slice(0, 10);

  return (
    <div className="agent-workspace-backdrop" role="presentation" onPointerDown={hideAgentWorkspace}>
      <div className="agent-workspace-dialog" onPointerDown={(event) => event.stopPropagation()}>
        <AgentRunWorkspace
          runId={shownRunId}
          onClose={hideAgentWorkspace}
          onApprovalRequested={handleApprovalRequested}
          onApprovalResolved={handleApprovalResolved}
          atlasInjection={shownRunId === resolvedClientRunId ? injection : null}
          runSwitcher={switchable.length > 1
            ? {
              runs: switchable.map((entry) => ({
                runId: entry.runId,
                provider: entry.provider,
                status: entry.status,
                workspace: entry.workspace,
                title: entry.title,
              })),
              activeRunId: shownRunId,
              onSelect: selectRunFromWorkspace,
              unreadCount,
              onMarkAllRead: () => void markRunsRead(unreadRuns.map((entry) => entry.runId)),
            }
            : null}
        />
      </div>
    </div>
  );
}

function findRunIdForNode(node: AtlasNode | undefined, runs: AgentRunManifest[]) {
  if (!node) return "";
  const runtimeRunId = node.agentExecution?.runtimeRunId || "";
  if (runtimeRunId && runs.some((entry) => entry.runId === runtimeRunId)) return runtimeRunId;
  const clientRunId = node.agentExecution?.clientRunId || node.aiRunId || "";
  return runs.find((entry) => entry.clientRunId === clientRunId)?.runId ?? "";
}

function findNodeIdForRun(root: AtlasNode, manifest: AgentRunManifest) {
  if (manifest.requestNodeId && findNode(root, manifest.requestNodeId)) return manifest.requestNodeId;
  const linkedNode = findLinkedAgentNode(root, manifest.runId, manifest.clientRunId);
  if (linkedNode) return linkedNode.id;
  return manifest.sourceNodeId && findNode(root, manifest.sourceNodeId) ? manifest.sourceNodeId : "";
}

function findLinkedAgentNode(node: AtlasNode, runtimeRunId: string, clientRunId: string): AtlasNode | undefined {
  if (
    node.agentExecution?.runtimeRunId === runtimeRunId
    || node.agentExecution?.clientRunId === clientRunId
    || node.aiRunId === clientRunId
  ) return node;
  for (const child of node.children) {
    const linked = findLinkedAgentNode(child, runtimeRunId, clientRunId);
    if (linked) return linked;
  }
  return undefined;
}

function readLastRunId() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_RUN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberRunId(runId: string) {
  if (!runId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_RUN_STORAGE_KEY, runId);
  } catch {
    // A history shortcut is best effort; the durable journal remains the source of truth.
  }
}
