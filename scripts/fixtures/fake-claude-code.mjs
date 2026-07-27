import { writeFile } from "node:fs/promises";

const delayMs = Math.max(0, Number(process.env.MIND_ATLAS_FAKE_CLAUDE_DELAY_MS ?? 0));
const exitCode = Number(process.env.MIND_ATLAS_FAKE_CLAUDE_EXIT_CODE ?? 0);

if (process.argv.slice(2).join(" ") === "auth status") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));
  process.exit(0);
}

if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));

if (exitCode !== 0) {
  process.stderr.write("Fake Claude Code failure for agent recovery verification.\n");
  process.exit(exitCode);
}

const capturePath = process.env.MIND_ATLAS_FAKE_CLAUDE_CAPTURE_PATH;
if (capturePath) {
  const capturedEnv = {};
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "MIND_ATLAS_CLAUDE_API_KEY",
    "MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN",
    "DEEPSEEK_API_KEY",
  ]) {
    capturedEnv[key] = process.env[key] ?? null;
  }
  await writeFile(capturePath, JSON.stringify({ args: process.argv.slice(2), env: capturedEnv }, null, 2), "utf8");
}

process.stdout.write(JSON.stringify({
  result: "Recovered fixture response.",
  model: "fake-claude-code",
  session_id: "fake-session",
  usage: { input_tokens: 12, output_tokens: 4 },
}));
