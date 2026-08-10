// Interactive Claude Code Pro OAuth recovery for the local bridge.
//
// Mode: local-only. The hosted service must never import this module.

import { spawn } from "node:child_process";

export function isClaudeOAuthAuthenticationError(value) {
  const text = String(value ?? "").toLowerCase();
  return text.includes("oauth access token has been revoked")
    || (text.includes("failed to authenticate") && (text.includes("oauth") || text.includes("401")));
}

export function buildClaudeLoginPowerShellScript(commandSpec) {
  const command = quotePowerShellLiteral(commandSpec?.command ?? "claude");
  const args = Array.isArray(commandSpec?.args) ? commandSpec.args.map(quotePowerShellLiteral).join(" ") : "";
  return [
    "$ErrorActionPreference = 'Continue'",
    "try { $Host.UI.RawUI.WindowTitle = 'Mind Atlas - Claude Code Pro login' } catch {}",
    "Write-Host 'Mind Atlas detected an expired Claude Code Pro login.' -ForegroundColor Yellow",
    "Write-Host 'Complete the Claude login flow. The original Mind Atlas request will retry automatically.'",
    `& ${command}${args ? ` ${args}` : ""}`,
    "$exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { [int]$LASTEXITCODE }",
    "if ($exitCode -eq 0) {",
    "  Write-Host 'Claude login completed. Returning to Mind Atlas...' -ForegroundColor Green",
    "  Start-Sleep -Seconds 1",
    "} else {",
    "  Write-Host ('Claude login did not complete (exit ' + $exitCode + ').') -ForegroundColor Red",
    "  Read-Host 'Press Enter to close this window' | Out-Null",
    "}",
    "exit $exitCode",
  ].join("\r\n");
}

export function createClaudeAuthRecovery({
  buildCommand,
  buildEnv = () => process.env,
  onSuccess = () => {},
  platform = process.platform,
  spawnProcess = spawn,
} = {}) {
  let inFlight = null;

  return async function recoverClaudeAuth({ workspace = "" } = {}) {
    if (inFlight) return await inFlight;
    const commandSpec = buildCommand?.(["auth", "login"]) ?? { command: "claude", args: ["auth", "login"] };
    const env = buildEnv();
    const task = launchInteractiveLogin({ commandSpec, workspace, env, platform, spawnProcess })
      .then(async (result) => {
        if (result.ok) await onSuccess();
        return result;
      });
    let tracked;
    tracked = task.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return await tracked;
  };
}

function launchInteractiveLogin({ commandSpec, workspace, env, platform, spawnProcess }) {
  if (platform !== "win32") {
    return waitForProcess(spawnProcess(commandSpec.command, commandSpec.args, {
      cwd: workspace || process.cwd(),
      env,
      windowsHide: false,
      stdio: "inherit",
    }));
  }

  const script = buildClaudeLoginPowerShellScript(commandSpec);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawnProcess("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ], {
    cwd: workspace || process.cwd(),
    env,
    // On Windows a detached console process gets its own visible window. Keep
    // the child referenced so the bridge can await the user's login result.
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  return waitForProcess(child);
}

function waitForProcess(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", (error) => finish({
      ok: false,
      exitCode: null,
      detail: `Claude login window could not start: ${String(error?.message ?? error)}`,
    }));
    child.on("close", (code) => finish({
      ok: code === 0,
      exitCode: code ?? null,
      detail: code === 0
        ? "Claude Code Pro login completed."
        : `Claude Code Pro login was cancelled or failed (exit ${code ?? "unknown"}).`,
    }));
  });
}

function quotePowerShellLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}
