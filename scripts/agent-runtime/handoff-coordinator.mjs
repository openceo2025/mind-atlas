// Native application handoff and session ownership.
//
// Mode: local-only.
//
// Ownership rule: exactly one client may write to a provider session at a time.
// Mind Atlas -> transferring -> native -> reconciling -> Mind Atlas.
//
// Continuity claims are evidence based (docs/local-agent-poc-results.md):
// - Codex: `codex resume <thread-id>` in a terminal is true same-thread
//   continuity on this machine. `codex://threads/<id>` is only offered when a
//   URL handler is actually registered.
// - Claude subscription: `claude --resume <session-id>` is true same-session
//   continuity in the CLI. `/desktop` is offered only when the installed build
//   reports that command.
// - Claude API / DeepSeek: no native session continuity; package only.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { inspectGitWorkspace } from "./git-workspace.mjs";
import { boundText } from "./types.mjs";

export class HandoffCoordinator {
  /**
   * @param {{ store: import("./run-journal.mjs").AgentRunStore,
   *           manager: import("./runtime-manager.mjs").AgentRuntimeManager,
   *           codexCommand?: () => { command: string, args: string[] },
   *           claudeCommand?: (args: string[]) => { command: string, args: string[] },
   *           probeCodexDeepLink?: () => boolean }} options
   */
  constructor(options) {
    this.store = options.store;
    this.manager = options.manager;
    this.codexCommand = options.codexCommand ?? null;
    this.claudeCommand = options.claudeCommand ?? null;
    this.probeCodexDeepLink = options.probeCodexDeepLink ?? (() => false);
  }

  /**
   * Build the handoff record and stop Mind Atlas from writing to the session.
   * The record is durable before any external process is launched.
   */
  async prepareHandoff(runId, { launch = false, atlasContext = null } = {}) {
    const handle = this.store.getHandle(runId);
    const manifest = handle?.manifest ?? (await this.store.readManifest(runId));
    if (!manifest) return { ok: false, reason: "unknown_run", detail: "That run is not known to this bridge." };
    if (manifest.ownership?.state === "native") {
      return { ok: false, reason: "already_native", detail: "The native application already owns this session." };
    }
    const active = new Set(["running", "starting", "waiting_for_approval", "waiting_for_user_input", "queued"]);
    if (active.has(manifest.status)) {
      return { ok: false, reason: "run_active", detail: "Stop or finish the run before handing the session to the native application." };
    }

    const final = await this.store.readFinal(runId);
    const git = await readGitState(manifest.workspace);
    const continuity = this.#continuityFor(manifest);
    const handoffId = randomUUID();
    const record = await this.store.saveHandoff({
      handoffId,
      runId,
      provider: manifest.provider,
      route: manifest.route,
      authMode: manifest.authMode ?? "",
      workspace: manifest.workspace,
      session: manifest.session ?? null,
      continuity,
      git,
      request: boundText(manifest.title ?? "", 4000),
      answer: boundText(final?.text ?? "", 40_000),
      diff: boundText(final?.diff ?? git.diffPreview ?? "", 200_000),
      changedFiles: final?.changedFiles ?? git.changedFiles ?? [],
      atlas: atlasContext
        ? {
          nodes: (atlasContext.nodes ?? []).slice(0, 40).map((node) => ({
            nodeId: String(node.nodeId ?? ""),
            title: boundText(String(node.title ?? ""), 300),
            selection: boundText(String(node.selection ?? ""), 2000),
          })),
          breadcrumb: (atlasContext.breadcrumb ?? []).map(String).slice(0, 20),
        }
        : null,
      evidence: (final?.evidence ?? []).map((entry) => ({ kind: entry.kind, displayName: entry.displayName, localPath: entry.localPath })),
      createdAt: new Date().toISOString(),
      ownershipAtCreation: manifest.ownership ?? null,
    });

    const next = {
      ...manifest,
      ownership: { state: "transferring", handoffId, startedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeManifest(next);
    if (handle) handle.manifest = next;

    const plan = this.#launchPlan(manifest, continuity, record);
    if (!launch) return { ok: true, handoff: record, plan, ownership: next.ownership };

    const launched = plan.command ? launchDetachedTerminal(plan) : { ok: false, detail: "No launchable command for this route." };
    if (!launched.ok) {
      // A failed external launch must return ownership to Mind Atlas.
      const restored = { ...next, ownership: manifest.ownership ?? { state: "mind_atlas", leaseId: randomUUID(), acquiredAt: new Date().toISOString() } };
      await this.store.writeManifest(restored);
      if (handle) handle.manifest = restored;
      return { ok: false, reason: "launch_failed", detail: launched.detail, handoff: record, plan, ownership: restored.ownership };
    }

    const owned = {
      ...next,
      status: "native_owned",
      ownership: { state: "native", handoffId, transferredAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeManifest(owned);
    if (handle) handle.manifest = owned;
    return { ok: true, handoff: record, plan, ownership: owned.ownership, launched: true };
  }

  #continuityFor(manifest) {
    if (manifest.provider === "codex") {
      const threadId = manifest.session?.threadId ?? "";
      return {
        kind: threadId ? "same_session_cli" : "package_only",
        label: threadId ? "Same Codex thread continues in the terminal CLI." : "No Codex thread id was captured; use the handoff package.",
        deepLinkAvailable: this.probeCodexDeepLink(),
        desktopAvailable: false,
      };
    }
    const sessionId = manifest.session?.sessionId ?? "";
    const subscription = manifest.authMode === "subscription";
    if (!sessionId) {
      return { kind: "package_only", label: "No Claude session id was captured; use the handoff package.", desktopAvailable: false };
    }
    if (!subscription) {
      return {
        kind: "package_only",
        label: "Anthropic API and DeepSeek routes have no native session continuity. The package carries the summary, diff, and workspace.",
        desktopAvailable: false,
      };
    }
    return {
      kind: "same_session_cli",
      label: "Same Claude session continues in the terminal CLI.",
      desktopAvailable: false,
    };
  }

  #launchPlan(manifest, continuity, record) {
    if (manifest.provider === "codex") {
      const threadId = manifest.session?.threadId ?? "";
      if (!threadId || !this.codexCommand) {
        return { kind: "manual", steps: manualSteps(record), command: "", args: [], cwd: manifest.workspace };
      }
      const spec = this.codexCommand();
      return {
        kind: "cli_resume",
        title: "Continue this Codex thread in a terminal",
        command: spec.command,
        args: [...spec.args, "resume", threadId],
        cwd: manifest.workspace,
        manualSteps: [
          `A terminal opens in ${manifest.workspace}.`,
          `Codex resumes thread ${threadId} with its full history.`,
          "Return to Mind Atlas and press Reclaim when you are finished.",
        ],
        continuity,
      };
    }
    const sessionId = manifest.session?.sessionId ?? "";
    if (!sessionId || manifest.authMode !== "subscription" || !this.claudeCommand) {
      return { kind: "manual", steps: manualSteps(record), command: "", args: [], cwd: manifest.workspace };
    }
    const spec = this.claudeCommand(["--resume", sessionId]);
    return {
      kind: "cli_resume",
      title: "Continue this Claude Code session in a terminal",
      command: spec.command,
      args: spec.args,
      cwd: manifest.workspace,
      manualSteps: [
        `A terminal opens in ${manifest.workspace}.`,
        `Claude Code resumes session ${sessionId}.`,
        "Return to Mind Atlas and press Reclaim when you are finished.",
      ],
      continuity,
    };
  }

  /** Explicit reclaim. Nothing else may leave `native`. */
  async reclaim(runId) {
    const handle = this.store.getHandle(runId);
    const manifest = handle?.manifest ?? (await this.store.readManifest(runId));
    if (!manifest) return { ok: false, reason: "unknown_run", detail: "That run is not known to this bridge." };
    if (manifest.ownership?.state !== "native" && manifest.ownership?.state !== "transferring") {
      return { ok: false, reason: "not_native", detail: "Mind Atlas already owns this session." };
    }
    const reconciling = {
      ...manifest,
      status: "reconciliation_required",
      ownership: { state: "reconciling", handoffId: manifest.ownership.handoffId, startedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeManifest(reconciling);
    if (handle) handle.manifest = reconciling;

    const git = await readGitState(manifest.workspace);
    const before = (await this.store.readHandoff(manifest.ownership.handoffId))?.git ?? null;
    let providerSummary = null;
    if (manifest.provider === "codex" && manifest.session?.threadId) {
      // Read-only reconciliation: never adds a turn to the thread.
      const read = await this.manager.codexAdapter?.readThread(manifest.session.threadId);
      if (read?.ok) {
        providerSummary = {
          turns: read.thread?.turns?.length ?? null,
          status: read.thread?.status?.type ?? "",
          updatedAt: read.thread?.updatedAt ?? null,
        };
      }
    }

    const restored = {
      ...reconciling,
      status: "completed",
      ownership: { state: "mind_atlas", leaseId: randomUUID(), acquiredAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeManifest(restored);
    if (handle) handle.manifest = restored;

    return {
      ok: true,
      ownership: restored.ownership,
      reconciliation: {
        provider: manifest.provider,
        providerSummary,
        gitBefore: before,
        gitAfter: git,
        gitChanged: Boolean(before && (before.head !== git.head || before.dirtyCount !== git.dirtyCount)),
        note: manifest.provider === "claude"
          ? "Claude Code does not expose a read-only transcript interface here. Compare Git state, and use /export in the CLI if you need the native conversation."
          : "Codex thread state was read without adding a turn.",
      },
    };
  }
}

function manualSteps(record) {
  return [
    `Open a terminal in ${record.workspace}.`,
    record.provider === "codex"
      ? "Start the native Codex CLI and paste the request below."
      : "Start the native Claude Code CLI and paste the request below.",
    "The handoff package holds the request, the answer so far, the diff, and the changed files.",
  ];
}

function launchDetachedTerminal(plan) {
  try {
    if (process.platform === "win32") {
      // `start` opens a real console window so the interactive CLI has a TTY.
      const quoted = [plan.command, ...plan.args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
      const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", "cmd.exe", "/k", quoted], {
        cwd: plan.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { ok: true };
    }
    const child = spawn(plan.command, plan.args, { cwd: plan.cwd, detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: String(error?.message ?? error).slice(0, 400) };
  }
}

async function readGitState(workspace) {
  return await inspectGitWorkspace(workspace);
}

export { readGitState };

export function createHandoffCoordinator(options) {
  return new HandoffCoordinator(options);
}
