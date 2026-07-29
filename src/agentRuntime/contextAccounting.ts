// Preflight context accounting.
//
// The old universal "characters / 3.8" divisor is badly wrong for Japanese and
// for code. This module is script aware and always labels its output as an
// estimate. It is used only for the pre-send Atlas injection figure; actual
// provider session usage always comes from provider events.
//
// Calibration reference points used for the weights below:
// - Latin prose tokenizes at roughly 4 characters per token;
// - code and identifier-heavy text is denser, roughly 3 characters per token;
// - Japanese kana is close to 1 token per character;
// - CJK ideographs are frequently 1 token each, sometimes 2 for rare glyphs;
// - Hangul syllables are close to 1 token per character.

export type TokenEstimatorId = "script-aware-v1" | "provider-reported";

export interface TokenEstimate {
  tokens: number;
  characters: number;
  bytes: number;
  estimator: TokenEstimatorId;
  /** Always true for this module: it is never presented as provider truth. */
  isEstimate: true;
  breakdown: {
    latin: number;
    cjk: number;
    kana: number;
    hangul: number;
    digits: number;
    whitespace: number;
    other: number;
  };
}

const WEIGHTS = {
  // Tokens contributed per character of each class.
  latin: 1 / 4,
  code: 1 / 3,
  cjk: 1,
  kana: 0.9,
  hangul: 0.9,
  digits: 1 / 2.5,
  whitespace: 1 / 6,
  other: 1 / 2,
};

const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const KANA = /[぀-ゟ゠-ヿㇰ-ㇿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const LATIN = /[A-Za-zÀ-ɏ]/;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/** Rough code density signal: braces, semicolons and path separators. */
function looksLikeCode(text: string) {
  const sample = text.slice(0, 4000);
  const symbols = (sample.match(/[{};<>()[\]=|/\\]/g) ?? []).length;
  return sample.length > 0 && symbols / sample.length > 0.04;
}

export function estimateTokens(text: string): TokenEstimate {
  const source = String(text ?? "");
  const breakdown = { latin: 0, cjk: 0, kana: 0, hangul: 0, digits: 0, whitespace: 0, other: 0 };
  for (const char of source) {
    if (WHITESPACE.test(char)) breakdown.whitespace += 1;
    else if (CJK.test(char)) breakdown.cjk += 1;
    else if (KANA.test(char)) breakdown.kana += 1;
    else if (HANGUL.test(char)) breakdown.hangul += 1;
    else if (DIGIT.test(char)) breakdown.digits += 1;
    else if (LATIN.test(char)) breakdown.latin += 1;
    else breakdown.other += 1;
  }
  const latinWeight = looksLikeCode(source) ? WEIGHTS.code : WEIGHTS.latin;
  const tokens =
    breakdown.latin * latinWeight +
    breakdown.cjk * WEIGHTS.cjk +
    breakdown.kana * WEIGHTS.kana +
    breakdown.hangul * WEIGHTS.hangul +
    breakdown.digits * WEIGHTS.digits +
    breakdown.whitespace * WEIGHTS.whitespace +
    breakdown.other * WEIGHTS.other;
  return {
    tokens: Math.max(source.trim() ? 1 : 0, Math.ceil(tokens)),
    characters: source.length,
    bytes: typeof TextEncoder === "undefined" ? source.length : new TextEncoder().encode(source).length,
    estimator: "script-aware-v1",
    isEstimate: true,
    breakdown,
  };
}

export interface AtlasInjectionAccounting {
  estimatedTokens: number;
  characters: number;
  bytes: number;
  replayedTurns: number;
  pinnedNodes: number;
  evidenceCount: number;
  estimator: TokenEstimatorId;
  preview: string;
}

/**
 * What Mind Atlas plans to add to the next request. Deliberately separate from
 * the provider session figure so the two can never be confused.
 */
export function accountAtlasInjection(input: {
  contextText?: string;
  conversation?: Array<{ role: string; content: string }>;
  prompt?: string;
  pinnedNodes?: number;
  evidenceCount?: number;
}): AtlasInjectionAccounting {
  const conversation = input.conversation ?? [];
  const parts = [
    input.contextText ?? "",
    ...conversation.map((turn) => `${turn.role}: ${turn.content}`),
    input.prompt ?? "",
  ].filter(Boolean);
  const combined = parts.join("\n\n");
  const estimate = estimateTokens(combined);
  return {
    estimatedTokens: estimate.tokens,
    characters: estimate.characters,
    bytes: estimate.bytes,
    replayedTurns: conversation.length,
    pinnedNodes: input.pinnedNodes ?? 0,
    evidenceCount: input.evidenceCount ?? 0,
    estimator: estimate.estimator,
    preview: combined,
  };
}

/**
 * Remaining provider context. Returns null unless both the used tokens and the
 * window are known, so the UI never shows a fabricated remaining figure.
 */
export function remainingContext(usedTokens: number | null, contextWindow: number | null) {
  if (usedTokens === null || contextWindow === null) return null;
  if (!Number.isFinite(usedTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  return { remaining: Math.max(0, contextWindow - usedTokens), ratio: Math.min(1, usedTokens / contextWindow) };
}
