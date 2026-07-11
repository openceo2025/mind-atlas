import type { AppLocale } from "./locales";
import { japaneseMessages, sourceMessages } from "./messages.ts";
import { pseudoLocalize } from "./pseudo";
import { RUNTIME_TRANSLATIONS } from "./runtimeTranslations.ts";

export function messagesForLocale(locale: AppLocale): Record<string, string> {
  if (locale === "ja") return { ...sourceMessages, ...japaneseMessages };
  if (locale === "en-XA") return Object.fromEntries(Object.entries(sourceMessages).map(([id, message]) => [id, pseudoLocalize(message)]));
  if (locale === "ar-XB") return Object.fromEntries(Object.entries(sourceMessages).map(([id, message]) => [id, pseudoLocalize(message, true)]));
  return RUNTIME_TRANSLATIONS[locale] ? { ...sourceMessages, ...RUNTIME_TRANSLATIONS[locale] } : sourceMessages;
}
