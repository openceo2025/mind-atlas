// Exercises the bridge's local galaxy judge against a fake llama-server, so the
// label rotation and probability mapping are checked without a real model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createGalaxyJudge } from "./galaxy-judge.mjs";

const FAVOURED = ["Publicly available", "Outside people use it repeatedly"];

const server = createServer((request, response) => {
  if (request.url === "/props") {
    response.end(JSON.stringify({ model_path: "C:/models/fake-judge.gguf" }));
    return;
  }
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const payload = JSON.parse(body);
    const prompt = payload.messages[0].content;
    // Find the label printed next to the favoured option, whatever the rotation.
    const lines = prompt.split("\n");
    const favoured = lines.find((line) => FAVOURED.some((text) => line.includes(text)) && /^[A-Z]\. /.test(line));
    const label = favoured ? favoured[0] : "A";
    const labels = payload.grammar.match(/"([A-Z])"/g).map((quoted) => quoted.replaceAll('"', ""));
    const top = labels.map((item) => ({ token: item, logprob: item === label ? -0.05 : -4 }));
    response.end(JSON.stringify({ choices: [{ logprobs: { content: [{ top_logprobs: top }] } }] }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  const judge = createGalaxyJudge({ env: {} });
  const status = await judge.status(url);
  assert.equal(status.llama.available, true);
  assert.equal(status.llama.model, "fake-judge.gguf");

  const result = await judge.judge({
    backend: "llama",
    llamaUrl: url,
    state: "Project: test",
    questions: {
      stage: {
        type: "choice",
        instructions: "Which stage?",
        criteria: { idea: "Only an idea", launched: "Publicly available", earning: "Publicly earning" },
      },
      demand: {
        type: "score",
        instructions: "Demand?",
        criteria: ["No evidence", "A few tried", "Outside people use it repeatedly", "Paid"],
      },
    },
  });
  assert.equal(result.model, "llama:fake-judge.gguf");
  assert.equal(result.answers.stage.choice, "launched", "rotation maps labels back to the right option");
  assert.ok(result.answers.stage.confidence > 0.9);
  assert.ok(Math.abs(result.answers.demand.score - 2) < 0.2, `score lands on the favoured level (${result.answers.demand.score})`);

  const offline = createGalaxyJudge({ env: {} });
  const down = await offline.status("http://127.0.0.1:9");
  assert.equal(down.llama.available, false);
  assert.equal(down.jev.configured, process.platform === "win32" ? down.jev.configured : false);
  await assert.rejects(offline.judge({ backend: "llama", llamaUrl: "http://127.0.0.1:9", questions: { a: { type: "choice", criteria: { x: "x", y: "y" } } } }), /not reachable/);
  await assert.rejects(offline.judge({ backend: "llama", llamaUrl: url, questions: {} }), /No questions/);
} finally {
  server.close();
}
console.log("galaxy local judge ok");
