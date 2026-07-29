// Git workspace inspection and isolated mission worktrees.
//
// Mode: local-only.
//
// All mutating operations are explicit. A run never resets, cleans, stashes,
// commits, or removes a worktree as an implicit side effect.

import { spawn } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { boundText } from "./types.mjs";

const GIT_TIMEOUT_MS = 30_000;
const MAX_CHANGED_FILES = 500;

export async function inspectGitWorkspace(workspace) {
  const requestedWorkspace = String(workspace ?? "").trim();
  const empty = {
    available: false,
    requestedWorkspace,
    resolvedWorkspace: "",
    gitRoot: "",
    repositoryName: "",
    commonGitDir: "",
    repositoryId: "",
    branch: "",
    head: "",
    dirtyCount: 0,
    changedFiles: [],
    statusPreview: "",
    diffPreview: "",
    detail: requestedWorkspace ? "The selected directory is not a Git worktree." : "No work directory is selected.",
  };
  if (!requestedWorkspace) return empty;

  let resolvedWorkspace = "";
  try {
    const info = await stat(requestedWorkspace);
    if (!info.isDirectory()) return { ...empty, detail: "The selected work directory is not a directory." };
    resolvedWorkspace = await realpath(requestedWorkspace);
  } catch {
    return { ...empty, detail: "The selected work directory does not exist or cannot be read." };
  }

  const root = await runGit(resolvedWorkspace, ["rev-parse", "--show-toplevel"]);
  if (root.exitCode !== 0 || !root.stdout.trim()) {
    return { ...empty, resolvedWorkspace, detail: "The selected directory is not inside a Git worktree." };
  }
  const gitRoot = await normalizeExistingPath(root.stdout.trim());
  const [branch, head, status, diff, commonDir] = await Promise.all([
    runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(gitRoot, ["rev-parse", "HEAD"]),
    runGit(gitRoot, ["status", "--short", "--untracked-files=all"]),
    runGit(gitRoot, ["diff", "--no-ext-diff"]),
    runGit(gitRoot, ["rev-parse", "--git-common-dir"]),
  ]);
  const commonGitDir = commonDir.exitCode === 0 && commonDir.stdout.trim()
    ? await normalizeExistingPath(isAbsolute(commonDir.stdout.trim()) ? commonDir.stdout.trim() : resolve(gitRoot, commonDir.stdout.trim()))
    : "";
  const changedFiles = parseStatusPaths(status.stdout);
  const repositoryRoot = sourceRootFromCommonGitDir(commonGitDir, gitRoot);
  return {
    available: true,
    requestedWorkspace,
    resolvedWorkspace,
    gitRoot,
    repositoryName: basename(repositoryRoot),
    commonGitDir,
    repositoryId: commonGitDir ? commonGitDir.replace(/\\/g, "/").toLowerCase() : gitRoot.replace(/\\/g, "/").toLowerCase(),
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    dirtyCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, MAX_CHANGED_FILES),
    statusPreview: boundText(status.stdout, 80_000),
    diffPreview: boundText(diff.stdout, 200_000),
    detail: "",
  };
}

export async function createMissionWorktree({ sourceWorkspace, baseDir, runId, title = "" }) {
  const source = await inspectGitWorkspace(sourceWorkspace);
  if (!source.available) {
    throw new Error("Mission worktrees require a Git repository.");
  }
  const worktreesDir = resolve(baseDir, "worktrees");
  await mkdir(worktreesDir, { recursive: true });
  const shortId = String(runId).replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || Date.now().toString(36);
  const repoSlug = safeSlug(source.repositoryName, "repo");
  const titleSlug = safeSlug(title, "mission").slice(0, 28);
  const target = join(worktreesDir, `${repoSlug}-${titleSlug}-${shortId}`);
  const branch = `mind-atlas/${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${titleSlug}-${shortId}`;

  const created = await runGit(source.gitRoot, ["worktree", "add", "-b", branch, target, source.head], GIT_TIMEOUT_MS * 2);
  if (created.exitCode !== 0) {
    throw new Error(boundText(created.stderr || created.stdout || "Git worktree creation failed.", 1200));
  }
  const workspace = await inspectGitWorkspace(target);
  if (!workspace.available) {
    await runGit(source.gitRoot, ["worktree", "remove", "--force", target], GIT_TIMEOUT_MS * 2);
    throw new Error("Git created the mission worktree, but Mind Atlas could not inspect it.");
  }
  return {
    sourceWorkspace: source.resolvedWorkspace,
    sourceGitRoot: source.gitRoot,
    sourceCommonGitDir: source.commonGitDir,
    path: workspace.resolvedWorkspace,
    branch,
    baseHead: source.head,
    createdAt: new Date().toISOString(),
    repositoryName: source.repositoryName,
  };
}

export function sourceRootFromCommonGitDir(commonGitDir, fallback) {
  const value = String(commonGitDir ?? "").trim();
  return value && basename(value).toLowerCase() === ".git" ? dirname(value) : fallback;
}

export async function createRunCheckpoint({ workspace, changedFiles = [], message }) {
  const before = await inspectGitWorkspace(workspace);
  if (!before.available) return { ok: false, reason: "not_git", detail: "This run workspace is not a Git worktree." };
  const paths = normalizeAttributedPaths(before.gitRoot, changedFiles.length ? changedFiles : before.changedFiles);
  if (!paths.length) return { ok: false, reason: "no_changes", detail: "There are no attributed changes to checkpoint." };

  const added = await runGit(before.gitRoot, ["add", "--", ...paths]);
  if (added.exitCode !== 0) return { ok: false, reason: "git_add_failed", detail: boundText(added.stderr, 1200) };
  const staged = await runGit(before.gitRoot, ["diff", "--cached", "--quiet"]);
  if (staged.exitCode === 0) return { ok: false, reason: "no_changes", detail: "There are no staged changes to checkpoint." };
  if (staged.exitCode !== 1) return { ok: false, reason: "git_diff_failed", detail: boundText(staged.stderr, 1200) };

  const committed = await runGit(before.gitRoot, ["commit", "-m", String(message || "Mind Atlas run checkpoint").slice(0, 240)]);
  if (committed.exitCode !== 0) {
    await runGit(before.gitRoot, ["restore", "--staged", "--", ...paths]);
    return { ok: false, reason: "git_commit_failed", detail: boundText(committed.stderr || committed.stdout, 1600) };
  }
  const after = await inspectGitWorkspace(before.gitRoot);
  return {
    ok: true,
    commit: after.head,
    branch: after.branch,
    changedFiles: paths,
    createdAt: new Date().toISOString(),
  };
}

export async function revertRunCheckpoint({ workspace, commit }) {
  const before = await inspectGitWorkspace(workspace);
  if (!before.available) return { ok: false, reason: "not_git", detail: "This run workspace is not a Git worktree." };
  if (before.dirtyCount > 0) {
    return {
      ok: false,
      reason: "dirty_workspace",
      detail: "The worktree has changes after the checkpoint. Save or discard them before reverting.",
    };
  }
  const target = String(commit ?? "").trim();
  if (!/^[0-9a-f]{7,64}$/i.test(target)) return { ok: false, reason: "invalid_commit", detail: "Checkpoint commit is invalid." };
  const reverted = await runGit(before.gitRoot, ["revert", "--no-edit", target], GIT_TIMEOUT_MS * 2);
  if (reverted.exitCode !== 0) {
    await runGit(before.gitRoot, ["revert", "--abort"]);
    return { ok: false, reason: "git_revert_failed", detail: boundText(reverted.stderr || reverted.stdout, 1600) };
  }
  const after = await inspectGitWorkspace(before.gitRoot);
  return {
    ok: true,
    revertedCommit: target,
    commit: after.head,
    branch: after.branch,
    createdAt: new Date().toISOString(),
  };
}

export async function removeMissionWorktree({ sourceGitRoot, worktreePath }) {
  const source = await inspectGitWorkspace(sourceGitRoot);
  const target = await inspectGitWorkspace(worktreePath);
  if (!source.available || !target.available) {
    return { ok: false, reason: "not_git", detail: "The source repository or mission worktree is unavailable." };
  }
  if (!source.repositoryId || source.repositoryId !== target.repositoryId) {
    return { ok: false, reason: "repository_mismatch", detail: "The mission worktree does not belong to the recorded source repository." };
  }
  if (target.dirtyCount > 0) {
    return { ok: false, reason: "dirty_workspace", detail: "The mission worktree still has uncommitted changes." };
  }
  const removed = await runGit(source.gitRoot, ["worktree", "remove", target.gitRoot]);
  if (removed.exitCode !== 0) {
    return { ok: false, reason: "git_worktree_remove_failed", detail: boundText(removed.stderr || removed.stdout, 1200) };
  }
  return { ok: true, removedPath: target.gitRoot };
}

function normalizeAttributedPaths(gitRoot, values) {
  const unique = new Set();
  for (const value of values ?? []) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const absolute = isAbsolute(raw) ? resolve(raw) : resolve(gitRoot, raw);
    const rel = relative(gitRoot, absolute);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    unique.add(rel.replace(/\\/g, "/"));
  }
  return [...unique].slice(0, MAX_CHANGED_FILES);
}

function parseStatusPaths(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .map((line) => {
      const path = line.slice(3).trim();
      const arrow = path.indexOf(" -> ");
      return arrow >= 0 ? path.slice(arrow + 4) : path;
    })
    .filter(Boolean);
}

async function normalizeExistingPath(value) {
  try {
    return await realpath(value);
  } catch {
    return resolve(value);
  }
}

function safeSlug(value, fallback) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || fallback;
}

export function runGit(cwd, args, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn("git", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolvePromise({ exitCode: 1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(124);
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      stderr += String(error?.message ?? error);
      finish(1);
    });
    child.on("close", finish);
  });
}
