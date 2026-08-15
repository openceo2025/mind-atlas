const TITLE_MARKER = "@mindatlas-title:v1:";

export function encodeRecordComment(title: string, body: string) {
  const normalizedTitle = String(title ?? "").trim();
  const normalizedBody = stripRecordCommentMetadata(String(body ?? "")).body;
  const metadata = normalizedTitle ? `${TITLE_MARKER}${encodeUtf8Base64Url(normalizedTitle)}` : "";
  return [metadata, normalizedBody].filter(Boolean).join("\n");
}

export function decodeRecordComment(comment: string | null | undefined, fallbackTitle: string) {
  const decoded = stripRecordCommentMetadata(String(comment ?? ""));
  return {
    title: decoded.title || fallbackTitle,
    body: decoded.body,
  };
}

function stripRecordCommentMetadata(comment: string) {
  const normalized = comment.replace(/\r\n?/g, "\n");
  const [firstLine = "", ...rest] = normalized.split("\n");
  if (!firstLine.startsWith(TITLE_MARKER)) {
    return { title: "", body: normalized.trim() };
  }
  const encodedTitle = firstLine.slice(TITLE_MARKER.length).trim();
  let title = "";
  try {
    title = decodeUtf8Base64Url(encodedTitle).trim();
  } catch {
    title = "";
  }
  return { title, body: rest.join("\n").trim() };
}

function encodeUtf8Base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeUtf8Base64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
