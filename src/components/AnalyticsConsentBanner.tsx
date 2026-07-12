import { useEffect, useState } from "react";
import { fetchAnalyticsAvailability, getAnalyticsConsent, setAnalyticsConsent, startAnalyticsLifecycle } from "../analytics/productAnalytics";
import { useMessage, useMindAtlasLocale } from "../i18n/I18nProvider";

export function AnalyticsConsentBanner() {
  const t = useMessage();
  const { locale } = useMindAtlasLocale();
  const [consent, setConsent] = useState(getAnalyticsConsent);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAnalyticsAvailability().then((enabled) => {
      if (active) setAvailable(enabled);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (consent !== "accepted") return;
    return startAnalyticsLifecycle();
  }, [consent]);

  if (!available || consent !== "unset") return null;
  const privacyHref = `/${locale}/privacy.html`;
  return (
    <aside className="analytics-consent" aria-label={t("analytics.consent.label")}>
      <p>{t("analytics.consent.message")}</p>
      <a href={privacyHref} target="_blank" rel="noreferrer">{t("analytics.consent.privacy")}</a>
      <div className="analytics-consent-actions">
        <button type="button" onClick={() => { setAnalyticsConsent("declined"); setConsent("declined"); }}>
          {t("analytics.consent.decline")}
        </button>
        <button className="is-primary" type="button" onClick={() => { setAnalyticsConsent("accepted"); setConsent("accepted"); }}>
          {t("analytics.consent.accept")}
        </button>
      </div>
    </aside>
  );
}
