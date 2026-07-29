// Attaches the Agent Run Workspace to a run that was dispatched through the
// normal command dock flow.
//
// The store only knows its own client run id; the runtime assigns the durable
// run id. This host resolves one to the other, retrying briefly because the
// manifest is written a moment after the request leaves the browser.
//
// Mode: local-only.

import { PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findAgentRunByClientId, isAgentRuntimeAvailable, listAgentRuns } from "../../agentRuntime/runtimeClient";
import type { AgentRunManifest } from "../../agentRuntime/types";
import { useAtlasStore } from "../../store/atlasStore";
import { AgentRunWorkspace } from "./AgentRunWorkspace";

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting_for_approval", "waiting_for_user_input"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "interrupted"]);
const LAST_RUN_STORAGE_KEY = "mind-atlas-agent-workspace-last-run-v1";

export function AgentRunWorkspaceHost() {
  const clientRunId = useAtlasStore((state) => state.agentWorkspaceRunId);
  const selectedRunId = useAtlasStore((state) => state.agentWorkspaceSelectedRunId);
  const visible = useAtlasStore((state) => state.agentWorkspaceVisible);
  const openAgentWorkspaceRun = useAtlasStore((state) => state.openAgentWorkspaceRun);
  const hideAgentWorkspace = useAtlasStore((state) => state.hideAgentWorkspace);
  const injection = useAtlasStore((state) => state.agentWorkspaceInjection);
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
  const unreadCount = runs.filter((entry) => TERMINAL_STATUSES.has(entry.status) && !entry.acknowledgedAt).length;

  if (!isAgentRuntimeAvailable()) return null;

  if (!visible) {
    return (
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
    );
  }

  if (!shownRunId) {
    return (
      <section className="agent-workspace agent-workspace-pending">
        <p>{failed ? "This run is not tracked by the streaming runtime; it used the fallback route." : clientRunId ? "Attaching to the run..." : "No agent runs are available yet."}</p>
        <button type="button" className="agent-btn agent-btn-ghost" onClick={hideAgentWorkspace}>
          Close
        </button>
      </section>
    );
  }

  const switchable = runs
    .filter((entry) => ACTIVE_STATUSES.has(entry.status) || TERMINAL_STATUSES.has(entry.status) || entry.runId === shownRunId)
    .slice(0, 10);

  return (
    <AgentRunWorkspace
      runId={shownRunId}
      onClose={hideAgentWorkspace}
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
          onSelect: (nextRunId) => {
            rememberRunId(nextRunId);
            setLastStoredRunId(nextRunId);
            openAgentWorkspaceRun(nextRunId);
          },
        }
        : null}
    />
  );
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
