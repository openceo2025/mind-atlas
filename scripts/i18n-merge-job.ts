import fs from "node:fs";
import path from "node:path";
import { assertIcuCompatible, catalogHash, messageHash, readJson, rootDir, sortedSourceMessages, writeJson } from "./i18n-lib.ts";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run i18n:merge -- i18n/jobs/<locale>.json");
  process.exit(1);
}

const inputPath = path.resolve(rootDir, input);
const job = readJson<{
  schemaVersion: number;
  sourceLocale: string;
  targetLocale: string;
  sourceCatalogHash: string;
  messages: Record<string, { source: string; sourceHash: string; translation: string }>;
}>(inputPath);
const source = sortedSourceMessages();

if (job.schemaVersion !== 1 || job.sourceLocale !== "en") throw new Error("Unsupported translation job schema or source locale.");
if (job.sourceCatalogHash !== catalogHash(source)) throw new Error("The source catalog changed after this job was created. Create a fresh job.");

const translations: Record<string, string> = {};
for (const [id, sourceMessage] of Object.entries(source)) {
  const item = job.messages[id];
  if (!item) throw new Error(`${id}: missing from translation job.`);
  if (item.source !== sourceMessage || item.sourceHash !== messageHash(id, sourceMessage)) throw new Error(`${id}: source text was modified.`);
  const translation = item.translation?.trim();
  if (!translation) throw new Error(`${id}: translation is empty.`);
  assertIcuCompatible(id, sourceMessage, translation);
  translations[id] = translation;
}

const extra = Object.keys(job.messages).filter((id) => !(id in source));
if (extra.length) throw new Error(`Translation job contains unknown ids: ${extra.join(", ")}`);

const outputPath = path.join(rootDir, "i18n", "translations", `${job.targetLocale}.json`);
writeJson(outputPath, Object.fromEntries(Object.entries(translations).sort(([left], [right]) => left.localeCompare(right))));
console.log(`Validated translation written: ${path.relative(rootDir, outputPath)}`);
console.log("This locale is still disabled until a maintainer reviews it and adds it to the runtime registry.");
