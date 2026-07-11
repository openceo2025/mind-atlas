export const LOCALE_STORAGE_KEY = "mind-atlas-locale-v1";

import { RUNTIME_LOCALES, RUNTIME_LOCALE_ALIASES, RUNTIME_LOCALE_LABELS, RUNTIME_RTL_LOCALES } from "./runtimeConfig.ts";

export const AVAILABLE_LOCALES = RUNTIME_LOCALES;
export const PSEUDO_LOCALES = ["en-XA", "ar-XB"] as const;

export type AvailableLocale = (typeof AVAILABLE_LOCALES)[number];
export type PseudoLocale = (typeof PSEUDO_LOCALES)[number];
export type AppLocale = AvailableLocale | PseudoLocale;
export type LocalePreference = "auto" | AppLocale;

export const LOCALE_LABELS: Record<string, string> = RUNTIME_LOCALE_LABELS;

const LOCALE_ALIASES: Record<string, AvailableLocale> = Object.fromEntries([
  ...AVAILABLE_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
  ...Object.entries(RUNTIME_LOCALE_ALIASES).map(([alias, locale]) => [alias.toLowerCase(), locale as AvailableLocale]),
]);

export function normalizeLocale(value: string | null | undefined): AppLocale | null {
  const normalized = value?.trim().replaceAll("_", "-");
  if (!normalized) return null;
  if (PSEUDO_LOCALES.includes(normalized as PseudoLocale)) return normalized as PseudoLocale;
  const lower = normalized.toLowerCase();
  if (LOCALE_ALIASES[lower]) return LOCALE_ALIASES[lower];
  const base = lower.split("-")[0];
  return LOCALE_ALIASES[base] ?? null;
}

export function resolveLocale(
  preference: LocalePreference,
  browserLanguages: readonly string[] = browserLocaleCandidates(),
): AppLocale {
  if (preference !== "auto") return normalizeLocale(preference) ?? "en";
  for (const candidate of browserLanguages) {
    const locale = normalizeLocale(candidate);
    if (locale && !PSEUDO_LOCALES.includes(locale as PseudoLocale)) return locale;
  }
  return "en";
}

export function readLocalePreference(): LocalePreference {
  if (typeof window === "undefined") return "auto";
  const queryLocale = normalizeLocale(new URLSearchParams(window.location.search).get("locale"));
  if (queryLocale) return queryLocale;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "auto") return "auto";
    return normalizeLocale(stored) ?? "auto";
  } catch {
    return "auto";
  }
}

export function persistLocalePreference(preference: LocalePreference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    // The selected locale still applies for the current page session.
  }
}

export function localeDirection(locale: AppLocale): "ltr" | "rtl" {
  return locale === "ar-XB" || RUNTIME_RTL_LOCALES.includes(locale as never) ? "rtl" : "ltr";
}

export function browserLocaleCandidates(): string[] {
  if (typeof navigator === "undefined") return ["en"];
  return navigator.languages?.length ? [...navigator.languages] : [navigator.language || "en"];
}

export function currentAppLocale() {
  return resolveLocale(readLocalePreference());
}

export function localePathSegment(locale: AvailableLocale) {
  return locale;
}
