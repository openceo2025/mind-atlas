// Which local directories an agent run may target.
//
// Mode: local-only.
//
// Default (`workRoots` empty): any existing directory is allowed except a small
// deny-list of system and credential locations. Running agents across many
// local repositories is the entire point of local developer mode, so a
// per-repository allow-list would break the product.
//
// Hardened (`workRoots` non-empty): only those roots, the bridge working
// directory, and paths inside them are allowed.
//
// The real defence against a hostile web page is the loopback bind plus the
// Origin check on mutating routes - a browser cannot forge `Origin`. This
// deny-list is not a boundary against a local attacker, who could already run
// `codex` directly. It is a guardrail so a mistyped or model-suggested work
// root cannot land on credentials or the operating system.

import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const CREDENTIAL_DIRS = [".codex", ".claude", ".ssh", ".aws", ".gnupg", ".config/gcloud"];

export function isInsideDirectory(root, candidate) {
  const rel = relative(root, candidate);
  return Boolean(rel) && !rel.startsWith("..") && !/^[A-Za-z]:/.test(rel);
}

/**
 * @param {string} workspace
 * @param {{ workRoots?: string[], defaultRoots?: string[], env?: NodeJS.ProcessEnv }} options
 */
export function checkAgentWorkspace(workspace, options = {}) {
  const env = options.env ?? process.env;
  const value = String(workspace ?? "").trim();
  if (!value) return { ok: true };

  let resolved;
  try {
    resolved = resolve(value);
  } catch {
    return { ok: false, detail: "Workspace path could not be resolved." };
  }
  if (!existsSync(resolved)) return { ok: false, detail: `Workspace does not exist: ${resolved}` };

  const denied = deniedWorkspaceReason(resolved, env);
  if (denied) return { ok: false, detail: denied };

  const workRoots = (options.workRoots ?? []).filter(Boolean);
  if (!workRoots.length) return { ok: true };

  const roots = [...(options.defaultRoots ?? []), ...workRoots]
    .map((root) => {
      try {
        return resolve(String(root ?? ""));
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const allowed = roots.some((root) => resolved === root || isInsideDirectory(root, resolved));
  if (allowed) return { ok: true };
  return {
    ok: false,
    detail: `MIND_ATLAS_AGENT_WORK_ROOTS restricts agent runs to ${roots.join(", ")}. Add this path to that list to allow it: ${resolved}`,
  };
}

export function deniedWorkspaceReason(resolved, env = process.env) {
  const normalized = String(resolved).replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(normalized) || normalized === "" || normalized === "/") {
    return `A whole drive is not a safe agent work root: ${resolved}`;
  }

  const home = env.USERPROFILE || env.HOME || "";
  if (home) {
    let resolvedHome = "";
    try {
      resolvedHome = resolve(home);
    } catch {
      resolvedHome = "";
    }
    if (resolvedHome && resolvedHome.toLowerCase() === normalized.toLowerCase()) {
      return `Your home directory holds provider credentials and is not a safe agent work root. Choose a project folder inside it, or add it to MIND_ATLAS_AGENT_WORK_ROOTS deliberately: ${resolved}`;
    }
  }

  const systemRoots = [
    env.SystemRoot,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramData,
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/System",
  ]
    .filter(Boolean)
    .map((entry) => {
      try {
        return resolve(String(entry));
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  for (const root of systemRoots) {
    if (normalized.toLowerCase() === root.toLowerCase() || isInsideDirectory(root, normalized)) {
      return `System directories are not valid agent work roots: ${resolved}`;
    }
  }

  const lower = normalized.toLowerCase().replace(/\//g, sep);
  for (const secretDir of CREDENTIAL_DIRS) {
    const marker = `${sep}${secretDir.replace(/\//g, sep)}`.toLowerCase();
    if (lower.endsWith(marker) || lower.includes(`${marker}${sep}`)) {
      return `Credential directories are not valid agent work roots: ${resolved}`;
    }
  }
  return "";
}
