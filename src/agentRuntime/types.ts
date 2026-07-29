// Browser-side mirrors of the local agent runtime contract.
//
// Mode: local-only. Nothing in `src/agentRuntime/` may be reached in hosted
// public mode; `isAgentRuntimeAvailable()` is the single gate.

export type AgentProviderId = "codex" | "claude";

export type AgentRuntimeRoute =
  | "codex-app-server"
  | "codex-exec"
  | "claude-stream-json"
  | "claude-json";

export type AgentRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_user_input"
  | "transferring"
  | "native_owned"
  | "reconciliation_required"
  | "completed"
  | "failed"
  | "interrupted";

export type AgentEventKind =
  | "lifecycle"
  | "message_delta"
  | "message_completed"
  | "plan_updated"
  | "reasoning_summary"
  | "command_started"
  | "command_output"
  | "command_completed"
  | "file_change"
  | "diff_updated"
  | "tool_started"
  | "tool_progress"
  | "tool_completed"
  | "subagent"
  | "approval_requested"
  | "approval_resolved"
  | "user_input_requested"
  | "user_input_resolved"
  | "retry"
  | "usage_updated"
  | "artifact_created"
  | "warning"
  | "error"
  | "diagnostic";

export interface AgentRunEvent {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  runId: string;
  provider: AgentProviderId;
  route: AgentRuntimeRoute;
  createdAt: string;
  kind: AgentEventKind;
  // Kind-specific fields stay loosely typed on purpose: an unknown provider
  // field must never break the browser reducer.
  [key: string]: unknown;
}

export interface AgentSessionRef {
  provider: AgentProviderId;
  threadId?: string;
  sessionId?: string;
  threadPath?: string;
  action?: "new" | "resume" | "fork" | "continue";
  fellBack?: boolean;
  authMode?: string;
}

export type SessionOwnership =
  | { state: "mind_atlas"; leaseId: string; acquiredAt: string }
  | { state: "transferring"; handoffId: string; startedAt: string }
  | { state: "native"; handoffId: string; transferredAt: string }
  | { state: "reconciling"; handoffId: string; startedAt: string };

export interface AgentRunManifest {
  schemaVersion: 1;
  runId: string;
  clientRunId: string;
  provider: AgentProviderId;
  route: AgentRuntimeRoute;
  requestedRoute: AgentRuntimeRoute;
  status: AgentRunStatus;
  requestNodeId: string;
  sourceNodeId: string;
  workspace: string;
  sourceWorkspace?: string;
  workspaceMode?: "shared" | "worktree";
  worktree?: {
    sourceWorkspace: string;
    sourceGitRoot: string;
    sourceCommonGitDir?: string;
    path: string;
    branch: string;
    baseHead: string;
    createdAt: string;
    repositoryName: string;
    reused?: boolean;
    removedAt?: string;
  } | null;
  model: string;
  effort: string;
  permissionMode: string;
  sandboxMode: string;
  authMode: string;
  title: string;
  session: AgentSessionRef | null;
  ownership: SessionOwnership;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  lastEventSequence: number;
  finalEventId: string;
  acknowledgedAt: string;
  runtimeVersion?: string;
  interruptedReason?: string;
  git?: AgentGitState | null;
  gitAfter?: AgentGitState | null;
  checkpoint?: {
    commit: string;
    branch: string;
    changedFiles: string[];
    createdAt: string;
  } | null;
  checkpointRevert?: {
    revertedCommit: string;
    commit: string;
    branch: string;
    createdAt: string;
  } | null;
}

export interface AgentGitState {
  available: boolean;
  requestedWorkspace: string;
  resolvedWorkspace: string;
  gitRoot: string;
  repositoryName: string;
  commonGitDir: string;
  repositoryId: string;
  branch: string;
  head: string;
  dirtyCount: number;
  changedFiles: string[];
  statusPreview: string;
  diffPreview: string;
  detail: string;
}

export interface AgentRunFinal {
  runId: string;
  provider: AgentProviderId;
  route: AgentRuntimeRoute;
  status: AgentRunStatus;
  text: string;
  error: string;
  diff?: string;
  changedFiles?: string[];
  durationMs?: number | null;
  gitAfter?: AgentGitState | null;
  completedAt: string;
}

export interface AgentModelCapability {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  defaultEffort?: string;
  supportedEfforts: string[];
  inputModalities: string[];
  upgrade?: string;
}

export interface AgentOption {
  id: string;
  label: string;
  allowed?: boolean;
}

export interface AgentCapabilities {
  provider: AgentProviderId;
  route: AgentRuntimeRoute;
  available: boolean;
  runtimeVersion?: string;
  authMode?: string;
  workspace?: string;
  models: AgentModelCapability[];
  permissionModes: AgentOption[];
  sandboxModes: AgentOption[];
  tools?: string[];
  mcpServers?: unknown[];
  skills?: Array<{ name: string; description: string }>;
  agents?: string[];
  slashCommands?: string[];
  apiKeySource?: string;
  supports: Record<string, boolean>;
  unavailableReasons: Record<string, string>;
}

export interface AgentCapabilitiesResult {
  generatedAt: string;
  routePreference: { codex: string; claude: string };
  providers: AgentCapabilities[];
}

export interface AgentApprovalChoice {
  id: string;
  label: string;
}

export interface AgentApprovalRequest {
  requestId: string;
  category: string;
  reason: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  choices: AgentApprovalChoice[];
  createdAt: string;
  resolvedWith?: string;
}

export interface AgentQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface AgentUserQuestion {
  requestId: string;
  createdAt: string;
  autoResolutionMs: number | null;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    allowOther: boolean;
    isSecret: boolean;
    options: AgentQuestionOption[];
  }>;
  resolved?: boolean;
}

export interface AgentTimelineEntry {
  id: string;
  sequence: number;
  createdAt: string;
  kind: AgentEventKind;
  label: string;
  detail: string;
  status?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  expandable: boolean;
  severity: "info" | "warning" | "error" | "success";
}

export interface AgentFileChangeEntry {
  path: string;
  kind: string;
  status: string;
  added: number | null;
  removed: number | null;
}

export interface AgentPlanStep {
  step: string;
  status: string;
}

export interface AgentTerminalEntry {
  itemId: string;
  command: string;
  cwd: string;
  output: string;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string;
}

export interface AgentSubagentEntry {
  id: string;
  activity: string;
  status: string;
  label: string;
  detail: string;
  agentThreadId: string;
  agentPath: string;
  startedAt: string;
  updatedAt: string;
}

/**
 * Three separate context metrics. They are never merged into one number.
 */
export interface AgentUsageSnapshot {
  /** What the provider says the session actually consumed. */
  providerSession: {
    totalTokens: number | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    cacheWriteInputTokens: number | null;
    outputTokens: number | null;
    reasoningOutputTokens: number | null;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    costUsd: number | null;
    model: string;
    lastTurnTokens: number | null;
    isEstimate: false;
  } | null;
  /** Subscription/plan allowance. Not the context window. */
  accountPlan: {
    authMode: string;
    status: string;
    rateLimitType: string;
    resetsAt: number | null;
    isUsingOverage: boolean;
    utilization: number | null;
  } | null;
  /** Provider-reported thinking-token estimate, explicitly an estimate. */
  thinkingEstimate: { estimatedTokens: number | null } | null;
}

export interface AgentRunViewModel {
  runId: string;
  manifest: AgentRunManifest | null;
  status: AgentRunStatus | "stopping";
  answer: string;
  streamingAnswer: string;
  reasoning: string;
  plan: { explanation: string; steps: AgentPlanStep[] } | null;
  timeline: AgentTimelineEntry[];
  fileChanges: AgentFileChangeEntry[];
  terminal: AgentTerminalEntry[];
  subagents: AgentSubagentEntry[];
  diff: string;
  approvals: AgentApprovalRequest[];
  questions: AgentUserQuestion[];
  usage: AgentUsageSnapshot;
  warnings: string[];
  errors: string[];
  artifacts: Array<{ kind: string; path: string }>;
  lastSequence: number;
  compactionCount: number;
  session: AgentSessionRef | null;
}
