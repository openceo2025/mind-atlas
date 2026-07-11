import { createIntl, createIntlCache } from "react-intl";
import { messagesForLocale } from "./catalog";
import { readLocalePreference, resolveLocale, type AppLocale } from "./locales";
import { sourceMessages, type MessageId } from "./messages";

const cache = createIntlCache();
const intlByLocale = new Map<AppLocale, ReturnType<typeof createIntl>>();

export function formatAppMessage(
  id: MessageId,
  values?: Record<string, string | number | boolean | Date>,
  locale = resolveLocale(readLocalePreference()),
) {
  let intl = intlByLocale.get(locale);
  if (!intl) {
    intl = createIntl({ locale, defaultLocale: "en", messages: messagesForLocale(locale) }, cache);
    intlByLocale.set(locale, intl);
  }
  return intl.formatMessage({ id, defaultMessage: sourceMessages[id] }, values);
}
