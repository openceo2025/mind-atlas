(async () => {
  if (!/^https?:$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)) return;
  try {
    const response = await fetch("/api/analytics/config", { credentials: "include" });
    const config = response.ok ? await response.json() : null;
    if (config?.enabled !== true) return;
  } catch {
    return;
  }
  const consentKey = "mind-atlas-analytics-consent-v1";
  const actorKey = "mind-atlas-analytics-actor-v1";
  const attributionKey = "mind-atlas-analytics-attribution-v1";
  const sessionKey = "mind-atlas-analytics-session-v1";
  const locale = document.documentElement.lang || navigator.language || "unknown";
  const language = locale.toLowerCase();
  const copies = {
    ja: ["アクセス解析の設定", "匿名の利用状況を計測し、Mind Atlasの改善に役立てます。ノート本文、AIプロンプト、メールアドレス、IPアドレスは分析には保存しません。", "プライバシーポリシー", "許可しない", "計測を許可"],
    es: ["Preferencia de análisis", "Ayuda a mejorar Mind Atlas con análisis anónimos que protegen la privacidad. No se guardan textos, prompts de IA, correos ni direcciones IP.", "Política de privacidad", "No, gracias", "Permitir análisis"],
    fr: ["Préférence d’analyse", "Aidez à améliorer Mind Atlas grâce à des statistiques anonymes respectueuses de la vie privée. Les textes, prompts IA, e-mails et adresses IP ne sont pas stockés.", "Politique de confidentialité", "Non merci", "Autoriser l’analyse"],
    de: ["Analyse-Einstellung", "Hilf, Mind Atlas mit anonymen, datenschutzfreundlichen Analysen zu verbessern. Notiztexte, KI-Prompts, E-Mails und IP-Adressen werden nicht gespeichert.", "Datenschutzerklärung", "Nein danke", "Analyse erlauben"],
    ko: ["분석 설정", "개인정보를 보호하는 익명 사용 분석으로 Mind Atlas 개선에 도움을 주세요. 노트 본문, AI 프롬프트, 이메일 및 IP 주소는 저장하지 않습니다.", "개인정보 처리방침", "허용 안 함", "분석 허용"],
    "zh-hans": ["分析设置", "通过保护隐私的匿名使用分析帮助改进 Mind Atlas。笔记正文、AI 提示词、电子邮件和 IP 地址不会被保存。", "隐私政策", "暂不允许", "允许分析"],
    "zh-hant": ["分析設定", "透過保護隱私的匿名使用分析協助改善 Mind Atlas。筆記本文、AI 提示詞、電子郵件和 IP 位址不會被儲存。", "隱私權政策", "暫不允許", "允許分析"],
    id: ["Preferensi analitik", "Bantu tingkatkan Mind Atlas dengan analitik anonim yang menjaga privasi. Teks notebook, prompt AI, email, dan alamat IP tidak disimpan.", "Kebijakan privasi", "Tidak, terima kasih", "Izinkan analitik"],
    hi: ["विश्लेषण प्राथमिकता", "गोपनीयता-सुरक्षित अनाम विश्लेषण से Mind Atlas को बेहतर बनाने में मदद करें। नोटबुक पाठ, AI प्रॉम्प्ट, ईमेल और IP पते संग्रहीत नहीं होते।", "गोपनीयता नीति", "नहीं, धन्यवाद", "विश्लेषण की अनुमति दें"],
    ar: ["تفضيل التحليلات", "ساعد في تحسين Mind Atlas عبر تحليلات مجهولة تراعي الخصوصية. لا تُخزَّن النصوص أو مطالبات الذكاء الاصطناعي أو البريد الإلكتروني أو عناوين IP.", "سياسة الخصوصية", "لا شكرًا", "السماح بالتحليلات"],
    "pt-br": ["Preferência de análise", "Ajude a melhorar o Mind Atlas com análises anônimas que protegem a privacidade. Textos, prompts de IA, e-mails e endereços IP não são armazenados.", "Política de privacidade", "Agora não", "Permitir análise"],
    en: ["Analytics preference", "Help improve Mind Atlas with privacy-preserving anonymous usage analytics. Notebook text, AI prompts, email addresses, and IP addresses are not stored.", "Privacy policy", "No thanks", "Allow analytics"],
  };
  const copy = copies[language] || copies[language.split("-")[0]] || copies.en;

  const randomId = () => crypto.randomUUID().replaceAll("-", "_");
  const safe = (value, max = 160) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  const actorId = () => {
    let value = localStorage.getItem(actorKey) || "";
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(value)) {
      value = randomId();
      localStorage.setItem(actorKey, value);
    }
    return value;
  };
  const sessionId = () => {
    const now = Date.now();
    try {
      const current = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
      if (current?.id && current.lastSeenAt > now - 30 * 60 * 1000) {
        sessionStorage.setItem(sessionKey, JSON.stringify({ id: current.id, lastSeenAt: now }));
        return current.id;
      }
    } catch {}
    const id = randomId();
    sessionStorage.setItem(sessionKey, JSON.stringify({ id, lastSeenAt: now }));
    return id;
  };
  const attribution = () => {
    const params = new URLSearchParams(location.search);
    let referrerHost = "";
    try { referrerHost = document.referrer ? new URL(document.referrer).host : ""; } catch {}
    const current = {
      source: safe(params.get("utm_source")),
      medium: safe(params.get("utm_medium")),
      campaign: safe(params.get("utm_campaign")),
      content: safe(params.get("utm_content")),
      term: safe(params.get("utm_term")),
      referrerHost: safe(referrerHost),
    };
    let state = null;
    try { state = JSON.parse(localStorage.getItem(attributionKey) || "null"); } catch {}
    const first = state?.first || current;
    const last = Object.fromEntries(Object.keys(current).map((key) => [key, current[key] || state?.last?.[key] || first[key] || ""]));
    const next = { first, last };
    localStorage.setItem(attributionKey, JSON.stringify(next));
    return next;
  };
  const send = (name, properties = {}) => {
    if (localStorage.getItem(consentKey) !== "accepted") return;
    const touch = attribution();
    const body = JSON.stringify({
      actorId: actorId(),
      sessionId: sessionId(),
      events: [{
        id: randomId(),
        name,
        occurredAt: new Date().toISOString(),
        locale,
        pageGroup: "about",
        referrerHost: touch.last.referrerHost,
        utm: { source: touch.last.source, medium: touch.last.medium, campaign: touch.last.campaign, content: touch.last.content, term: touch.last.term },
        firstTouch: touch.first,
        deviceClass: /mobile|iphone|ipod|android/i.test(navigator.userAgent) ? "mobile" : "desktop",
        experimentId: safe(new URLSearchParams(location.search).get("experiment_id"), 80),
        variant: safe(new URLSearchParams(location.search).get("variant"), 80),
        properties,
      }],
    });
    fetch("/api/analytics/events", { method: "POST", credentials: "include", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => {});
  };

  const start = () => {
    send("landing_view");
    document.addEventListener("click", (event) => {
      const control = event.target.closest("[data-view]");
      if (control) send("about_demo_interacted", { demo_kind: "novel", interaction: safe(control.dataset.view, 40) });
    });
  };

  const consent = localStorage.getItem(consentKey);
  if (consent === "accepted") {
    start();
    return;
  }
  if (consent === "declined") return;

  const banner = document.createElement("aside");
  banner.setAttribute("aria-label", copy[0]);
  banner.style.cssText = "position:fixed;z-index:1000;left:12px;right:12px;bottom:12px;max-width:900px;margin:auto;padding:12px 14px;border:1px solid rgba(245,251,239,.25);border-radius:6px;background:rgba(4,13,10,.97);color:#edf4e9;font:13px/1.5 system-ui;box-shadow:0 12px 36px rgba(0,0,0,.42)";
  banner.innerHTML = `<p style="margin:0 0 9px">${copy[1]}</p><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><a href="/${encodeURIComponent(locale)}/privacy.html" style="color:#cde878;font-weight:700">${copy[2]}</a><span style="flex:1"></span><button data-consent="declined">${copy[3]}</button><button data-consent="accepted" style="background:#b7d957;color:#11170d">${copy[4]}</button></div>`;
  banner.addEventListener("click", (event) => {
    const value = event.target?.dataset?.consent;
    if (value !== "accepted" && value !== "declined") return;
    localStorage.setItem(consentKey, value);
    if (value === "declined") {
      localStorage.removeItem(actorKey);
      localStorage.removeItem(attributionKey);
      sessionStorage.removeItem(sessionKey);
    }
    banner.remove();
    if (value === "accepted") start();
  });
  document.body.appendChild(banner);
})();
