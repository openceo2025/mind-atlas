import { useSyncExternalStore } from 'react';
import en from './locales/en.json';

// 既存 Mind Atlas と同じ 12 言語。英語が原文で、欠けたキーは英語にフォールバックする。
export const LOCALES = ['en', 'ja', 'es', 'pt-BR', 'fr', 'de', 'ko', 'zh-Hans', 'zh-Hant', 'id', 'hi', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
  ko: '한국어',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  id: 'Bahasa Indonesia',
  hi: 'हिन्दी',
  ar: 'العربية',
};

const ALIASES: Record<string, Locale> = {
  pt: 'pt-BR',
  'pt-pt': 'pt-BR',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
};

export type MessageKey = keyof typeof en;
type Messages = Record<string, string>;

const STORAGE_KEY = 'mindatlas-spatial-locale';
const loaders = import.meta.glob<{ default: Messages }>(['./locales/*.json', '!./locales/en.json']);

let current: Locale = 'en';
let messages: Messages = en;
const listeners = new Set<() => void>();

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const v = value?.trim().replaceAll('_', '-').toLowerCase();
  if (!v) return null;
  const exact = LOCALES.find((l) => l.toLowerCase() === v);
  if (exact) return exact;
  if (ALIASES[v]) return ALIASES[v];
  const base = v.split('-')[0];
  return LOCALES.find((l) => l.toLowerCase() === base) ?? ALIASES[base] ?? null;
}

function detectLocale(): Locale {
  try {
    const q = normalizeLocale(new URLSearchParams(window.location.search).get('locale'));
    if (q) return q;
    const stored = normalizeLocale(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // ストレージが使えなくてもブラウザの言語で続行する
  }
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const l = normalizeLocale(candidate);
    if (l) return l;
  }
  return 'en';
}

async function load(locale: Locale): Promise<Messages> {
  if (locale === 'en') return en;
  const loader = loaders[`./locales/${locale}.json`];
  if (!loader) return en;
  try {
    return (await loader()).default;
  } catch {
    return en;
  }
}

function applyDocument(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

export async function initI18n() {
  const locale = detectLocale();
  messages = await load(locale);
  current = locale;
  applyDocument(locale);
}

export async function setLocale(locale: Locale) {
  messages = await load(locale);
  current = locale;
  applyDocument(locale);
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // この画面の間だけ有効
  }
  listeners.forEach((l) => l());
}

export function getLocale() {
  return current;
}

/** {name} 形式の差し込みに対応したメッセージ取得 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = messages[key] ?? (en as Messages)[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** ロケール変更で再描画させるためのフック。戻り値の t を使う */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, t };
}

export function formatDateTime(ts: number) {
  try {
    return new Intl.DateTimeFormat(current, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function formatTime(ts: number) {
  try {
    return new Intl.DateTimeFormat(current, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}
