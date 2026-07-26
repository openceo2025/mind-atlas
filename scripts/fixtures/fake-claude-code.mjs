const delayMs = Math.max(0, Number(process.env.MIND_ATLAS_FAKE_CLAUDE_DELAY_MS ?? 0));
const exitCode = Number(process.env.MIND_ATLAS_FAKE_CLAUDE_EXIT_CODE ?? 0);

if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));

if (exitCode !== 0) {
  process.stderr.write("Fake Claude Code failure for agent recovery verification.\n");
  process.exit(exitCode);
}

process.stdout.write(JSON.stringify({
  result: "Recovered fixture response.",
  model: "fake-claude-code",
  session_id: "fake-session",
  usage: { input_tokens: 12, output_tokens: 4 },
}));
