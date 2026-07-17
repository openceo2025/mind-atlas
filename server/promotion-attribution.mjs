const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

export const GOOGLE_LOGIN_TRIGGERS = new Set(["cloud_save", "share", "account", "remix"]);

export function matchPromotionShortPath(pathname) {
  const match = String(pathname || "").match(/^\/go\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  const campaign = safeDecodedCode(match[1]);
  const partner = safeDecodedCode(match[2]);
  const asset = safeDecodedCode(match[3]);
  return campaign && partner && asset ? { campaign, partner, asset } : null;
}

export function buildPromotionRedirect(pathname, searchParams = new URLSearchParams()) {
  const matched = matchPromotionShortPath(pathname);
  if (!matched) return null;
  const platform = safeCode(searchParams.get("platform")) || "social";
  const locale = safeLocale(searchParams.get("locale"));
  const output = new URLSearchParams({
    utm_source: matched.partner,
    utm_medium: platform,
    utm_campaign: matched.campaign,
    utm_content: matched.asset,
  });
  if (locale) output.set("locale", locale);
  return {
    location: `/?${output.toString()}`,
    attribution: { ...matched, platform, locale },
  };
}

export function promotionContextFromGoogleStart(returnTo, trigger) {
  let target;
  try {
    target = new URL(String(returnTo || "/"), "https://mind-atlas.invalid");
  } catch {
    target = new URL("https://mind-atlas.invalid/");
  }
  return normalizePromotionContext({
    campaign: target.searchParams.get("utm_campaign"),
    partner: target.searchParams.get("utm_source"),
    asset: target.searchParams.get("utm_content"),
    platform: target.searchParams.get("utm_medium"),
    locale: target.searchParams.get("locale"),
    trigger,
  });
}

export function normalizePromotionContext(value = {}) {
  return {
    campaign: safeCode(value.campaign),
    partner: safeCode(value.partner),
    asset: safeCode(value.asset),
    platform: safeCode(value.platform),
    locale: safeLocale(value.locale),
    trigger: safeTrigger(value.trigger),
  };
}

export function encodePromotionContext(value) {
  return Buffer.from(JSON.stringify(normalizePromotionContext(value)), "utf8").toString("base64url");
}

export function decodePromotionContext(value) {
  const text = String(value || "");
  if (!text || text.length > 1024) return normalizePromotionContext();
  try {
    return normalizePromotionContext(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
  } catch {
    return normalizePromotionContext();
  }
}

function safeDecodedCode(value) {
  try {
    return safeCode(decodeURIComponent(value));
  } catch {
    return "";
  }
}

function safeCode(value) {
  const text = String(value || "").trim();
  return CODE_PATTERN.test(text) ? text : "";
}

function safeLocale(value) {
  const text = String(value || "").trim();
  return LOCALE_PATTERN.test(text) ? text : "";
}

function safeTrigger(value) {
  const text = String(value || "").trim();
  return GOOGLE_LOGIN_TRIGGERS.has(text) ? text : "account";
}
