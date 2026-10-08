/**
 * The way back to an OpenCEO office that opened this Mind Atlas.
 *
 * OpenCEO opens Mind Atlas with `?from=openceo&return=<office URL>`. On a
 * phone Mind Atlas holds the back button so a stray swipe does not close it,
 * which also left the person with no way back to the office. This keeps that
 * way back as an explicit button instead of weakening the guard.
 *
 * Local developer mode only: the hosted public service never shows it, and
 * only an http(s) address on this machine is accepted as the destination, so
 * the parameter cannot be used to send someone to another site.
 */

const STORAGE_KEY = "mind-atlas.openceo-return";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The office URL if `raw` is one this button may lead to, otherwise null. */
export function acceptedReturnUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK.has(url.hostname)) return null;
  return url.toString();
}

/** The return URL named in a page address, when it came from OpenCEO. */
export function returnUrlFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("from") !== "openceo") return null;
  return acceptedReturnUrl(params.get("return"));
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The office to return to for this tab.
 *
 * Read from the address when present and kept in the tab's session storage,
 * so a reload or an in-app navigation does not lose it. Storage that throws
 * is treated as empty.
 */
export function readOpenCeoReturn(search: string, storage: StorageLike | null): string | null {
  const fromAddress = returnUrlFromSearch(search);
  try {
    if (fromAddress) {
      storage?.setItem(STORAGE_KEY, fromAddress);
      return fromAddress;
    }
    return acceptedReturnUrl(storage?.getItem(STORAGE_KEY));
  } catch {
    return fromAddress;
  }
}

/**
 * Goes back to the office.
 *
 * When OpenCEO opened this tab with window.open, closing it reveals the office
 * tab the person came from. A tab the script may not close (opened by the
 * person, or replaced in place) goes to the office address instead.
 */
export function returnToOffice(
  target: string,
  win: Pick<Window, "close" | "closed" | "opener" | "location" | "setTimeout"> = window,
) {
  if (win.opener) {
    win.close();
    // A browser may refuse to close it after all; then go to the office here.
    win.setTimeout(() => {
      if (!win.closed) win.location.assign(target);
    }, 200);
    return;
  }
  win.location.assign(target);
}
