# Hosted model audit: 2026-10-18

Scope: the public VPS application at https://mind-atlas.org. This audit changes
hosted billing and catalogue policy only; local bridge catalogues are independent.

## Live baseline

`GET /api/chat/options` offered 45 models: OpenAI 29, Anthropic 14, DeepSeek 2.
None was labelled estimated. Other providers had no configured key. A model list
is account-specific and is not proof that every model in a provider's marketing
catalogue is available to this account.

Two minimal live DeepSeek calls returned HTTP 200 with `deepseek-flash` and
`deepseek-v4-pro` respectively. The API keeps those alias names in its response.
The current documented Flash version is DeepSeek V4.1 Flash 1017 (2026-10-17).

The old September 10 news article proposed retiring V4 Pro. The revised change
log and pricing documentation say that proposal was reversed in response to user
demand. Pro remains available at Pro rates; it must not be silently relabelled or
charged as Flash.

## Standard uncached rates

USD per million tokens; short-context Standard API requests, excluding cache,
regional processing, explicit premium tiers, web tools and other non-token fees.
Snapshot IDs in the live list retain their documented family rate.

| Provider | Models | Input | Output |
| --- | --- | ---: | ---: |
| OpenAI | gpt-6-astra | 10 | 50 |
| OpenAI | gpt-6.1-sol, gpt-6-sol | 2 | 10 |
| OpenAI | gpt-6-luna | 0.10 | 0.50 |
| OpenAI | gpt-5.6-sol | 4 | 20 |
| OpenAI | gpt-5.6-terra | 2 | 12 |
| OpenAI | gpt-5.6-luna | 0.20 | 1.20 |
| OpenAI | gpt-5.5 | 5 | 30 |
| OpenAI | gpt-5.4 | 2.50 | 15 |
| OpenAI | gpt-5.4-mini | 0.75 | 4.50 |
| OpenAI | gpt-5.4-nano | 0.20 | 1.25 |
| OpenAI | gpt-5.2 | 1.75 | 14 |
| OpenAI | gpt-5.1, gpt-5 | 1.25 | 10 |
| OpenAI | gpt-5-mini | 0.25 | 2 |
| OpenAI | gpt-5-nano | 0.05 | 0.40 |
| OpenAI | o4-mini, o3-mini | 1.10 | 4.40 |
| OpenAI | o3 | 2 | 8 |
| OpenAI | o1 | 15 | 60 |
| OpenAI | gpt-4.1 | 2 | 8 |
| OpenAI | gpt-4.1-mini | 0.40 | 1.60 |
| OpenAI | gpt-4.1-nano | 0.10 | 0.40 |
| OpenAI | gpt-4o | 2.50 | 10 |
| OpenAI | gpt-4o-mini | 0.15 | 0.60 |
| OpenAI | gpt-4-turbo | 10 | 30 |
| OpenAI | gpt-4 | 30 | 60 |
| OpenAI | gpt-3.5-turbo | 0.50 | 1.50 |
| Anthropic | claude-fable-5-1, claude-fable-5 | 10 | 50 |
| Anthropic | claude-opus-5-5 | 4 | 20 |
| Anthropic | claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-opus-4-5-20251101 | 5 | 25 |
| Anthropic | claude-sonnet-5-5, claude-sonnet-5 | 2 | 10 |
| Anthropic | claude-sonnet-4-6, claude-sonnet-4-5-20250929 | 3 | 15 |
| Anthropic | claude-haiku-5-5 | 0.10 | 0.50 |
| Anthropic | claude-haiku-4-5-20251001 | 1 | 5 |
| DeepSeek (peak) | deepseek-flash | 0.30 | 1.20 |
| DeepSeek (off-peak) | deepseek-flash | 0.15 | 0.60 |
| DeepSeek (peak) | deepseek-v4-pro | 1.32 | 3.96 |
| DeepSeek (off-peak) | deepseek-v4-pro | 0.66 | 1.98 |

## Corrections

- Remove `gpt-3.5-turbo-16k`: retired on 2024-09-13 even though it can still
  appear in model discovery. A transient probe failure is no longer sufficient
  to keep an officially retired model available.
- Supplement provider `shutdown_date` metadata with official alias shutdown
  dates. Hide expired models in live, configured, cached and fallback lists,
  and reject their execution. Upcoming dates remain available until the date.
- Keep `deepseek-v4-pro`. Remove retired Flash/Chat/Reasoner IDs from selectable
  fallback lists. The old Flash IDs are forwarding aliases, not extra models.
- Explicitly register Claude Sonnet 5.5. Previously a prefix match happened to
  assign Sonnet 5's identical base rate. A future `5-9` version must be estimated
  until independently priced, not labelled exact by that prefix.
- OpenAI models with a 272K tier use double input and 1.5x output rates for the
  entire request above 272,000 input tokens. Haiku 5.5 retains its 100K boundary.
- Reservations keep the undiscounted ceiling. Settlement now uses reported
  cached inputs and Anthropic cache-write durations, counting all Anthropic
  input categories toward the context threshold. Explicit flat JSON overrides
  continue to control their own rates without implicit discounts.
- DeepSeek settlement and public pricing now apply off-peak rates at request
  start. Peak is UTC Monday-Friday 01:00-04:00 and 06:00-10:00, excluding Chinese
  public holidays. All weekends are off-peak, including make-up work weekends.
  The verified holiday calendar covers 2026 and must be extended when the next
  official annual schedule is published; unknown-year weekday holidays cannot
  yet be discounted. The public response exposes that calendar limit.
- DeepSeek Flash receives the thinking-model output budget, and the supported
  `none/low/high/max` controls are transmitted with DeepSeek's documented fields.

## Upcoming shutdowns affecting this baseline

| Date (UTC) | Offered models affected |
| --- | --- |
| 2026-10-23 | gpt-3.5-turbo, gpt-4, gpt-4-turbo, gpt-4.1-nano, o1, o3-mini, o4-mini |
| 2026-11-30 | claude-sonnet-4-5-20250929 |
| 2026-12-11 | gpt-5, gpt-5-mini, gpt-5-nano, o3 |
| 2027-01-14 | gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini |
| 2027-04-01 | gpt-5.1, gpt-5.4-nano |

These are API shutdowns, not ChatGPT product retirement dates. The server's
public model rows expose lifecycle status and date; selections are rechecked
at execution time. The account's live provider list still determines availability.

## Sources

- https://developers.openai.com/api/docs/pricing (including its Markdown full model table)
- https://developers.openai.com/api/docs/deprecations
- https://developers.openai.com/api/docs/models/gpt-6-sol
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/about-claude/model-deprecations
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/updates/ (revised V4 Pro continuation notice)
- https://api-docs.deepseek.com/news/news261017/
- https://api-docs.deepseek.com/guides/thinking_mode/
- https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html

Validation and exact deployed commit are recorded in the release handoff.
