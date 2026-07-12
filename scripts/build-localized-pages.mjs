import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseFragment, serialize } from "parse5";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(rootDir, "dist");
const i18nConfig = readJson(path.join(rootDir, "i18n", "config.json"));
const locales = i18nConfig.runtimeLocales;

if (!fs.existsSync(outputRoot)) throw new Error("dist/ does not exist. Run this script after the Vite build.");

for (const locale of locales) {
  buildAbout(locale);
  buildLegalPage("privacy", locale);
  buildLegalPage("terms", locale);
}

console.log(`Localized static pages written for: ${locales.join(", ")}`);

function buildAbout(locale) {
  const templatePath = path.join(rootDir, "public", "about.html");
  const sourceCatalog = readJson(path.join(rootDir, "i18n", "pages", "en", "about.json"));
  const japaneseCatalog = readJson(path.join(rootDir, "i18n", "pages", "ja", "about.json"));
  const localePagePath = path.join(rootDir, "i18n", "pages", locale, "about.json");
  const targetCatalog = locale === "en" ? sourceCatalog : fs.existsSync(localePagePath)
    ? readJson(localePagePath)
    : locale === "ja" ? japaneseCatalog : sourceCatalog;
  assertSameKeys("about", sourceCatalog.messages, japaneseCatalog.messages);

  const document = parse(fs.readFileSync(templatePath, "utf8"));
  const textNodes = collectVisibleTextNodes(document);
  const ids = Object.keys(japaneseCatalog.messages);
  if (textNodes.length !== ids.length) {
    throw new Error(`about.html text count changed: template=${textNodes.length} catalog=${ids.length}`);
  }
  ids.forEach((id, index) => {
    const actual = normalizeText(textNodes[index].value);
    const expected = normalizeText(japaneseCatalog.messages[id]);
    if (actual !== expected) throw new Error(`about.html message order changed at ${id}: ${JSON.stringify(actual)}`);
    textNodes[index].value = targetCatalog.messages[id];
  });

  setAttribute(findElement(document, "html"), "lang", locale);
  setAttribute(findElement(document, "html"), "dir", pageDirection(locale));
  setAttribute(findElement(document, "html"), "data-demo-locale", locale);
  forEachElement(document, "a", (link) => {
    if (attribute(link, "href") === "/") setAttribute(link, "href", `/?locale=${encodeURIComponent(locale)}`);
  });
  forEachElement(document, "iframe", (frame) => {
    const source = attribute(frame, "src");
    if (!source?.includes("aboutDemo=")) return;
    const url = new URL(source.replaceAll("&amp;", "&"), "https://mind-atlas.org");
    url.searchParams.set("locale", locale);
    setAttribute(frame, "src", `${url.pathname}${url.search}`);
  });
  const description = findElement(document, "meta", (node) => attribute(node, "name") === "description");
  if (description) setAttribute(description, "content", targetCatalog.metaDescription);
  addAlternateLinks(document, "about.html");
  addLanguageSwitcher(document, locale, "about.html");
  writeOutput(locale, "about.html", `<!doctype html>\n${stripDoctype(serialize(document))}`);
}

function buildLegalPage(page, locale) {
  const englishContent = readJson(path.join(rootDir, "i18n", "pages", "en", `${page}.json`));
  const localePagePath = path.join(rootDir, "i18n", "pages", locale, `${page}.json`);
  const content = fs.existsSync(localePagePath) ? readJson(localePagePath) : englishContent;
  const other = locale === "ja" ? englishContent : readJson(path.join(rootDir, "i18n", "pages", "ja", `${page}.json`));
  if (content.sections.length !== other.sections.length) throw new Error(`${page}: locale section counts differ.`);
  const termsLabel = locale === "ja" ? "利用規約" : "Terms of Service";
  const privacyLabel = locale === "ja" ? "プライバシーポリシー" : "Privacy Policy";
  const aboutLabel = locale === "ja" ? "Mind Atlasについて" : "About Mind Atlas";
  const backLabel = locale === "ja" ? "Mind Atlasへ戻る" : "Back to Mind Atlas";
  const footer = page === "privacy" ? "Mind Atlas / Privacy Policy" : "Mind Atlas / Terms of Service";
  const sections = content.sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.heading)}</h2>
        ${(section.paragraphs ?? []).map((paragraph) => `<p>${linkContact(escapeHtml(paragraph))}</p>`).join("\n")}
        ${section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        ${(section.after ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
      </section>`).join("\n");
  const html = `<!doctype html>
<html lang="${locale}" dir="${pageDirection(locale)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeAttribute(content.metaDescription)}" />
    <meta name="theme-color" content="#061014" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    ${locales.map((alternateLocale) => `<link rel="alternate" hreflang="${alternateLocale}" href="https://mind-atlas.org/${alternateLocale}/${page}.html" />`).join("\n    ")}
    <link rel="alternate" hreflang="x-default" href="https://mind-atlas.org/${page}.html" />
    <title>${escapeHtml(content.title)} | Mind Atlas</title>
    <style>${legalPageCss()}</style>
  </head>
  <body>
    <main class="page">
      <header>
        <nav>
          <a href="/?locale=${locale}">${backLabel}</a>
          <a href="/${locale}/about.html">${aboutLabel}</a>
          ${page === "privacy" ? `<a href="/${locale}/terms.html">${termsLabel}</a>` : `<a href="/${locale}/privacy.html">${privacyLabel}</a>`}
          <span class="language-links" aria-label="Language">${localeLinks(locale, page)}</span>
        </nav>
        <p class="meta">${escapeHtml(content.updated)}</p>
        <h1>${escapeHtml(content.title)}</h1>
        <p class="lead">${escapeHtml(content.lead)}</p>
      </header>
      ${sections}
      <footer>${footer}</footer>
    </main>
  </body>
</html>`;
  writeOutput(locale, `${page}.html`, html);
}

function collectVisibleTextNodes(root) {
  const result = [];
  const visit = (node) => {
    if (node.nodeName === "#text" && !["style", "script"].includes(node.parentNode?.nodeName) && normalizeText(node.value)) result.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return result;
}

function addAlternateLinks(document, page) {
  const head = findElement(document, "head");
  const fragment = parseFragment(`
    ${locales.map((locale) => `<link rel="alternate" hreflang="${locale}" href="https://mind-atlas.org/${locale}/${page}">`).join("\n    ")}
    <link rel="alternate" hreflang="x-default" href="https://mind-atlas.org/${page}">
  `);
  for (const child of fragment.childNodes) appendChild(head, child);
}

function addLanguageSwitcher(document, locale, page) {
  const body = findElement(document, "body");
  const fragment = parseFragment(`<style>
    .localized-page-language{position:fixed;right:10px;bottom:10px;z-index:50;display:flex;gap:4px;padding:4px;border:1px solid rgba(245,251,239,.18);border-radius:7px;background:rgba(7,16,13,.9);backdrop-filter:blur(12px)}
    .localized-page-language a{padding:6px 8px;border-radius:5px;color:#f5fbef;text-decoration:none;font:800 11px/1 system-ui;letter-spacing:0}.localized-page-language a[aria-current=page]{background:#d8f56d;color:#10180c}
  </style><nav class="localized-page-language" aria-label="Language">${localeLinks(locale, page)}</nav>`);
  for (const child of fragment.childNodes) appendChild(body, child);
}

function findElement(root, tagName, predicate = () => true) {
  if (root.tagName === tagName && predicate(root)) return root;
  for (const child of root.childNodes ?? []) {
    const found = findElement(child, tagName, predicate);
    if (found) return found;
  }
  return null;
}

function forEachElement(root, tagName, visit) {
  if (root.tagName === tagName) visit(root);
  for (const child of root.childNodes ?? []) forEachElement(child, tagName, visit);
}

function appendChild(parent, child) {
  child.parentNode = parent;
  parent.childNodes.push(child);
}

function attribute(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value;
}

function setAttribute(node, name, value) {
  if (!node) return;
  const existing = node.attrs.find((item) => item.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}

function assertSameKeys(page, source, target) {
  const sourceKeys = Object.keys(source);
  const targetKeys = Object.keys(target);
  if (JSON.stringify(sourceKeys) !== JSON.stringify(targetKeys)) throw new Error(`${page}: locale message keys or order differ.`);
}

function writeOutput(locale, file, value) {
  const outputDir = path.join(outputRoot, locale);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, file), `${value.trim()}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requiredTranslation(translations, id) {
  const value = translations?.[id]?.trim();
  if (!value) throw new Error(`${id}: enabled locale translation is missing.`);
  return value;
}

function translatedPageContent(page, source, translations) {
  const visit = (value, pathParts) => {
    if (typeof value === "string") return requiredTranslation(translations, ["page", page, ...pathParts].join("."));
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...pathParts, String(index)]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, [...pathParts, key])]));
    return value;
  };
  return visit(source, []);
}

function pageDirection(locale) {
  return i18nConfig.rtlLocales?.includes(locale) ? "rtl" : "ltr";
}

function localeLinks(currentLocale, page) {
  return locales.map((locale) => `<a href="/${locale}/${page}" lang="${locale}"${currentLocale === locale ? " aria-current=\"page\"" : ""}>${escapeHtml(i18nConfig.localeLabels?.[locale] ?? locale)}</a>`).join("");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripDoctype(value) {
  return value.replace(/^<!DOCTYPE html>/i, "");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function linkContact(value) {
  return value.replace("support@mind-atlas.org", '<a href="mailto:support@mind-atlas.org">support@mind-atlas.org</a>');
}

function legalPageCss() {
  return `:root{--bg:#f6f2e5;--ink:#102018;--muted:#52645a;--line:rgba(16,32,24,.14);--green:#0b6f4b;--gold:#9a7412}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.72;letter-spacing:0}a{color:var(--green);font-weight:800}.page{max-width:920px;margin:0 auto;padding:28px 20px 56px}header,section{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.76);box-shadow:0 16px 48px rgba(28,38,32,.08)}header{padding:28px}nav{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}nav a{border:1px solid var(--line);border-radius:7px;padding:8px 11px;background:#fff;color:var(--ink);text-decoration:none}.language-links{display:flex;gap:4px;margin-inline-start:auto}.language-links a[aria-current=page]{background:#102018;color:#fff}h1{margin:0 0 8px;font-size:clamp(30px,6vw,48px);line-height:1.08}h2{margin:0 0 12px;font-size:22px;line-height:1.25}p{margin:0 0 14px}.lead{color:var(--muted);font-size:16px}.meta{color:var(--gold);font-size:13px;font-weight:800}section{margin-top:16px;padding:24px}ul{margin:0;padding-inline-start:22px}li+li{margin-top:8px}footer{padding:24px 4px 0;color:var(--muted);font-size:13px}@media(max-width:600px){.page{padding:14px 12px 36px}header,section{padding:19px}.language-links{width:100%;margin-inline-start:0}}`;
}
