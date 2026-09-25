// 線の言葉と推論の検査。
// 1) 言葉の定義表：どのセットの言葉も定義があり、画面の言葉（翻訳）がそろっていること。
// 2) 推論：演繹の線だけで推移・対偶・伝播・自己矛盾を出し、論証の線からは「必ず」を導かないこと。
//    因果の線からは根本原因と輪（悪循環・歯止め）を見つけること。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "mindatlas-relations-"));
await build({
  entryPoints: { catalog: path.join(root, "spatial/src/lib/relationCatalog.ts"), inference: path.join(root, "spatial/src/lib/inference.ts") },
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  logLevel: "error",
});
const catalog = await import(pathToFileURL(path.join(out, "catalog.js")).href);
const { infer } = await import(pathToFileURL(path.join(out, "inference.js")).href);
fs.rmSync(out, { recursive: true, force: true });

// ── 1) 言葉の定義表と翻訳 ─────────────────────────────
const en = JSON.parse(fs.readFileSync(path.join(root, "spatial/src/i18n/locales/en.json"), "utf8"));
for (const [vocab, ids] of Object.entries(catalog.VOCABULARIES)) {
  assert.ok(`vocab.${vocab}` in en && `vocab.${vocab}.hint` in en, `vocabulary ${vocab} needs a name and a hint`);
  assert.ok(ids.length <= 10, `vocabulary ${vocab} should stay within 10 words so the judge can choose well`);
  for (const id of ids) {
    const w = catalog.WORDS[id];
    assert.ok(w, `word ${id} in ${vocab} needs a definition`);
    assert.ok(w.meaning.includes("{a}") && w.meaning.includes("{b}"), `word ${id} should explain itself with {a} and {b}`);
    for (const key of [`word.${id}`, `word.${id}.say`, ...(w.directed ? [`word.${id}.back`, `word.${id}.sayBack`] : [])]) {
      assert.ok(key in en, `missing translation ${key}`);
    }
  }
}
for (const groups of Object.values(catalog.WORD_GROUPS)) for (const [group] of groups) assert.ok(`vocab.group.${group}` in en, `missing vocab.group.${group}`);
assert.equal(catalog.LEGACY_TYPES.supports, "so");
assert.equal(catalog.LEGACY_TYPES.contradicts, "but");

// ── 2) 推論 ─────────────────────────────────────────
let n = 0;
const rel = (from, type, to) => ({ id: `r${++n}`, from, to, type });
const has = (result, from, type, to) => result.derived.some((d) => d.from === from && d.to === to && d.type === type);

// 推移：A⇒B, B⇒C ⊢ A⇒C（必ず）
{
  const r = infer([rel("A", "suff", "B"), rel("B", "suff", "C")], "logic");
  assert.ok(has(r, "A", "suff", "C"), "A⇒B, B⇒C should give A⇒C");
  assert.equal(r.derived.find((d) => d.to === "C").strict, true);
}
// 行き来できれば同値
{
  const r = infer([rel("A", "suff", "B"), rel("B", "suff", "C"), rel("C", "suff", "D"), rel("D", "suff", "A")], "logic");
  assert.ok(r.derived.some((d) => d.type === "equiv" && d.rule === "equivalence"), "a cycle of ⇒ should give an equivalence");
}
// 論証（根拠）の連鎖は「必ず」にならない
{
  const r = infer([rel("A", "ground", "B"), rel("B", "suff", "C")], "logic");
  assert.ok(!has(r, "A", "suff", "C"), "a chain through 根拠 must not become a sufficient condition");
  assert.ok(has(r, "A", "ground", "C"), "a chain through 根拠 may be offered as 根拠");
  assert.equal(r.derived.find((d) => d.to === "C").strict, false);
}
// 対偶：A⇒B, A と ¬A は矛盾, B と ¬B は矛盾 ⊢ ¬B⇒¬A
{
  const r = infer([rel("A", "suff", "B"), rel("A", "contra", "nA"), rel("nB", "contra", "B")], "logic");
  assert.ok(r.derived.some((d) => d.from === "nB" && d.to === "nA" && d.type === "suff" && d.rule === "contraposition"), "contraposition should be derived");
}
// 両立しないことの伝播：A⇒B, B と C は両立しない ⊢ A と C も両立しない
{
  const r = infer([rel("A", "suff", "B"), rel("B", "excl", "C")], "logic");
  assert.ok(r.derived.some((d) => d.type === "excl" && d.from === "A" && d.to === "C"), "exclusion should propagate along ⇒");
}
// 「反論」は伝播しない（論証なので）
{
  const r = infer([rel("A", "suff", "B"), rel("B", "rebut", "C")], "logic");
  assert.ok(!r.derived.some((d) => d.type === "excl"), "a rebuttal must not propagate as an exclusion");
}
// 自己矛盾：A⇒B, A⇒C, B と C は両立しない
{
  const r = infer([rel("A", "suff", "B"), rel("A", "suff", "C"), rel("B", "excl", "C")], "logic");
  assert.ok(r.findings.some((f) => f.kind === "inconsistent" && f.cards.includes("A")), "A should be reported as inconsistent");
}
// 集合：ポチ∈ポメラニアン, ポメラニアン⊆犬, 犬⊆哺乳類 ⊢ ポチ∈哺乳類。∈ は推移しない
{
  const r = infer([rel("pochi", "member", "pome"), rel("pome", "subset", "dog"), rel("dog", "subset", "mammal")], "logic");
  assert.ok(has(r, "pochi", "member", "mammal"), "a member of a subset belongs to the superset");
  assert.ok(has(r, "pome", "subset", "mammal"), "⊆ should be transitive");
  const m = infer([rel("a", "member", "A"), rel("A", "member", "B")], "logic");
  assert.ok(!has(m, "a", "member", "B"), "∈ must not be transitive");
}
// 考える：「だから」はつないで提案、「でも」とぶつかれば注意
{
  const r = infer([rel("A", "so", "B"), rel("B", "so", "C"), rel("C", "but", "D")], "think");
  assert.ok(has(r, "A", "so", "C"), "だから chains should be offered in the think set");
  assert.ok(r.findings.some((f) => f.kind === "maybeConflict" && f.cards.includes("A") && f.cards.includes("D")), "A should maybe conflict with D");
}
// 原因を探る：根本原因と、悪循環・歯止め
{
  const r = infer([rel("root", "effect", "x"), rel("x", "effect", "y"), rel("y", "up", "z"), rel("z", "up", "y")], "cause");
  assert.ok(r.findings.some((f) => f.kind === "rootCause" && f.cards[0] === "root"), "root should be a root cause");
  assert.ok(!r.findings.some((f) => f.kind === "rootCause" && f.cards[0] === "x"), "x has a cause, so it is not a root");
  assert.equal(r.findings.find((f) => f.kind === "loop").loop, "reinforcing", "two 強める make a vicious circle");
  const b = infer([rel("p", "up", "q"), rel("q", "down", "p")], "cause");
  assert.equal(b.findings.find((f) => f.kind === "loop").loop, "balancing", "強める + 弱める make a brake");
}
// 自分の言葉は計算に入らない／すでに線があるところには何も出さない
{
  const r = infer([rel("A", "u:w-1", "B"), rel("B", "u:w-1", "C")], "think");
  assert.equal(r.derived.length + r.findings.length, 0, "custom words must not be reasoned with");
  const d = infer([rel("A", "suff", "B"), rel("B", "suff", "C"), rel("A", "related", "C")], "logic");
  assert.ok(!has(d, "A", "suff", "C"), "pairs that are already connected should not be offered");
}

console.log(`verify:spatial-relations ok (${Object.keys(catalog.WORDS).length} words, inference rules checked)`);
