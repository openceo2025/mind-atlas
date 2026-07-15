import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { getEnv } from "./service-config.mjs";
import { replaceTrafficDaily } from "./service-db.mjs";

const BOT_PATTERN = /bot|crawler|spider|slurp|headless|lighthouse|preview|facebookexternalhit|twitterbot|discordbot|curl|wget/i;
const ASSET_PATTERN = /\.(?:js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp4|webm|json)$/i;

export async function aggregateNginxTraffic({ day = yesterdayUtc(), logDir = "/var/log/nginx", logPrefix = "mind-atlas-analytics.log" } = {}) {
  const analyticsKey = getEnv("MIND_ATLAS_ANALYTICS_HMAC_KEY");
  if (!analyticsKey) throw new Error("MIND_ATLAS_ANALYTICS_HMAC_KEY is required for traffic aggregation");
  const files = await findLogFiles(logDir, logPrefix);
  const groups = new Map();
  for (const file of files) {
    const text = await readMaybeGzip(file);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (String(entry.time ?? "").slice(0, 10) !== day) continue;
      const uri = safeString(entry.uri, 400);
      if (!isTrackedPublicPage(uri)) continue;
      const isBot = BOT_PATTERN.test(safeString(entry.user_agent, 600));
      const isAdmin = entry.admin === "1" || entry.admin === 1;
      const dimensions = classifyDimensions(entry, uri);
      const visitor = dailyVisitorHash(analyticsKey, day, entry.ip, entry.user_agent);
      addEntry(groups, { ...dimensions, visitor, entry, isBot, isAdmin });
      addEntry(groups, {
        pageGroup: "__all__",
        landingPage: "__all__",
        referrerHost: "",
        utmSource: "",
        utmMedium: "",
        utmCampaign: "",
        locale: "all",
        deviceClass: "all",
        visitor,
        entry,
        isBot,
        isAdmin,
      });
    }
  }
  const rows = [...groups.values()].map((row) => ({
    ...row,
    uniqueVisitors: row.visitors.size,
    visitors: undefined,
  }));
  await replaceTrafficDaily(day, rows);
  return { day, files: files.length, rows: rows.length, pageViews: rows.find((row) => row.pageGroup === "__all__")?.pv ?? 0 };
}

export function dailyVisitorHash(key, day, ip, userAgent) {
  return crypto.createHmac("sha256", key).update(`${day}:${safeString(ip, 80)}:${safeString(userAgent, 600)}`).digest("hex");
}

export function classifyDimensions(entry, uri) {
  return {
    pageGroup: pageGroup(uri),
    landingPage: landingPage(uri),
    referrerHost: safeHost(entry.referrer_host),
    utmSource: safeString(entry.utm_source, 120),
    utmMedium: safeString(entry.utm_medium, 120),
    utmCampaign: safeString(entry.utm_campaign, 160),
    locale: localeFromRequest(uri, entry.accept_language),
    deviceClass: deviceClass(entry.user_agent),
  };
}

function addEntry(groups, dimensions) {
  const key = [
    dimensions.pageGroup,
    dimensions.landingPage,
    dimensions.referrerHost,
    dimensions.utmSource,
    dimensions.utmMedium,
    dimensions.utmCampaign,
    dimensions.locale,
    dimensions.deviceClass,
  ].join("\u001f");
  let row = groups.get(key);
  if (!row) {
    row = {
      pageGroup: dimensions.pageGroup,
      landingPage: dimensions.landingPage,
      referrerHost: dimensions.referrerHost,
      utmSource: dimensions.utmSource,
      utmMedium: dimensions.utmMedium,
      utmCampaign: dimensions.utmCampaign,
      locale: dimensions.locale,
      deviceClass: dimensions.deviceClass,
      pv: 0,
      botPv: 0,
      error4xx: 0,
      error5xx: 0,
      responseMsTotal: 0,
      responseCount: 0,
      visitors: new Set(),
    };
    groups.set(key, row);
  }
  if (dimensions.isBot) {
    row.botPv += 1;
    return;
  }
  if (dimensions.isAdmin) return;
  row.pv += 1;
  row.visitors.add(dimensions.visitor);
  const status = Number(dimensions.entry.status ?? 0);
  if (status >= 400 && status < 500) row.error4xx += 1;
  if (status >= 500) row.error5xx += 1;
  const responseMs = Math.max(0, Number(dimensions.entry.request_time ?? 0) * 1000);
  if (Number.isFinite(responseMs)) {
    row.responseMsTotal += Math.round(responseMs);
    row.responseCount += 1;
  }
}

export function isTrackedPublicPage(uri) {
  if (!uri || ASSET_PATTERN.test(uri)) return false;
  if (uri === "/" || uri === "/about.html" || uri === "/privacy.html" || uri === "/terms.html") return true;
  return /^\/[A-Za-z]{2}(?:-[A-Za-z]+)?\/(?:about|privacy|terms)\.html$/.test(uri);
}

function pageGroup(uri) {
  if (uri === "/" || /^\/[a-z]{2}(?:-[A-Za-z]+)?\/?$/.test(uri)) return "app";
  if (uri.endsWith("/about.html") || uri === "/about.html") return "about";
  if (uri.endsWith("/privacy.html") || uri === "/privacy.html") return "privacy";
  if (uri.endsWith("/terms.html") || uri === "/terms.html") return "terms";
  return "other";
}

function landingPage(uri) {
  const normalized = safeString(uri, 200).replace(/\/+$/, "") || "/";
  return normalized;
}

function localeFromRequest(uri, acceptLanguage) {
  const pathLocale = uri.match(/^\/([a-z]{2}(?:-[A-Za-z]+)?)\//)?.[1];
  const raw = pathLocale || safeString(acceptLanguage, 80).split(",")[0]?.split(";")[0] || "unknown";
  return /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(raw) ? raw : "unknown";
}

function deviceClass(userAgent) {
  const ua = safeString(userAgent, 600);
  if (/ipad|tablet|kindle|silk/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "mobile";
  return ua ? "desktop" : "unknown";
}

async function findLogFiles(logDir, prefix) {
  let names = [];
  try {
    names = await fsp.readdir(logDir);
  } catch {
    return [];
  }
  return names.filter((name) => name === prefix || name.startsWith(`${prefix}.`)).map((name) => path.join(logDir, name));
}

async function readMaybeGzip(file) {
  const buffer = await fsp.readFile(file);
  if (file.endsWith(".gz")) return zlib.gunzipSync(buffer).toString("utf8");
  return buffer.toString("utf8");
}

function safeHost(value) {
  const text = safeString(value, 253).toLowerCase();
  return /^[a-z0-9.-]+(?::\d{1,5})?$/.test(text) ? text : "";
}

function safeString(value, maxLength) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength) : "";
}

function yesterdayUtc() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
