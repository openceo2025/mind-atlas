// 公開ビルドの検査：hosted マーカーがあり、ローカル専用の機能（エージェント・ブリッジ）が含まれていないこと。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(rootDir, "dist-spatial");
const fail = (message) => {
  console.error(`verify:spatial-dist failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(path.join(outDir, "index.html"))) fail("dist-spatial/index.html is missing (run npm run spatial:build:hosted)");
const marker = JSON.parse(fs.readFileSync(path.join(outDir, ".mind-atlas-build.json"), "utf8"));
if (marker.mode !== "hosted-public" || marker.publicService !== true) fail("the build marker is not hosted-public");
for (const required of ["404.html", "robots.txt"]) if (!fs.existsSync(path.join(outDir, required))) fail(`${required} is missing`);

const forbidden = ["/api/agent-runs", "127.0.0.1:8787", "AgentWindow", "sk-", "whsec_"];
const files = fs.readdirSync(path.join(outDir, "assets")).filter((f) => f.endsWith(".js"));
for (const file of files) {
  const text = fs.readFileSync(path.join(outDir, "assets", file), "utf8");
  for (const needle of forbidden) {
    if (needle === "sk-" ? /\bsk-[A-Za-z0-9]{20,}/.test(text) : text.includes(needle)) fail(`${file} contains "${needle}"`);
  }
}
console.log(`verify:spatial-dist ok (${files.length} scripts checked)`);
