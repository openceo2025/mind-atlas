/**
 * Turns one spoken or typed line into a ledger draft, without an AI call:
 * "VPS代1,200円 毎月 Mind Atlas", "広告 4万円", "$20 Claude monthly",
 * "売上 3000円 onkan". The user always confirms the draft before it is saved.
 *
 * Mode: shared-core. Pure, so scripts/verify-galaxy.ts exercises it.
 */
import type { Currency, GalaxyState, LedgerKind, LedgerRecurrence } from "./galaxyTypes.ts";
import { todayIso } from "./galaxyRollup.ts";

export interface LedgerDraft {
  kind: LedgerKind;
  amount: number;
  currency: Currency;
  date: string;
  memo: string;
  recurrence?: LedgerRecurrence;
  spaceId?: string;
  resourceId?: string;
}

const INCOME_WORDS = /(売上|収入|入金|売れ|支援|投げ銭|income|revenue|sale|sold|earned|paid me|donation)/i;
const MONTHLY_WORDS = /(毎月|月額|月々|\/月|per month|monthly|a month|every month)/i;
const YEARLY_WORDS = /(毎年|年額|年間|\/年|per year|yearly|annual|every year)/i;

export function parseLedgerLine(text: string, galaxy: Pick<GalaxyState, "spaces" | "resources" | "displayCurrency">, today = todayIso()): LedgerDraft | null {
  const source = text.normalize("NFKC").trim();
  if (!source) return null;
  const money = findAmount(source, galaxy.displayCurrency);
  if (!money) return null;
  const date = findDate(source, today) ?? today;
  const recurrence: LedgerRecurrence | undefined = MONTHLY_WORDS.test(source)
    ? { every: "month" }
    : YEARLY_WORDS.test(source)
      ? { every: "year" }
      : undefined;
  const lower = source.toLowerCase();
  const space = [...galaxy.spaces]
    .filter((item) => item.title.trim() && lower.includes(item.title.trim().toLowerCase()))
    .sort((a, b) => b.title.length - a.title.length)[0];
  const resource = [...galaxy.resources]
    .filter((item) => item.kind === "account" && item.name.trim() && lower.includes(item.name.trim().toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  let memo = source.replace(money.raw, " ").replace(MONTHLY_WORDS, " ").replace(YEARLY_WORDS, " ");
  // The space and account are already captured as fields; keep them out of the memo.
  for (const name of [space?.title, resource?.name]) {
    if (name?.trim()) memo = memo.replace(new RegExp(escapeRegExp(name.trim()), "i"), " ");
  }
  memo = memo.replace(/\s+/g, " ").trim();
  return {
    kind: INCOME_WORDS.test(source) ? "income" : "expense",
    amount: money.amount,
    currency: money.currency,
    date,
    memo: memo || source,
    recurrence,
    spaceId: space?.id,
    resourceId: resource?.id,
  };
}

function findAmount(text: string, fallback: Currency): { amount: number; currency: Currency; raw: string } | null {
  const patterns: { re: RegExp; currency?: Currency }[] = [
    { re: /(?:\$|US\$|USD\s?)\s?(\d[\d,]*(?:\.\d+)?)\s*(k|千|万)?/i, currency: "USD" },
    { re: /(\d[\d,]*(?:\.\d+)?)\s*(k|千|万)?\s*(?:ドル|dollars?|usd)/i, currency: "USD" },
    { re: /(?:¥|￥|JPY\s?)\s?(\d[\d,]*(?:\.\d+)?)\s*(k|千|万)?/i, currency: "JPY" },
    { re: /(\d[\d,]*(?:\.\d+)?)\s*(k|千|万)?\s*(?:円|yen|jpy)/i, currency: "JPY" },
    { re: /(\d[\d,]*(?:\.\d+)?)\s*(k|千|万)?/i },
  ];
  for (const { re, currency } of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const base = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(base) || base <= 0) continue;
    const unit = (match[2] ?? "").toLowerCase();
    const multiplier = unit === "万" ? 10_000 : unit === "千" || unit === "k" ? 1_000 : 1;
    return { amount: base * multiplier, currency: currency ?? fallback, raw: match[0] };
  }
  return null;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findDate(text: string, today: string) {
  const iso = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const md = text.match(/(?:^|\s)(\d{1,2})[/月](\d{1,2})日?(?=\s|$)/);
  if (md) return `${today.slice(0, 4)}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  return null;
}
