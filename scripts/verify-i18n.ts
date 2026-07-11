import path from "node:path";
import { parse } from "@formatjs/icu-messageformat-parser";
import { japaneseMessages, sourceMessages } from "../src/i18n/messages.ts";
import { normalizeLocale, resolveLocale } from "../src/i18n/locales.ts";
import { pseudoLocalize } from "../src/i18n/pseudo.ts";
import { assertIcuCompatible, catalogHash, readJson, rootDir, sortedSourceMessages } from "./i18n-lib.ts";

const failures: string[] = [];

for (const [id, source] of Object.entries(sourceMessages)) {
  try {
    parse(source);
    const japanese = japaneseMessages[id as keyof typeof japaneseMessages];
    if (japanese) assertIcuCompatible(id, source, japanese);
    assertIcuCompatible(id, source, pseudoLocalize(source));
    assertIcuCompatible(id, source, pseudoLocalize(source, true));
  } catch (error) {
    failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const id of Object.keys(japaneseMessages)) {
  if (!(id in sourceMessages)) failures.push(`Japanese catalog has unknown id: ${id}`);
}

for (const [id, source] of Object.entries(sortedSourceMessages())) {
  try {
    parse(source);
  } catch (error) {
    failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (resolveLocale("auto", ["ja-JP", "en-US"]) !== "ja") failures.push("ja-JP locale resolution failed.");
if (resolveLocale("auto", ["xx-ZZ"]) !== "en") failures.push("Unsupported locale must fall back to English.");
if (normalizeLocale("EN_us") !== "en") failures.push("Locale normalization failed.");
if (normalizeLocale("ar-XB") !== "ar-XB") failures.push("RTL pseudo locale normalization failed.");

const config = readJson<{ sourceLocale: string; runtimeLocales: string[] }>(path.join(rootDir, "i18n", "config.json"));
if (config.sourceLocale !== "en") failures.push("English must remain the canonical source locale.");
if (!config.runtimeLocales.includes("en") || !config.runtimeLocales.includes("ja")) failures.push("English and Japanese runtime locales must stay registered.");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`i18n catalog ok: ${Object.keys(sourceMessages).length} app messages / ${Object.keys(sortedSourceMessages()).length} total messages`);
console.log(`source catalog hash: ${catalogHash()}`);
