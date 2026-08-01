import fs from "node:fs";
import path from "node:path";
import { japaneseMessages } from "../src/i18n/messages.ts";
import { catalogHash, commandArgument, messageHash, pageSourceMessages, readJson, rootDir, sortedSourceMessages, writeJson } from "./i18n-lib.ts";

const locale = commandArgument("--locale")?.trim();
if (!locale || locale === "en") {
  console.error("Usage: npm run i18n:job -- --locale <target-locale>");
  process.exit(1);
}

const config = readJson<{ plannedLocales: string[]; runtimeLocales: string[] }>(path.join(rootDir, "i18n", "config.json"));
if (![...config.plannedLocales, ...config.runtimeLocales].includes(locale)) {
  console.error(`${locale} is not declared in i18n/config.json`);
  process.exit(1);
}

const source = sortedSourceMessages();
const existingPath = path.join(rootDir, "i18n", "translations", `${locale}.json`);
const existingTranslations = fs.existsSync(existingPath) ? readJson<Record<string, string>>(existingPath) : {};
const existing = {
  ...existingTranslations,
  ...(locale === "ja" ? japaneseMessages : {}),
  // Structured static-page catalogs are already human/model translated per
  // locale and are the source of truth for page messages.
  ...pageSourceMessages(locale),
};
const glossary = readJson<{ schemaVersion: number }>(path.join(rootDir, "i18n", "glossary.json"));
const job = {
  schemaVersion: 1,
  sourceLocale: "en",
  targetLocale: locale,
  sourceCatalogHash: catalogHash(source),
  glossaryVersion: glossary.schemaVersion,
  instructions: [
    "Edit only translation values.",
    "Preserve every ICU argument in braces exactly.",
    "Do not translate product names, provider names, model ids, paths, or keyboard shortcuts.",
    "Keep labels compact enough for mobile controls.",
    "Return valid UTF-8 JSON without markdown fences.",
  ],
  messages: Object.fromEntries(Object.entries(source).map(([id, value]) => [id, {
    source: value,
    sourceHash: messageHash(id, value),
    translation: existing[id] ?? "",
  }])),
};

const outputPath = path.join(rootDir, "i18n", "jobs", `${locale}.json`);
writeJson(outputPath, job);
console.log(`Translation job written: ${path.relative(rootDir, outputPath)} (${Object.keys(source).length} messages)`);
