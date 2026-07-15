(async () => {
  if (!/^https?:$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)) return;
  try {
    for (const key of ["mind-atlas-analytics-consent-v1", "mind-atlas-analytics-actor-v1", "mind-atlas-analytics-attribution-v1"]) localStorage.removeItem(key);
    sessionStorage.removeItem("mind-atlas-analytics-session-v1");
  } catch {}
  try {
    const response = await fetch("/api/analytics/config", { credentials: "include" });
    const config = response.ok ? await response.json() : null;
    if (config?.enabled !== true) return;
  } catch {
    return;
  }

  const locale = document.documentElement.lang || navigator.language || "unknown";
  const randomId = () => crypto.randomUUID().replaceAll("-", "_");
  const actorId = randomId();
  const sessionId = randomId();
  const safe = (value, max = 160) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  const params = new URLSearchParams(location.search);
  let referrerHost = "";
  try { referrerHost = document.referrer ? new URL(document.referrer).host : ""; } catch {}
  const touch = {
    source: safe(params.get("utm_source")),
    medium: safe(params.get("utm_medium")),
    campaign: safe(params.get("utm_campaign")),
    content: safe(params.get("utm_content")),
    term: safe(params.get("utm_term")),
    referrerHost: safe(referrerHost),
  };
  const pageGroup = location.pathname.endsWith("/privacy.html")
    ? "privacy"
    : location.pathname.endsWith("/terms.html")
      ? "terms"
      : "about";

  const send = (name, properties = {}) => {
    const body = JSON.stringify({
      actorId,
      sessionId,
      events: [{
        id: randomId(), name, occurredAt: new Date().toISOString(), locale, pageGroup,
        referrerHost: touch.referrerHost,
        utm: { source: touch.source, medium: touch.medium, campaign: touch.campaign, content: touch.content, term: touch.term },
        firstTouch: touch,
        deviceClass: /ipad|tablet|kindle|silk/i.test(navigator.userAgent) ? "tablet" : /mobile|iphone|ipod|android/i.test(navigator.userAgent) ? "mobile" : "desktop",
        experimentId: safe(params.get("experiment_id"), 80),
        variant: safe(params.get("variant"), 80),
        properties,
      }],
    });
    fetch("/api/analytics/events", { method: "POST", credentials: "include", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => {});
  };

  send("landing_view");
  if (pageGroup === "about") {
    document.addEventListener("click", (event) => {
      const control = event.target.closest?.("[data-view]");
      if (control) send("about_demo_interacted", { demo_kind: "novel", interaction: safe(control.dataset.view, 40) });
    });
  }
})();
