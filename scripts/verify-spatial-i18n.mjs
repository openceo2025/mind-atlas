// 空間UI の翻訳検査：コードで使うキーが英語原文にあり、12 言語すべてに同じキーと差し込み変数があること。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "spatial", "src");
const localeDir = path.join(srcDir, "i18n", "locales");
const LOCALES = ["en", "ja", "es", "pt-BR", "fr", "de", "ko", "zh-Hans", "zh-Hant", "id", "hi", "ar"];
const problems = [];

const read = (l) => JSON.parse(fs.readFileSync(path.join(localeDir, `${l}.json`), "utf8"));
const en = read("en");

// コード中の t('...') と、動的に組み立てるキーの接頭辞
const used = new Set();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.add(m[1]);
      for (const m of text.matchAll(/'((?:help|error|win|preset)\.[a-zA-Z0-9_.-]+)'/g)) used.add(m[1]);
    }
  }
};
walk(srcDir);
for (const key of used) if (!(key in en)) problems.push(`en: missing key used in code: ${key}`);

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const locale of LOCALES.slice(1)) {
  let data;
  try {
    data = read(locale);
  } catch (error) {
    problems.push(`${locale}: ${error.message}`);
    continue;
  }
  for (const key of Object.keys(en)) {
    if (!(key in data)) problems.push(`${locale}: missing ${key}`);
    else if (vars(data[key]) !== vars(en[key])) problems.push(`${locale}: placeholders differ in ${key}`);
    else if (!String(data[key]).trim()) problems.push(`${locale}: empty ${key}`);
  }
  for (const key of Object.keys(data)) if (!(key in en)) problems.push(`${locale}: extra key ${key}`);
}

if (problems.length) {
  console.error(problems.slice(0, 60).join("\n"));
  console.error(`verify:spatial-i18n failed with ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`verify:spatial-i18n ok (${Object.keys(en).length} keys × ${LOCALES.length} locales)`);
