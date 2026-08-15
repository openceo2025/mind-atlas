const DEFAULT_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 2;

export async function fetchSupportedShogiSource(sourceUrl, options = {}) {
  const initial = validateShogiSourceUrl(extractSupportedShogiSourceUrl(sourceUrl) ?? sourceUrl);
  const html = await fetchBoundedHtml(initial, options.fetchImpl ?? fetch);
  return initial.hostname === "shogiwars.heroz.jp"
    ? parseShogiWarsHtml(html, initial)
    : parseShogiQuestHtml(html, initial);
}

export function extractSupportedShogiSourceUrl(value) {
  const decoded = decodeHtmlEntities(String(value ?? ""));
  const candidates = decoded.match(/https:\/\/[^\s<>"'\]]+/gi) ?? [];
  for (const candidate of candidates) {
    const normalized = candidate.replace(/[),.;:!?}\u3001\u3002\u300d\u300f\u3011]+$/g, "");
    try {
      return validateShogiSourceUrl(normalized).toString();
    } catch {
      // Continue until a supported public game link is found.
    }
  }
  return null;
}

export function validateShogiSourceUrl(sourceUrl) {
  let url;
  try {
    url = new URL(String(sourceUrl ?? "").trim());
  } catch {
    throw new Error("Enter a valid Shogi Wars or Shogi Quest share URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Only HTTPS share URLs are supported.");
  }
  if (url.hostname === "shogiwars.heroz.jp" && /^\/games\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) {
    return url;
  }
  if (url.hostname === "kifu.questgames.net" && /^\/shogi\/games\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
    return url;
  }
  throw new Error("Only Shogi Wars and Shogi Quest public game links are supported.");
}

export function parseShogiWarsHtml(html, url = new URL("https://shogiwars.heroz.jp/games/imported")) {
  const attribute = String(html).match(/data-react-props="([\s\S]*?)"\s+data-react-cache-id=/)?.[1];
  if (!attribute) throw new Error("The Shogi Wars page did not contain a public game record.");
  let props;
  try {
    props = JSON.parse(decodeHtmlEntities(attribute));
  } catch {
    throw new Error("The Shogi Wars game data could not be decoded.");
  }
  const game = props?.gameHash;
  if (!game || !Array.isArray(game.moves)) throw new Error("The Shogi Wars game data is incomplete.");
  if (game.init_sfen_position && game.init_sfen_position !== DEFAULT_SFEN) {
    throw new Error("This Shogi Wars link uses a non-standard starting position, which is not supported yet.");
  }
  const moves = game.moves.map((item) => String(item?.m ?? "")).filter((move) => /^[+-]\d{4}[A-Z]{2}$/.test(move));
  if (!moves.length || moves.length !== game.moves.length || moves.length > 2000) {
    throw new Error("The Shogi Wars move list is invalid or incomplete.");
  }
  const gameId = safeLine(game.name) || gameIdFromUrl(url);
  const sente = safeLine(game.sente) || "Sente";
  const gote = safeLine(game.gote) || "Gote";
  return {
    provider: "shogi-wars",
    datasetName: `将棋ウォーズ ${sente} vs ${gote}`,
    fileName: `${safeFileName(gameId)}.csa`,
    format: "csa",
    text: buildCsa({ sente, gote, event: "将棋ウォーズ", source: url.toString(), moves }),
  };
}

export function parseShogiQuestHtml(html, url = new URL("https://kifu.questgames.net/shogi/games/imported")) {
  const source = String(html);
  const script = source.match(/window\.__NUXT__=\(function\(([^)]*)\)\{([\s\S]*?)\}\(([\s\S]*?)\)\)<\/script>/);
  if (!script) throw new Error("The Shogi Quest page did not contain a public game record.");
  const parameters = script[1].split(",").map((value) => value.trim()).filter(Boolean);
  let argumentsList;
  try {
    argumentsList = JSON.parse(`[${script[3]}]`);
  } catch {
    throw new Error("The Shogi Quest game variables could not be decoded.");
  }
  const variables = new Map(parameters.map((name, index) => [name, argumentsList[index]]));
  const movesSource = script[2].match(/\.position=\{moves:\[([\s\S]*?)\]\}/)?.[1];
  if (!movesSource) throw new Error("The Shogi Quest move list was not found.");
  const moves = [];
  for (const match of movesSource.matchAll(/\{[^{}]*?\bm:(?:"([0-9]{4}[A-Z]{2})"|([A-Za-z_$][\w$]*))[^{}]*?\}/g)) {
    const raw = match[1] || variables.get(match[2]);
    if (typeof raw !== "string" || !/^\d{4}[A-Z]{2}$/.test(raw)) {
      throw new Error("The Shogi Quest move list contains an unsupported value.");
    }
    moves.push(`${moves.length % 2 === 0 ? "+" : "-"}${raw}`);
  }
  if (!moves.length || moves.length > 2000) throw new Error("The Shogi Quest move list is invalid or empty.");
  const titleText = decodeHtmlEntities(source.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const names = titleText.match(/\|\s*(.*?)\(R[^)]*\)\s+vs\s+(.*?)\(R[^)]*\)/i);
  const sente = safeLine(names?.[1]) || "Sente";
  const gote = safeLine(names?.[2]) || "Gote";
  const gameId = gameIdFromUrl(url);
  return {
    provider: "shogi-quest",
    datasetName: `将棋クエスト ${sente} vs ${gote}`,
    fileName: `${safeFileName(gameId)}.csa`,
    format: "csa",
    text: buildCsa({ sente, gote, event: "Shogi Quest", source: url.toString(), moves }),
  };
}

async function fetchBoundedHtml(initialUrl, fetchImpl) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "MindAtlasBoardImport/1.0", Accept: "text/html,application/xhtml+xml" },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("The share page redirected too many times.");
      const next = validateShogiSourceUrl(new URL(location, current).toString());
      if (next.hostname !== initialUrl.hostname) throw new Error("The share page redirected to an unsupported host.");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`The share page returned HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SOURCE_BYTES) throw new Error("The share page is too large.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error("The share page is too large.");
    return new TextDecoder("utf-8").decode(bytes);
  }
  throw new Error("The share page could not be loaded.");
}

function buildCsa({ sente, gote, event, source, moves }) {
  return [
    "V2.2",
    `N+${safeLine(sente)}`,
    `N-${safeLine(gote)}`,
    `$EVENT:${safeLine(event)}`,
    `$SOURCE:${safeLine(source)}`,
    "PI",
    "+",
    ...moves,
    "%TORYO",
  ].join("\n");
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function gameIdFromUrl(url) {
  return url.pathname.split("/").filter(Boolean).at(-1) || "imported-game";
}

function safeLine(value) {
  return String(value ?? "").replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, 160);
}

function safeFileName(value) {
  return safeLine(value).replace(/[\\/:*?"<>|#]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "imported-game";
}
