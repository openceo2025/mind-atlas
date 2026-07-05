# Mind Atlas Local VPS Staging

This document describes the local ConoHa-like staging environment. It runs the
same hosted service shape behind nginx with PostgreSQL:

```text
browser -> nginx :8088 -> Node hosted service :8788 -> PostgreSQL
```

The first staging profile uses explicit mock modes for Google OAuth, Stripe,
and provider APIs. These modes are only enabled by
`deploy/staging/env.service.docker.example` and are meant to test the service
flow before real keys are available.

## Start With Docker Compose

Install Docker Desktop first if `docker --version` is not available.

From the repository root:

```powershell
docker compose -f docker-compose.staging.yml up --build -d
```

Open:

```text
http://127.0.0.1:8088/
```

Check health:

```powershell
curl http://127.0.0.1:8088/health
```

Run the staging verification:

```powershell
npm run staging:verify
```

This verification performs:

- anonymous `/api/service/session`;
- anonymous AI rejection;
- mock Google login through the normal login route;
- mock Stripe checkout through the normal billing route;
- active subscription and 100 percent token grant;
- one Chat request for each provider:
  OpenAI, Anthropic, GLM, DeepSeek, Gemini, Qwen, Composer, Kimi, Mimo,
  MiniMax, and Grok;
- web search mock;
- Dictation mock;
- Realtime reservation mock;
- token percentage decreasing after metered AI calls.

## Admin Commands In Staging

Run admin commands inside the app container:

```powershell
docker compose -f docker-compose.staging.yml exec app node server/admin.mjs doctor
docker compose -f docker-compose.staging.yml exec app node server/admin.mjs users
docker compose -f docker-compose.staging.yml exec app node server/admin.mjs usage staging-user@example.test
```

Set the staging user to 0 percent token and verify HTTP 402 behavior:

```powershell
docker compose -f docker-compose.staging.yml exec app node server/admin.mjs set-credit staging-user@example.test 0
npm run staging:verify
```

The second command should fail after login/billing because AI access is
exhausted. Restore credit:

```powershell
docker compose -f docker-compose.staging.yml exec app node server/admin.mjs set-credit staging-user@example.test 100
```

## Prepare Real Google OAuth

After the all-mock staging flow passes, the next narrow step is real Google
login while Stripe and provider APIs stay mocked.

These files are prepared for that step:

- `deploy/staging/env.service.local`
- `docker-compose.staging.local.yml`

They are local-only files and must not be committed with real secrets. The
matching templates are:

- `deploy/staging/env.service.local.example`
- `docker-compose.staging.local.example.yml`

Create a Google OAuth web client with:

```text
Authorized JavaScript origin:
http://127.0.0.1:8088

Authorized redirect URI:
http://127.0.0.1:8088/api/auth/google/callback
```

Then set these values in `deploy/staging/env.service.local`:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Before starting the real-Google local profile, run:

```powershell
npm run staging:google:doctor
```

The doctor should fail until the Google client ID and secret are filled. Once it
passes, start the real-Google profile:

```powershell
npm run staging:local:up
```

Open:

```text
http://127.0.0.1:8088/
```

Then click `AI function` and complete Google login. In this profile:

- `MIND_ATLAS_STAGING_MOCK_AUTH=0`
- `MIND_ATLAS_STAGING_MOCK_BILLING=1`
- `MIND_ATLAS_STAGING_MOCK_PROVIDERS=1`

This proves Google account creation and the session cookie before Stripe and
real provider keys are introduced.

## Stop And Reset

Stop containers:

```powershell
docker compose -f docker-compose.staging.yml down
```

Delete the staging database volume:

```powershell
docker compose -f docker-compose.staging.yml down -v
```

## Switching From Mock To More Real Test Keys

After Google login passes, continue using the local secret file. Do not commit
the real file.

Recommended process:

1. Keep `MIND_ATLAS_STAGING_MOCK_AUTH=0` and verified Google OAuth values.
2. Set `MIND_ATLAS_STAGING_MOCK_BILLING=0` and fill Stripe test values.
3. Verify Stripe test checkout and webhook.
4. Set `MIND_ATLAS_STAGING_MOCK_PROVIDERS=0` for the provider group being
   tested.
5. Add real provider API keys and realistic
   `MIND_ATLAS_MODEL_PRICES_JSON` entries.
6. Run `npm run staging:verify` after each provider group. It will only pass for
   provider calls that still use mocks; for real provider verification, use the
   browser, `npm run staging:providers:doctor`, and
   `service:admin -- usage`.

For Stripe test checkout, keep provider APIs mocked and set:

```text
MIND_ATLAS_STAGING_MOCK_AUTH=0
MIND_ATLAS_STAGING_MOCK_BILLING=0
MIND_ATLAS_STAGING_MOCK_PROVIDERS=1
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Check the local file without printing secrets:

```powershell
npm run staging:stripe:doctor
```

Keep Stripe CLI forwarding open in a separate PowerShell while testing checkout:

```powershell
stripe listen --forward-to http://127.0.0.1:8088/api/billing/stripe/webhook
```

Then restart staging:

```powershell
npm run staging:local:up
```

## Prepare Real OpenAI Baseline

After real Google OAuth and Stripe test checkout pass, the next step is OpenAI
only. Keep the other providers as `mock` or blank until they are intentionally
tested.

Set:

```text
MIND_ATLAS_STAGING_MOCK_AUTH=0
MIND_ATLAS_STAGING_MOCK_BILLING=0
MIND_ATLAS_STAGING_MOCK_PROVIDERS=0
MIND_ATLAS_OPENAI_API_KEY=sk-...
MIND_ATLAS_OPENAI_MODEL=gpt-4.1-mini
MIND_ATLAS_WEB_SEARCH_MODEL=gpt-4.1-mini
```

Check the local file without printing secrets:

```powershell
npm run staging:openai:doctor
```

Then restart staging:

```powershell
npm run staging:local:up
```

## Prepare Core Provider Baseline

After OpenAI works, the current paid-service baseline is OpenAI, Anthropic, and
DeepSeek. The other provider slots should stay blank or mocked until they are
tested one at a time.

Set:

```text
MIND_ATLAS_STAGING_MOCK_AUTH=0
MIND_ATLAS_STAGING_MOCK_BILLING=0
MIND_ATLAS_STAGING_MOCK_PROVIDERS=0
MIND_ATLAS_OPENAI_API_KEY=sk-...
MIND_ATLAS_ANTHROPIC_API_KEY=...
MIND_ATLAS_DEEPSEEK_API_KEY=...
MIND_ATLAS_PROVIDER_MODEL_FETCH=1
MIND_ATLAS_PROVIDER_MODEL_REFRESH_MS=300000
MIND_ATLAS_MODEL_PRICE_POLICY=require-provider
```

Provider model lists are fetched from the provider APIs by the hosted service.
The `MIND_ATLAS_*_MODELS` values remain as local fallback values only.
With `require-provider`, every configured provider must have a `provider:*` or
exact `provider:model` entry in `MIND_ATLAS_MODEL_PRICES_JSON`. With
`require-model`, every exposed model needs an exact `provider:model` price.

For the current three-provider staging baseline, use `require-model` and expose
only explicitly priced models:

```text
MIND_ATLAS_OPENAI_MODELS=gpt-4.1-mini,gpt-4.1
MIND_ATLAS_ANTHROPIC_MODELS=claude-haiku-4-5-20251001,claude-opus-4-8
MIND_ATLAS_DEEPSEEK_MODELS=deepseek-v4-flash,deepseek-v4-pro
MIND_ATLAS_MODEL_PRICE_POLICY=require-model
MIND_ATLAS_SERVICE_CHAT_RESERVE_CHARS_PER_TOKEN=2
MIND_ATLAS_SERVICE_MAX_REQUEST_ESTIMATE_MICRO_USD=150000
MIND_ATLAS_WEB_SEARCH_MIN_MICRO_USD=15000
```

The staging price assumptions should be refreshed from official pricing pages
before live traffic:

AI calls reserve AI usage token before the upstream request starts and settle
to recorded usage after success. Failed upstream requests refund the reservation.
Claude Fable 5 is a special one-pass exception: when exact pricing is present
and the model is exposed, a user with any remaining token can send one Fable 5
request. The service reserves the user's full remaining credit, allows the
request to exceed the normal estimate ceiling, and leaves the token at
0 percent after a successful upstream response. If the upstream call fails, the
reservation is refunded.

- OpenAI API pricing: https://platform.openai.com/docs/pricing
- Anthropic Claude pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
- DeepSeek Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing

Check the local file and live model-list endpoints without printing secrets:

```powershell
npm run staging:providers:doctor
```

Then restart staging:

```powershell
npm run staging:local:up
```

Verify that the live staging UI exposes only the expected Chat providers:

```powershell
npm run staging:ui:doctor
```

Run the live staging end-to-end pass after pricing and limits are set:

```powershell
npm run staging:e2e:doctor
```

This checks the paid-session baseline, OpenAI/Anthropic/DeepSeek Chat, model
switching, web search, Dictation, Realtime reservation, usage recording, token
exhaustion HTTP 402, and temporary `past_due` / `canceled` subscription status
handling before restoring the active staging account.

## What This Does Not Prove

The mock staging flow does not prove:

- real Google OAuth consent-screen configuration;
- real Stripe Checkout and webhook signing;
- real OpenAI Realtime WebRTC media behavior;
- final provider pricing or every model's compatibility.

It does prove that the hosted service wiring, PostgreSQL persistence, nginx
proxying, public UI mode, entitlement checks, credit ledger, usage events, and
all 11 provider slots are connected before moving to real credentials.
