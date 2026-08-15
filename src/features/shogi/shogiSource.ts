const SUPPORTED_SHOGI_SOURCE_HOSTS = new Set(["shogiwars.heroz.jp", "kifu.questgames.net"]);

export function extractSupportedShogiSourceUrl(value: string): string | null {
  const decoded = decodeBasicHtmlEntities(String(value ?? ""));
  const candidates = decoded.match(/https:\/\/[^\s<>"'\]]+/gi) ?? [];
  for (const candidate of candidates) {
    const normalized = candidate.replace(/[),.;:!?}\u3001\u3002\u300d\u300f\u3011]+$/g, "");
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      continue;
    }
    if (!SUPPORTED_SHOGI_SOURCE_HOSTS.has(url.hostname)) continue;
    if (url.username || url.password || (url.port && url.port !== "443")) continue;
    if (url.hostname === "shogiwars.heroz.jp" && /^\/games\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) {
      return url.toString();
    }
    if (url.hostname === "kifu.questgames.net" && /^\/shogi\/games\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
      return url.toString();
    }
  }
  return null;
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;|&#x26;/gi, "&");
}
