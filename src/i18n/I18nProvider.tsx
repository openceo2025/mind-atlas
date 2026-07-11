import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { IntlProvider, useIntl } from "react-intl";
import { type AppLocale, type LocalePreference, localeDirection, persistLocalePreference, readLocalePreference, resolveLocale } from "./locales";
import { type MessageId, sourceMessages } from "./messages";
import { messagesForLocale } from "./catalog";

type I18nContextValue = {
  locale: AppLocale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function MindAtlasI18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>(() => readLocalePreference());
  const [browserRevision, setBrowserRevision] = useState(0);
  const locale = useMemo(() => resolveLocale(preference), [preference, browserRevision]);
  const messages = useMemo(() => messagesForLocale(locale), [locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    persistLocalePreference(next);
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    const handleLanguageChange = () => setBrowserRevision((value) => value + 1);
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, preference, setPreference }), [locale, preference, setPreference]);
  return (
    <I18nContext.Provider value={value}>
      <IntlProvider locale={locale} defaultLocale="en" messages={messages} onError={handleIntlError}>
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  );
}

export function useMindAtlasLocale() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useMindAtlasLocale must be used within MindAtlasI18nProvider");
  return value;
}

export function useMessage() {
  const intl = useIntl();
  return useCallback(
    (id: MessageId, values?: Record<string, string | number | boolean | Date>) =>
      intl.formatMessage({ id, defaultMessage: sourceMessages[id] }, values),
    [intl],
  );
}

export function I18nText({ id }: { id: MessageId }) {
  const message = useMessage();
  return message(id);
}

function handleIntlError(error: { code?: string }) {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (env?.DEV && error.code !== "MISSING_TRANSLATION") console.error(error);
}
