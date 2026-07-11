import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@formatjs/icu-messageformat-parser";
import { sourceMessages } from "../src/i18n/messages.ts";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function sortedSourceMessages() {
  const messages = { ...sourceMessages, ...pageSourceMessages() };
  return Object.fromEntries(Object.entries(messages).sort(([left], [right]) => left.localeCompare(right)));
}

export function pageSourceMessages(locale = "en") {
  const pagesDir = path.join(rootDir, "i18n", "pages", locale);
  const about = readJson<{ metaDescription: string; messages: Record<string, string> }>(path.join(pagesDir, "about.json"));
  const result: Record<string, string> = { "page.about.metaDescription": about.metaDescription };
  for (const [id, value] of Object.entries(about.messages)) result[`page.${id}`] = value;
  for (const page of ["privacy", "terms"]) {
    const content = readJson<Record<string, unknown>>(path.join(pagesDir, `${page}.json`));
    flattenPageValue(result, `page.${page}`, content);
  }
  return result;
}

function flattenPageValue(target: Record<string, string>, prefix: string, value: unknown) {
  if (typeof value === "string") {
    target[prefix] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenPageValue(target, `${prefix}.${index}`, item));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flattenPageValue(target, `${prefix}.${key}`, item);
  }
}

export function catalogHash(messages = sortedSourceMessages()) {
  return crypto.createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

export function messageHash(id: string, source: string) {
  return crypto.createHash("sha256").update(`${id}\0${source}`).digest("hex");
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function icuArguments(message: string) {
  const names = new Set<string>();
  const visit = (nodes: ReturnType<typeof parse>) => {
    for (const node of nodes) {
      if ("value" in node && typeof node.value === "string" && node.type !== 0) names.add(node.value);
      if ("options" in node && node.options) {
        for (const option of Object.values(node.options)) visit(option.value);
      }
      if ("children" in node && Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(parse(message, { captureLocation: false }));
  return [...names].sort();
}

export function assertIcuCompatible(id: string, source: string, translation: string) {
  const sourceArguments = icuArguments(source);
  const targetArguments = icuArguments(translation);
  if (JSON.stringify(sourceArguments) !== JSON.stringify(targetArguments)) {
    throw new Error(`${id}: ICU arguments differ. source=${sourceArguments.join(",")} target=${targetArguments.join(",")}`);
  }
}

export function commandArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
