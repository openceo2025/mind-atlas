import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(rootDir, "i18n", "hardcoded-baseline.json");
const updateBaseline = process.argv.includes("--update-baseline");
const files = execFileSync("rg", ["--files", "src", "-g", "*.tsx", "-g", "*.ts"], { cwd: rootDir, encoding: "utf8" })
  .trim().split(/\r?\n/).filter((file) => file && !file.startsWith("src\\i18n") && !file.startsWith("src/i18n"));
const entries = [];
const translatedAttributes = new Set(["aria-label", "placeholder", "title", "alt"]);
const dialogFunctions = new Set(["alert", "confirm", "prompt"]);

for (const file of files) {
  const source = fs.readFileSync(path.join(rootDir, file), "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (kind, value) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || !/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(normalized)) return;
    entries.push(`${file.replaceAll("\\", "/")}|${kind}|${normalized}`);
  };
  const visit = (node, insideJsxExpression = false) => {
    if (ts.isJsxText(node)) add("jsx", node.getText(sourceFile));
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && translatedAttributes.has(node.name.text)) {
      add(`attr:${node.name.text}`, node.initializer.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      const expression = node.expression;
      const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : "";
      if (dialogFunctions.has(name)) add(`dialog:${name}`, node.arguments[0].text);
      if (isVisibleStateSetter(name)) add(`state:${name}`, node.arguments[0].text);
    }
    if (ts.isCallExpression(node) && node.arguments.length && ts.isTemplateExpression(node.arguments[0])) {
      const expression = node.expression;
      const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : "";
      if (isVisibleStateSetter(name)) {
        const template = [node.arguments[0].head.text, ...node.arguments[0].templateSpans.map((span) => `{value}${span.literal.text}`)].join("");
        add(`state:${name}`, template);
      }
    }
    if (insideJsxExpression && ts.isStringLiteralLike(node) && isLikelyVisibleExpressionString(node)) {
      add("jsx-expression", node.text);
    }
    ts.forEachChild(node, (child) => visit(child, insideJsxExpression || ts.isJsxExpression(node)));
  };
  visit(sourceFile);
}

function isVisibleStateSetter(name) {
  return /^set[A-Z]/.test(name) && (/(?:Status|Message|Error)$/.test(name) || ["setCloudDirectory", "setCopyStatus"].includes(name));
}

function isLikelyVisibleExpressionString(node) {
  const value = node.text.trim();
  if (!value || value.startsWith("ui.") || value.startsWith("menu.") || value.startsWith("app.") || value.startsWith("common.") || value.startsWith("startSpace.") || value.startsWith("service.")) return false;
  if (/^(?:button|dialog|status|alert|polite|page|tab|tabpanel|tablist|presentation|true|false|open|closed|desktop|mobile|dark|light|high|low|current|incoming|outline|editor|operation|command|login|checkout|portal|file|auto|new|_blank|noreferrer|Enter|Escape|Control\+[A-Z])$/i.test(value)) return false;
  if (/^[.#/]?[a-z0-9_-]+(?:\s+[a-z0-9_-]+)*$/.test(value) && !value.includes(" ")) return false;
  const parent = node.parent;
  let container = parent;
  let containingAttribute = null;
  while (container && !ts.isJsxExpression(container)) {
    if (ts.isJsxAttribute(container)) containingAttribute = container;
    container = container.parent;
  }
  if (containingAttribute && !translatedAttributes.has(containingAttribute.name.text)) return false;
  if (container?.parent && ts.isJsxAttribute(container.parent) && !translatedAttributes.has(container.parent.name.text)) return false;
  if (ts.isCallExpression(parent)) {
    const expression = parent.expression;
    const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : "";
    if (["t", "formatAppMessage", "includes", "startsWith", "endsWith"].includes(name)) return false;
  }
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(value) || /\s/.test(value) || /^[A-Z]/.test(value) || /[.!?…:]/.test(value);
}

const counts = countEntries(entries);
if (updateBaseline) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({ schemaVersion: 1, entries: counts }, null, 2)}\n`, "utf8");
  console.log(`Hardcoded UI baseline updated: ${entries.length} occurrences`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error("Missing i18n/hardcoded-baseline.json. Review the report, then run npm run i18n:baseline once.");
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const additions = [];
for (const [entry, count] of Object.entries(counts)) {
  const allowed = baseline.entries?.[entry] ?? 0;
  if (count > allowed) additions.push(`${entry} (+${count - allowed})`);
}

console.log(`Hardcoded UI inventory: ${entries.length} occurrences / ${Object.keys(counts).length} unique`);
if (additions.length) {
  console.error("New hardcoded UI text must be moved into src/i18n/messages.ts:\n" + additions.join("\n"));
  process.exit(1);
}
console.log("No new hardcoded UI text was introduced.");

function countEntries(values) {
  const result = {};
  for (const value of values.sort()) result[value] = (result[value] ?? 0) + 1;
  return result;
}
