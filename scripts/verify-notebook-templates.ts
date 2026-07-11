import assert from "node:assert/strict";
import { createNotebookFromTemplate, NOTEBOOK_TEMPLATES } from "../src/notebookTemplates.ts";
import type { AtlasNode } from "../src/types.ts";

function child(root: AtlasNode, title: string) {
  const found = root.children.find((node) => node.title === title);
  assert.ok(found, `Missing node: ${title}`);
  return found;
}

function titles(root: AtlasNode) {
  return root.children.map((node) => node.title);
}

assert.equal(NOTEBOOK_TEMPLATES.length, 6, "Six start templates should be offered.");

const blank = createNotebookFromTemplate("blank");
assert.equal(blank.children.length, 0, "Blank template should have no user nodes.");

const daily = createNotebookFromTemplate("daily-notes");
assert.deepEqual(titles(daily), ["すぐにやること", "そのうちやること", "あとまわしにすること", "だれかに頼むこと"]);
for (const category of daily.children) {
  assert.equal(category.children.length, 1, `${category.title} should include a starter note.`);
  assert.equal(category.children[0].body, "ここに詳細を書く");
}

const novel = createNotebookFromTemplate("novel");
assert.deepEqual(titles(novel), ["世界観", "登場人物", "あらすじ", "本文"]);
assert.ok(child(child(novel, "本文"), "第1章"));

const swot = createNotebookFromTemplate("swot");
assert.deepEqual(titles(swot), ["Strengths - 強み", "Weaknesses - 弱み", "Opportunities - 機会", "Threats - 脅威"]);

const travel = createNotebookFromTemplate("travel");
assert.deepEqual(titles(travel), ["やりたいこと", "旅行計画", "持ち物", "予約/チケット情報"]);
assert.deepEqual(titles(child(travel, "やりたいこと")), ["見たい景色", "体験したいこと", "食べたいもの", "聞きたいこと"]);
assert.ok(child(child(travel, "旅行計画"), "1日目"));
assert.ok(child(child(travel, "旅行計画"), "2日目"));

const scamper = createNotebookFromTemplate("scamper");
assert.ok(child(scamper, "Substitute - 置き換える"));
assert.ok(child(scamper, "Reverse - 逆にする"));
assert.ok(child(scamper, "次に試すこと"));

console.log("Notebook templates verified.");
