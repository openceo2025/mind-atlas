import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const serviceRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnvFile(path.join(serviceRootDir, ".env"));
loadEnvFile(path.join(serviceRootDir, ".env.local"));
loadEnvFile(path.join(serviceRootDir, ".env.service"));

export function getEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function getRequiredEnv(name) {
  const value = getEnv(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readIntEnv(name, fallback) {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export function parseListEnv(name, fallback = []) {
  const raw = getEnv(name);
  if (!raw.trim()) return fallback;
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

export function parseJsonEnv(name, fallback) {
  const raw = getEnv(name);
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}
