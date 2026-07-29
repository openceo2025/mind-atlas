// Agent Run Workspace: the detailed local-only surface for supervising one
// Codex or Claude Code run. The command dock stays compact; everything heavy
// lives here.
//
// Mode: local-only. The component returns null unless
// `isAgentRuntimeAvailable()` is true, so a hosted build renders nothing and
// never calls a local agent endpoint.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  RotateCcw,
  Send,
  Square,
  SquareTerminal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { createRunViewModel, reduceRunEvent } from "../../agentRuntime/eventReducer";
import { summarizeDiff } from "../../agentRuntime/markdown";
import {
  checkpointAgentRun,
  cleanupAgentRuntime,
  compactAgentRun,
  describeAgentRun,
  getAgentCapabilities,
  interruptAgentRun,
  isAgentRuntimeAvailable,
  prepareAgentHandoff,
  reclaimAgentRun,
  removeAgentRunWorktree,
  resolveAgentApproval,
  resolveAgentUserInput,
  revertAgentRunCheckpoint,
  steerAgentRun,
  subscribeToAgentRun,
  type AgentHandoffResult,
} from "../../agentRuntime/runtimeClient";
import type { AgentCapabilitiesResult, AgentRunViewModel, AgentTimelineEntry } from "../../agentRuntime/types";
import { CopyButton, DiffBlock, MarkdownView } from "./MarkdownView";

type WorkspaceTab = "answer" | "timeline" | "terminal" | "changes" | "preview" | "context" | "capabilities";
type TimelineDensity = "summary" | "normal" | "verbose";

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "answer", label: "Answer" },
  { id: "timeline", label: "Timeline" },
  { id: "terminal", label: "Terminal" },
  { id: "changes", label: "Changes" },
  { id: "preview", label: "Preview" },
  { id: "context", label: "Context" },
  { id: "capabilities", label: "Capabilities" },
];

const SUMMARY_KINDS = new Set(["lifecycle", "message_completed", "plan_updated", "approval_requested", "user_input_requested", "error", "retry"]);
const NORMAL_HIDDEN_KINDS = new Set(["command_output", "diagnostic"]);

export interface AgentRunWorkspaceProps {
  runId: string;
  onClose: () => void;
  /** Atlas injection accounting for the Context tab. Never merged with provider usage. */
  atlasInjection?: {
    estimatedTokens: number | null;
    characters: number;
    bytes: number;
    replayedTurns: number;
    pinnedNodes: number;
    evidenceCount: number;
    estimator: string;
    preview?: string;
  } | null;
  /** Present only when more than one local run is worth supervising. */
  runSwitcher?: {
    runs: Array<{ runId: string; provider: string; status: string; workspace: string; title: string }>;
    activeRunId: string;
    onSelect: (runId: string) => void;
  } | null;
}

export function AgentRunWorkspace({ runId, onClose, atlasInjection = null, runSwitcher = null }: AgentRunWorkspaceProps) {
  const [model, setModel] = useState<AgentRunViewModel>(() => createRunViewModel(runId));
  const [tab, setTab] = useState<WorkspaceTab>("answer");
  const [density, setDensity] = useState<TimelineDensity>("normal");
  const [steerText, setSteerText] = useState("");
  const [notice, setNotice] = useState("");
  const [handoff, setHandoff] = useState<AgentHandoffResult | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilitiesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    if (!isAgentRuntimeAvailable()) return undefined;
    setModel(createRunViewModel(runId));
    let cancelled = false;
    void describeAgentRun(runId)
      .then((description) => {
        if (cancelled) return;
        setModel((current) => ({ ...current, manifest: description.manifest, status: description.manifest.status, session: description.manifest.session }));
      })
      .catch(() => {});
    const unsubscribe = subscribeToAgentRun(runId, {
      onManifest: (manifest) => {
        setModel((current) => ({ ...current, manifest, session: manifest.session ?? current.session }));
      },
      onEvent: (event) => {
        setModel((current) => reduceRunEvent(current, event));
      },
      onError: (error) => setNotice(error.message),
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [runId]);

  useEffect(() => {
    const manifest = model.manifest;
    if (!manifest?.workspace || !isAgentRuntimeAvailable()) return undefined;
    let cancelled = false;
    void getAgentCapabilities({
      workspace: manifest.workspace,
      authMode: manifest.authMode,
    })
      .then((result) => {
        if (!cancelled) setCapabilities(result);
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, [model.manifest?.workspace, model.manifest?.authMode]);

  const control = useCallback(async (action: () => Promise<{ ok: boolean; reason?: string; detail?: string }>, successNote: string) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await action();
      setNotice(result.ok ? successNote : result.detail || result.reason || "That control is not available for this run.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const repositoryControl = useCallback(async (
    action: () => Promise<{ ok: boolean; reason?: string; detail?: string }>,
    successNote: string,
  ) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await action();
      setNotice(result.ok ? successNote : result.detail || result.reason || "Repository action failed.");
      if (result.ok) {
        const description = await describeAgentRun(runId);
        setModel((current) => ({
          ...current,
          manifest: description.manifest,
          status: description.manifest.status,
        }));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [runId]);

  if (!isAgentRuntimeAvailable()) return null;

  const manifest = model.manifest;
  const active = ["queued", "starting", "running", "waiting_for_approval", "waiting_for_user_input", "stopping"].includes(model.status);
  const nativeOwned = manifest?.ownership?.state === "native" || model.status === "native_owned";
  const answerText = model.answer || model.streamingAnswer;
  const diffSummary = useMemo(() => (model.diff ? summarizeDiff(model.diff) : null), [model.diff]);
  const visibleTimeline = useMemo(() => filterTimeline(model.timeline, density), [model.timeline, density]);
  const activeCapability = capabilities?.providers.find((entry) => entry.provider === manifest?.provider);
  const canSteer = activeCapability?.supports.steer === true;
  const canCompact = activeCapability?.supports.compact === true;
  const steerReason = canSteer
    ? "Add an instruction to the running turn."
    : activeCapability?.unavailableReasons.steer || "Checking runtime steering support.";
  const compactReason = canCompact
    ? "Compact the provider session context."
    : activeCapability?.unavailableReasons.compact || "This runtime does not report compaction support.";

  return (
    <section className="agent-workspace" aria-label="Agent run workspace">
      <header className="agent-workspace-head">
        <div className="agent-workspace-title">
          <span className={`agent-status agent-status-${model.status}`}>{statusText(model.status)}</span>
          <span className="agent-workspace-provider">
            {manifest?.provider ?? "-"} - {manifest?.route ?? "-"}
          </span>
          {manifest?.model ? <span className="agent-workspace-meta">{manifest.model}{manifest.effort ? ` / ${manifest.effort}` : ""}</span> : null}
          {manifest?.git?.repositoryName ? (
            <span className="agent-workspace-meta" title={manifest.git.gitRoot}>
              {manifest.git.repositoryName} / {manifest.git.branch || "detached"} @ {(manifest.git.head || "").slice(0, 10)}
            </span>
          ) : null}
          {manifest?.workspace ? (
            <span className="agent-workspace-meta" title={`Execution directory: ${manifest.workspace}`}>
              exec: {shortPath(manifest.workspace)}
            </span>
          ) : null}
          {manifest?.sourceWorkspace && manifest.sourceWorkspace !== manifest.workspace ? (
            <span className="agent-workspace-meta" title={`Source checkout: ${manifest.sourceWorkspace}`}>
              source: {shortPath(manifest.sourceWorkspace)}
            </span>
          ) : null}
        </div>
        <div className="agent-workspace-actions">
          {active ? (
            <button type="button" className="agent-btn agent-btn-danger" disabled={busy} onClick={() => control(() => interruptAgentRun(runId), "Stop requested.")}>
              <Square size={13} /> Stop
            </button>
          ) : null}
          {nativeOwned ? (
            <button type="button" className="agent-btn" disabled={busy} onClick={() => control(async () => {
              const result = await reclaimAgentRun(runId);
              if (result.ok) setHandoff(null);
              return result;
            }, "Mind Atlas owns this session again.")}>
              <Undo2 size={13} /> Reclaim
            </button>
          ) : (
            <button
              type="button"
              className="agent-btn"
              disabled={busy || active}
              title={active ? "Stop or finish the run before handing it to the native application." : "Continue this session in the native CLI"}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await prepareAgentHandoff(runId, { launch: false });
                  setHandoff(result);
                  if (!result.ok) setNotice(result.detail ?? result.reason ?? "Handoff is not available.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <ExternalLink size={13} /> Native app
            </button>
          )}
          <button type="button" className="agent-btn agent-btn-ghost" onClick={onClose} aria-label="Close run workspace">
            <X size={14} />
          </button>
        </div>
      </header>

      {runSwitcher ? (
        <div className="agent-run-switcher" role="tablist" aria-label="Parallel agent runs">
          {runSwitcher.runs.map((entry) => (
            <button
              key={entry.runId}
              type="button"
              role="tab"
              aria-selected={entry.runId === runSwitcher.activeRunId}
              className={entry.runId === runSwitcher.activeRunId ? "agent-chip agent-chip-active" : "agent-chip"}
              title={`${entry.workspace}\n${entry.title}`}
              onClick={() => runSwitcher.onSelect(entry.runId)}
            >
              <span className={`agent-run-dot agent-status-${entry.status}`} aria-hidden />
              {entry.provider} - {workspaceLabel(entry.workspace)}
            </button>
          ))}
        </div>
      ) : null}

      {notice ? <p className="agent-notice">{notice}</p> : null}

      {model.approvals.filter((entry) => !entry.resolvedWith).map((approval) => (
        <div key={approval.requestId} className="agent-approval">
          <div className="agent-approval-head">
            <AlertTriangle size={14} />
            <strong>Approval required ({approval.category || "provider"})</strong>
          </div>
          {approval.reason ? <p className="agent-approval-reason">{approval.reason}</p> : null}
          {approval.command ? <pre className="agent-approval-command">{approval.command}</pre> : null}
          {approval.cwd ? <p className="agent-approval-meta">Working directory: {approval.cwd}</p> : null}
          {approval.grantRoot ? <p className="agent-approval-meta">Requested writable root: {approval.grantRoot}</p> : null}
          <div className="agent-approval-choices">
            {/* Only the choices the provider actually offered. */}
            {approval.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={choice.id === "decline" ? "agent-btn agent-btn-danger" : "agent-btn"}
                disabled={busy}
                onClick={() => control(() => resolveAgentApproval(runId, approval.requestId, choice.id), `Answered: ${choice.label}`)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {model.questions.filter((entry) => !entry.resolved).map((question) => (
        <AgentQuestionRow
          key={question.requestId}
          question={question}
          busy={busy}
          onAnswer={(answers) => control(() => resolveAgentUserInput(runId, question.requestId, answers), "Answer sent.")}
        />
      ))}

      {handoff?.ok && handoff.plan ? (
        <div className="agent-handoff">
          <strong>{handoff.plan.title ?? "Continue in the native application"}</strong>
          <p className="agent-approval-meta">{handoff.plan.continuity?.label ?? ""}</p>
          {handoff.plan.command ? (
            <>
              <pre className="agent-approval-command">{[handoff.plan.command, ...(handoff.plan.args ?? [])].join(" ")}</pre>
              <p className="agent-approval-meta">Working directory: {handoff.plan.cwd}</p>
              <div className="agent-approval-choices">
                <button
                  type="button"
                  className="agent-btn"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await prepareAgentHandoff(runId, { launch: true });
                      setHandoff(result);
                      setNotice(result.ok
                        ? "The native session is open. Mind Atlas is locked out until you reclaim it."
                        : result.detail ?? "The native application could not be launched; Mind Atlas kept ownership.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Open terminal and transfer ownership
                </button>
                <CopyButton value={[handoff.plan.command, ...(handoff.plan.args ?? [])].join(" ")} label="Copy command" />
              </div>
            </>
          ) : (
            <ol className="agent-handoff-steps">
              {(handoff.plan.manualSteps ?? handoff.plan.steps ?? []).map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      <nav className="agent-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "agent-tab agent-tab-active" : "agent-tab"}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === "changes" && model.fileChanges.length ? <span className="agent-tab-count">{model.fileChanges.length}</span> : null}
            {entry.id === "timeline" && model.timeline.length ? <span className="agent-tab-count">{model.timeline.length}</span> : null}
            {entry.id === "terminal" && model.terminal.length ? <span className="agent-tab-count">{model.terminal.length}</span> : null}
          </button>
        ))}
      </nav>

      <div className="agent-workspace-body" role="tabpanel">
        {tab === "answer" ? (
          <>
            {active && !model.answer && model.streamingAnswer ? (
              <p className="agent-streaming"><Loader2 size={13} className="agent-spin" /> streaming</p>
            ) : null}
            <MarkdownView source={answerText} emptyLabel={active ? "Waiting for the first tokens." : "This run produced no final message."} />
            {model.reasoning ? (
              <details className="agent-reasoning">
                <summary>Reasoning summary</summary>
                <MarkdownView source={model.reasoning} />
              </details>
            ) : null}
            {answerText ? <div className="agent-answer-actions"><CopyButton value={answerText} label="Copy answer" /></div> : null}
          </>
        ) : null}

        {tab === "timeline" ? (
          <>
            <div className="agent-density">
              {(["summary", "normal", "verbose"] as TimelineDensity[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={density === value ? "agent-chip agent-chip-active" : "agent-chip"}
                  onClick={() => setDensity(value)}
                >
                  {value}
                </button>
              ))}
              <span className="agent-density-note">{visibleTimeline.length} of {model.timeline.length} events</span>
            </div>
            {model.plan?.steps.length ? (
              <div className="agent-plan">
                <strong>Plan</strong>
                <ol>
                  {model.plan.steps.map((step, index) => (
                    <li key={index} className={`agent-plan-${step.status || "pending"}`}>{step.step}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            {model.subagents.length ? (
              <section className="agent-subagents" aria-label="Sub-agents">
                <strong>Sub-agents</strong>
                {model.subagents.map((entry) => (
                  <div key={entry.id} className={`agent-subagent agent-subagent-${entry.status}`}>
                    <span className={`agent-run-dot agent-status-${entry.status}`} aria-hidden />
                    <b>{entry.label}</b>
                    <span>{entry.status}</span>
                    {entry.agentThreadId ? <code>{entry.agentThreadId}</code> : null}
                    {entry.agentPath ? <code>{entry.agentPath}</code> : null}
                    {entry.detail ? <details><summary>Details</summary><pre>{entry.detail}</pre></details> : null}
                  </div>
                ))}
              </section>
            ) : null}
            <ol className="agent-timeline">
              {visibleTimeline.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
            </ol>
            {visibleTimeline.length ? null : <p className="agent-md-empty">No events at this density yet.</p>}
          </>
        ) : null}

        {tab === "terminal" ? (
          model.terminal.length ? (
            <div className="agent-terminal-list">
              {model.terminal.map((entry) => (
                <section key={entry.itemId} className="agent-terminal-entry">
                  <header>
                    <SquareTerminal size={13} />
                    <code>{entry.command || "(command not reported)"}</code>
                    <span className="agent-chip">{entry.status || "unknown"}</span>
                    {entry.exitCode === null ? null : <span className="agent-chip">exit {entry.exitCode}</span>}
                  </header>
                  {entry.cwd ? <p title={entry.cwd}>cwd: {shortPath(entry.cwd)}</p> : null}
                  <pre>{entry.output || "No terminal output was reported."}</pre>
                </section>
              ))}
            </div>
          ) : (
            <p className="agent-md-empty">This run has not reported a terminal command.</p>
          )
        ) : null}

        {tab === "changes" ? (
          <>
            <WorktreeControls
              model={model}
              active={active}
              busy={busy}
              onCheckpoint={() => repositoryControl(() => checkpointAgentRun(runId), "Checkpoint commit created.")}
              onRevert={() => {
                if (!window.confirm("Create a Git revert commit for this run's checkpoint?")) return;
                void repositoryControl(() => revertAgentRunCheckpoint(runId), "Checkpoint was reverted with a new commit.");
              }}
              onRemove={() => {
                if (!window.confirm("Remove this clean mission worktree? The branch and commits remain in Git.")) return;
                void repositoryControl(() => removeAgentRunWorktree(runId), "Mission worktree removed. Its branch remains available.");
              }}
            />
            {model.fileChanges.length ? (
              <table className="agent-file-table">
                <thead>
                  <tr><th>File</th><th>Kind</th><th>Status</th><th>+/-</th></tr>
                </thead>
                <tbody>
                  {model.fileChanges.map((entry) => (
                    <tr key={entry.path}>
                      <td title={entry.path}>{shortPath(entry.path)}</td>
                      <td>{entry.kind || "-"}</td>
                      <td>{entry.status || "-"}</td>
                      <td>{entry.added === null && entry.removed === null ? "-" : `+${entry.added ?? 0} / -${entry.removed ?? 0}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="agent-md-empty">No file changes were reported by the provider.</p>
            )}
            {diffSummary ? (
              <p className="agent-approval-meta">
                Provider diff: {diffSummary.files.length} file(s), +{diffSummary.added} / -{diffSummary.removed}.
                Compare against your working tree before assuming a file is unchanged.
              </p>
            ) : null}
            <DiffBlock value={model.diff} />
          </>
        ) : null}

        {tab === "preview" ? (
          model.artifacts.length ? (
            <ul className="agent-artifacts">
              {model.artifacts.map((artifact, index) => (
                <li key={index}>
                  <span className="agent-chip">{artifact.kind}</span>
                  <span title={artifact.path}>{shortPath(artifact.path)}</span>
                  <CopyButton value={artifact.path} label="Copy path" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-md-empty">
              No artifacts were produced by this run. Artifact previews are limited to files the provider reported.
            </p>
          )
        ) : null}

        {tab === "context" ? (
          <ContextTab model={model} atlasInjection={atlasInjection} />
        ) : null}

        {tab === "capabilities" ? (
          <CapabilityTab
            result={capabilities}
            provider={manifest?.provider ?? ""}
            onRefresh={async () => {
              if (!manifest?.workspace) return;
              setBusy(true);
              try {
                setCapabilities(await getAgentCapabilities({
                  refresh: true,
                  workspace: manifest.workspace,
                  authMode: manifest.authMode,
                }));
                setNotice("Runtime capabilities refreshed.");
              } finally {
                setBusy(false);
              }
            }}
            onCleanup={() => control(() => cleanupAgentRuntime(), "Agent runtime retention cleanup completed.")}
            busy={busy}
          />
        ) : null}
      </div>

      {active ? (
        <form
          className="agent-steer"
          onSubmit={(event) => {
            event.preventDefault();
            const value = steerText.trim();
            if (!value || !canSteer) return;
            void control(() => steerAgentRun(runId, value), "Steering message sent to the active turn.");
            setSteerText("");
          }}
        >
          <input
            value={steerText}
            onChange={(event) => setSteerText(event.target.value)}
            placeholder={canSteer ? "Add an instruction to the running turn" : steerReason}
            aria-label="Steer the running turn"
            title={steerReason}
            disabled={busy || !canSteer}
          />
          <button type="submit" className="agent-btn" title={steerReason} disabled={busy || !canSteer || !steerText.trim()}>
            <Send size={13} /> Steer
          </button>
          <button
            type="button"
            className="agent-btn agent-btn-ghost"
            title={compactReason}
            disabled={busy || !canCompact}
            onClick={() => control(() => compactAgentRun(runId), "Compaction requested.")}
          >
            Compact
          </button>
        </form>
      ) : null}
    </section>
  );
}

function WorktreeControls({
  model,
  active,
  busy,
  onCheckpoint,
  onRevert,
  onRemove,
}: {
  model: AgentRunViewModel;
  active: boolean;
  busy: boolean;
  onCheckpoint: () => void;
  onRevert: () => void;
  onRemove: () => void;
}) {
  const manifest = model.manifest;
  if (!manifest) return null;
  if (manifest.workspaceMode !== "worktree") {
    return (
      <section className="agent-worktree-controls is-shared">
        <GitBranch size={14} />
        <div>
          <strong>Current checkout</strong>
          <span>Checkpoint and run-attributed revert are disabled because unrelated working-tree changes cannot be separated safely.</span>
        </div>
      </section>
    );
  }

  const removed = Boolean(manifest.worktree?.removedAt);
  return (
    <section className="agent-worktree-controls">
      <GitBranch size={14} />
      <div>
        <strong>{manifest.worktree?.branch || "Mission worktree"}</strong>
        <span title={manifest.workspace}>{removed ? "Worktree removed; Git branch retained." : manifest.workspace}</span>
        {manifest.checkpoint?.commit ? (
          <span><CheckCircle2 size={12} /> checkpoint {manifest.checkpoint.commit.slice(0, 10)}</span>
        ) : null}
      </div>
      <div className="agent-worktree-actions">
        <button type="button" className="agent-btn" disabled={busy || active || removed} onClick={onCheckpoint}>
          <CheckCircle2 size={13} /> Checkpoint
        </button>
        <button type="button" className="agent-btn" disabled={busy || active || !manifest.checkpoint?.commit || removed} onClick={onRevert}>
          <RotateCcw size={13} /> Revert
        </button>
        <button type="button" className="agent-btn agent-btn-danger" disabled={busy || active || removed} onClick={onRemove}>
          <Trash2 size={13} /> Remove worktree
        </button>
      </div>
    </section>
  );
}

function CapabilityTab({
  result,
  provider,
  onRefresh,
  onCleanup,
  busy,
}: {
  result: AgentCapabilitiesResult | null;
  provider: string;
  onRefresh: () => Promise<void>;
  onCleanup: () => Promise<void>;
  busy: boolean;
}) {
  const capability = result?.providers.find((entry) => entry.provider === provider);
  if (!capability) {
    return (
      <div className="agent-capabilities">
        <p className="agent-md-empty">Runtime capabilities are not available yet.</p>
        <button type="button" className="agent-btn" disabled={busy} onClick={() => void onRefresh()}>Refresh</button>
      </div>
    );
  }
  const supports = Object.entries(capability.supports ?? {});
  const mcpServers = (capability.mcpServers ?? []).map((entry) => capabilityItemLabel(entry));
  return (
    <div className="agent-capabilities">
      <header>
        <div>
          <strong>{capability.provider} / {capability.route}</strong>
          <span>{capability.runtimeVersion || "version not reported"} - {capability.authMode || "auth route not reported"}</span>
        </div>
        <button type="button" className="agent-btn" disabled={busy} onClick={() => void onRefresh()}>Refresh</button>
        <button type="button" className="agent-btn agent-btn-ghost" disabled={busy} onClick={() => void onCleanup()}>Clean old runs</button>
      </header>

      <section>
        <h4>Models and reasoning levels</h4>
        {capability.models.length ? (
          <ul>
            {capability.models.map((model) => (
              <li key={model.id || model.model}>
                <strong>{model.displayName || model.model}</strong>
                <span>{model.model}</span>
                <code>{model.supportedEfforts.length ? model.supportedEfforts.join(", ") : "provider default"}</code>
              </li>
            ))}
          </ul>
        ) : <p className="agent-md-empty">No model inventory was reported.</p>}
      </section>

      <CapabilityList title="Tools" values={capability.tools ?? []} />
      <CapabilityList title="Skills" values={(capability.skills ?? []).map((skill) => `${skill.name}${skill.description ? ` - ${skill.description}` : ""}`)} />
      <CapabilityList title="MCP servers" values={mcpServers} />
      <CapabilityList title="Slash commands" values={capability.slashCommands ?? []} />
      <CapabilityList title="Sub-agent definitions" values={capability.agents ?? []} />

      <section>
        <h4>Runtime support</h4>
        <dl className="agent-kv">
          {supports.map(([name, enabled]) => (
            <span key={name}>
              <dt>{name}</dt>
              <dd>{enabled ? "available" : capability.unavailableReasons?.[name] || "unavailable"}</dd>
            </span>
          ))}
        </dl>
      </section>
    </div>
  );
}

function CapabilityList({ title, values }: { title: string; values: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      {values.length ? (
        <div className="agent-capability-chips">
          {values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}
        </div>
      ) : <p className="agent-md-empty">None reported by this runtime.</p>}
    </section>
  );
}

function capabilityItemLabel(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.name || record.id || record.server || JSON.stringify(record));
  }
  return String(value ?? "");
}

function AgentQuestionRow({
  question,
  busy,
  onAnswer,
}: {
  question: AgentRunViewModel["questions"][number];
  busy: boolean;
  onAnswer: (answers: Record<string, string[]>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="agent-approval">
      <div className="agent-approval-head">
        <AlertTriangle size={14} />
        <strong>The agent is asking a question</strong>
      </div>
      {question.questions.map((entry) => (
        <div key={entry.id} className="agent-question">
          {entry.header ? <p className="agent-approval-meta">{entry.header}</p> : null}
          <p>{entry.question}</p>
          {entry.options.length ? (
            <div className="agent-approval-choices">
              {entry.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={answers[entry.id] === option.id ? "agent-btn agent-btn-active" : "agent-btn"}
                  onClick={() => setAnswers((current) => ({ ...current, [entry.id]: option.id }))}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {entry.options.length === 0 || entry.allowOther ? (
            <input
              type={entry.isSecret ? "password" : "text"}
              value={answers[entry.id] ?? ""}
              onChange={(event) => setAnswers((current) => ({ ...current, [entry.id]: event.target.value }))}
              placeholder="Your answer"
              aria-label={entry.question}
            />
          ) : null}
        </div>
      ))}
      {question.autoResolutionMs ? (
        <p className="agent-approval-meta">The provider will auto-resolve this after {Math.round(question.autoResolutionMs / 1000)}s.</p>
      ) : null}
      <div className="agent-approval-choices">
        <button
          type="button"
          className="agent-btn"
          disabled={busy}
          onClick={() => onAnswer(Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, [value]])))}
        >
          Send answer
        </button>
      </div>
    </div>
  );
}

function ContextTab({
  model,
  atlasInjection,
}: {
  model: AgentRunViewModel;
  atlasInjection: AgentRunWorkspaceProps["atlasInjection"];
}) {
  const session = model.usage.providerSession;
  const remaining = session && session.contextWindow && session.totalTokens !== null
    ? session.contextWindow - session.totalTokens
    : null;
  return (
    <div className="agent-context">
      <section>
        <h4>Mind Atlas injection</h4>
        {atlasInjection ? (
          <dl className="agent-kv">
            <dt>Estimated tokens</dt>
            <dd>{formatNumber(atlasInjection.estimatedTokens)} <em>(estimate: {atlasInjection.estimator})</em></dd>
            <dt>Characters / bytes</dt>
            <dd>{formatNumber(atlasInjection.characters)} / {formatNumber(atlasInjection.bytes)}</dd>
            <dt>Replayed conversation turns</dt>
            <dd>{formatNumber(atlasInjection.replayedTurns)}</dd>
            <dt>Pinned nodes</dt>
            <dd>{formatNumber(atlasInjection.pinnedNodes)}</dd>
            <dt>Evidence items</dt>
            <dd>{formatNumber(atlasInjection.evidenceCount)}</dd>
          </dl>
        ) : null}
        {atlasInjection?.preview ? (
          <details className="agent-reasoning">
            {/* The exact text Mind Atlas sent, not a summary of it. */}
            <summary>Exact injected context ({formatNumber(atlasInjection.characters)} chars)</summary>
            <pre className="agent-timeline-detail">{atlasInjection.preview}</pre>
            <CopyButton value={atlasInjection.preview} label="Copy injected context" />
          </details>
        ) : null}
        {atlasInjection ? null : (
          <p className="agent-md-empty">No injection accounting was passed for this run.</p>
        )}
      </section>

      <section>
        <h4>Provider session</h4>
        {session ? (
          <dl className="agent-kv">
            <dt>Used tokens</dt>
            <dd>{formatNumber(session.totalTokens)} <em>(reported by the provider)</em></dd>
            <dt>Input / cached / output</dt>
            <dd>{formatNumber(session.inputTokens)} / {formatNumber(session.cachedInputTokens)} / {formatNumber(session.outputTokens)}</dd>
            <dt>Context window</dt>
            <dd>{session.contextWindow === null ? "not reported" : formatNumber(session.contextWindow)}</dd>
            <dt>Remaining</dt>
            {/* Shown only when both values are known. */}
            <dd>{remaining === null ? "unknown" : formatNumber(remaining)}</dd>
            <dt>Compactions</dt>
            <dd>{model.compactionCount}</dd>
            {session.costUsd === null ? null : (
              <>
                <dt>Reported cost</dt>
                <dd>USD {session.costUsd.toFixed(4)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="agent-md-empty">The provider has not reported session usage yet.</p>
        )}
      </section>

      <section>
        <h4>Account allowance</h4>
        {model.usage.accountPlan ? (
          <dl className="agent-kv">
            <dt>Allowance source</dt>
            <dd>{model.usage.accountPlan.authMode === "subscription" ? "Claude Code subscription/SDK" : model.usage.accountPlan.authMode || "provider"}</dd>
            <dt>Status</dt>
            <dd>{model.usage.accountPlan.status || "unknown"}</dd>
            <dt>Window</dt>
            <dd>{model.usage.accountPlan.rateLimitType || "unknown"}</dd>
            <dt>Used / remaining</dt>
            <dd>{formatAllowance(model.usage.accountPlan.utilization)}</dd>
            <dt>Resets</dt>
            <dd>{model.usage.accountPlan.resetsAt ? new Date(model.usage.accountPlan.resetsAt * 1000).toLocaleString() : "unknown"}</dd>
          </dl>
        ) : (
          <p className="agent-md-empty">This route does not report plan allowance. It is not the context window.</p>
        )}
      </section>

      {model.session ? (
        <section>
          <h4>Session</h4>
          <dl className="agent-kv">
            <dt>Action</dt>
            <dd>{model.session.action ?? "new"}{model.session.fellBack ? " (fell back to a new session)" : ""}</dd>
            {model.session.threadId ? (<><dt>Thread</dt><dd>{model.session.threadId}</dd></>) : null}
            {model.session.sessionId ? (<><dt>Session</dt><dd>{model.session.sessionId}</dd></>) : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function TimelineRow({ entry }: { entry: AgentTimelineEntry }) {
  const [open, setOpen] = useState(false);
  const detail = entry.detail ?? "";
  const preview = detail.split("\n")[0]?.slice(0, 160) ?? "";
  return (
    <li className={`agent-timeline-row agent-severity-${entry.severity}`}>
      <button
        type="button"
        className="agent-timeline-head"
        onClick={() => setOpen((current) => !current)}
        disabled={!entry.expandable && !detail}
      >
        <span className="agent-timeline-time">{formatTime(entry.createdAt)}</span>
        <span className="agent-timeline-label">{entry.label}</span>
        {entry.status ? <span className="agent-chip">{entry.status}</span> : null}
        {entry.exitCode === null || entry.exitCode === undefined ? null : <span className="agent-chip">exit {entry.exitCode}</span>}
        {entry.durationMs ? <span className="agent-chip">{Math.round(entry.durationMs / 100) / 10}s</span> : null}
        {preview ? <span className="agent-timeline-preview">{preview}</span> : null}
      </button>
      {open && detail ? <pre className="agent-timeline-detail">{detail}</pre> : null}
    </li>
  );
}

function filterTimeline(entries: AgentTimelineEntry[], density: TimelineDensity) {
  if (density === "verbose") return entries;
  if (density === "summary") return entries.filter((entry) => SUMMARY_KINDS.has(entry.kind) || entry.severity === "error");
  return entries.filter((entry) => !NORMAL_HIDDEN_KINDS.has(entry.kind));
}

function statusText(status: string) {
  return status.replace(/_/g, " ");
}

/** Last path segment, which is what distinguishes parallel runs in practice. */
function workspaceLabel(value: string) {
  const trimmed = String(value ?? "").replace(/[\\/]+$/, "");
  if (!trimmed) return "default";
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] || trimmed;
}

function shortPath(value: string) {
  if (value.length <= 52) return value;
  return `...${value.slice(value.length - 49)}`;
}

function formatTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleTimeString();
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  return value.toLocaleString();
}

function formatAllowance(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const used = Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  return `${Math.round(used)}% / ${Math.round(100 - used)}%`;
}
