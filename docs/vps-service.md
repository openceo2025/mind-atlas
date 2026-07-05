# Mind Atlas VPS Service Deployment

This document records the first paid-service deployment shape for
`mind-atlas.org` on ConoHa VPS. It is written for a small launch target: fewer
than 100 users, one VPS, one PostgreSQL database, and server-side provider API
keys owned by the operator.

## Service Shape

Production uses one Node service:

- serves the built React app from `dist/`;
- exposes Google OAuth login;
- exposes Stripe subscription checkout and webhook handling;
- stores users, sessions, subscriptions, credit accounts, credit ledger, and AI
  usage events in PostgreSQL;
- proxies Chat, Realtime Talk, Dictation, and web-search requests to provider
  APIs with keys kept only on the VPS;
- hides Code/Codex, Claude Code, OpenClaw, and local-provider controls when
  `VITE_MIND_ATLAS_PUBLIC_SERVICE=true`.

The local developer bridge remains separate:

```text
npm run dev:bridge -> scripts/mind-atlas-bridge.mjs
npm run service:start -> server/mind-atlas-service.mjs
```

## What Users See

- Visitors can use the non-AI notebook without Google login.
- The top-right AI feature button opens the hosted account panel.
- Google login creates or updates a user account.
- A Stripe monthly subscription unlocks Chat and Realtime Talk.
- Users receive `AI usage token` as a 0-100 percent monthly balance.
- Internally, 100 percent equals the configured monthly AI credit budget
  `MONTHLY_CREDIT_MICRO_USD=5000000`, but the UI does not show dollars.
- When the monthly token reaches 0 percent, AI requests return HTTP 402 until
  the next subscription period creates a fresh credit account.
- Chat and web search debit estimated provider cost after each response.
  Dictation debits a small estimated transcription cost. Realtime Talk debits
  a fixed reservation amount when a WebRTC session is successfully opened
  because final Realtime usage is not reported back through the server-side
  SDP exchange.

## Required External Setup

### DNS

Point `mind-atlas.org` to the ConoHa VPS public IPv4 address:

```text
A     mind-atlas.org      <VPS IPv4>
A     www.mind-atlas.org  <VPS IPv4>
```

### Google OAuth

Create a Google OAuth web client and set:

```text
Authorized JavaScript origins:
  https://mind-atlas.org

Authorized redirect URIs:
  https://mind-atlas.org/api/auth/google/callback
```

Save the values as:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Stripe Billing

Create a USD 10 monthly recurring Price in Stripe.

Save:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID=price_...
```

Create a webhook endpoint:

```text
https://mind-atlas.org/api/billing/stripe/webhook
```

Subscribe to at least:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_succeeded
```

Save the webhook signing secret:

```text
STRIPE_WEBHOOK_SECRET=whsec_...
```

## VPS Base Setup

Ubuntu example:

```bash
sudo apt update
sudo apt install -y git curl nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

Create a database:

```bash
sudo -u postgres psql
```

```sql
create user mindatlas with password 'replace-with-a-long-password';
create database mindatlas owner mindatlas;
\q
```

Clone and install:

```bash
sudo mkdir -p /opt/mind-atlas
sudo chown "$USER":"$USER" /opt/mind-atlas
git clone https://github.com/openceo2025/mind-atlas.git /opt/mind-atlas
cd /opt/mind-atlas
npm ci
```

## Environment File

Create `/opt/mind-atlas/.env.service`. You can start from
`deploy/conoha/env.service.example`:

```bash
cp deploy/conoha/env.service.example .env.service
chmod 600 .env.service
```

Then edit `.env.service`:

```ini
DATABASE_URL=postgres://mindatlas:replace-with-a-long-password@127.0.0.1:5432/mindatlas

MIND_ATLAS_SERVICE_HOST=127.0.0.1
MIND_ATLAS_SERVICE_PORT=8788
MIND_ATLAS_PUBLIC_ORIGIN=https://mind-atlas.org
MIND_ATLAS_DIST_DIR=dist
MIND_ATLAS_COOKIE_SECURE=1
MIND_ATLAS_ALLOWED_ORIGIN=https://mind-atlas.org

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_ID=...

MIND_ATLAS_OPENAI_API_KEY=...
MIND_ATLAS_ANTHROPIC_API_KEY=...
MIND_ATLAS_DEEPSEEK_API_KEY=...

MIND_ATLAS_GLM_API_KEY=
MIND_ATLAS_GEMINI_API_KEY=
MIND_ATLAS_QWEN_API_KEY=
MIND_ATLAS_COMPOSER_API_KEY=
MIND_ATLAS_KIMI_API_KEY=
MIND_ATLAS_MIMO_API_KEY=
MIND_ATLAS_MINIMAX_API_KEY=
MIND_ATLAS_GROK_API_KEY=

MIND_ATLAS_MODEL_PRICES_JSON={}
MIND_ATLAS_MODEL_PRICE_POLICY=require-model
MIND_ATLAS_PROVIDER_MODEL_FETCH=1
MIND_ATLAS_PROVIDER_MODEL_CACHE_MS=300000
MIND_ATLAS_PROVIDER_MODEL_REFRESH_MS=300000
MIND_ATLAS_PROVIDER_MODEL_FETCH_TIMEOUT_MS=10000
MIND_ATLAS_PROVIDER_MODEL_MAX_COUNT=80
MIND_ATLAS_SERVICE_JSON_MAX_BYTES=2097152
MIND_ATLAS_SERVICE_FORM_MAX_BYTES=29360128
MIND_ATLAS_SERVICE_CHAT_INPUT_MAX_CHARS=300000
MIND_ATLAS_SERVICE_CHAT_RESERVE_CHARS_PER_TOKEN=2
MIND_ATLAS_SERVICE_MAX_REQUEST_ESTIMATE_MICRO_USD=150000
MIND_ATLAS_SERVICE_HIGH_COST_OUTPUT_USD_PER_1M=50
MIND_ATLAS_SERVICE_HIGH_COST_MAX_OUTPUT_TOKENS=2048
MIND_ATLAS_REALTIME_SESSION_MICRO_USD=100000
MIND_ATLAS_REALTIME_MODELS=gpt-realtime-2
MIND_ATLAS_STRIPE_WEBHOOK_MAX_BYTES=1048576
MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS=300
MIND_ATLAS_TRANSCRIPTION_MIN_MICRO_USD=2000
MIND_ATLAS_TRANSCRIPTION_USD_PER_MINUTE=0.006
MIND_ATLAS_WEB_SEARCH_MIN_MICRO_USD=15000
MIND_ATLAS_WEB_SEARCH_MAX_QUERY_CHARS=1000
MIND_ATLAS_DEFAULT_INPUT_USD_PER_1M=1.5
MIND_ATLAS_DEFAULT_OUTPUT_USD_PER_1M=8
```

Provider model lists are fetched server-side from provider APIs when
`MIND_ATLAS_PROVIDER_MODEL_FETCH=1`. In `require-model` mode, the public model
selector exposes only fetched models that also have exact prices in
`MIND_ATLAS_MODEL_PRICES_JSON`. The values below are fallback model lists and
base URL overrides for providers whose model-list endpoint is unavailable or
intentionally disabled:

```ini
MIND_ATLAS_OPENAI_MODELS=gpt-5.5,gpt-5.4-mini,gpt-4.1-mini,gpt-4.1
# MIND_ATLAS_OPENAI_CHAT_MODELS is also accepted for local-bridge compatibility.
MIND_ATLAS_ANTHROPIC_MODELS=claude-fable-5,claude-haiku-4-5-20251001,claude-opus-4-8
MIND_ATLAS_GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
MIND_ATLAS_GLM_MODELS=glm-4.5,glm-4.5-air
MIND_ATLAS_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
MIND_ATLAS_DEEPSEEK_MODELS=deepseek-v4-flash,deepseek-v4-pro
# DeepSeek also accepts MIND_ATLAS_DEEPSEEK_AUTH_TOKEN, DEEPSEEK_API_KEY, and
# MIND_ATLAS_CLAUDE_DEEPSEEK_AUTH_TOKEN as key fallbacks.
MIND_ATLAS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MIND_ATLAS_GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-pro
MIND_ATLAS_QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
MIND_ATLAS_QWEN_MODELS=qwen-plus,qwen-max
MIND_ATLAS_COMPOSER_BASE_URL=
MIND_ATLAS_COMPOSER_MODELS=composer
MIND_ATLAS_KIMI_BASE_URL=https://api.moonshot.ai/v1
MIND_ATLAS_KIMI_MODELS=kimi-k2,moonshot-v1-32k
MIND_ATLAS_MIMO_BASE_URL=
MIND_ATLAS_MIMO_MODELS=mimo-chat
MIND_ATLAS_MINIMAX_BASE_URL=https://api.minimax.io/v1
MIND_ATLAS_MINIMAX_MODELS=MiniMax-M1,abab6.5s-chat
MIND_ATLAS_GROK_BASE_URL=https://api.x.ai/v1
MIND_ATLAS_GROK_MODELS=grok-4,grok-3
```

The service has a built-in conservative price catalog for the core OpenAI,
Anthropic, and DeepSeek families. `MIND_ATLAS_MODEL_PRICES_JSON` is an override
for corrections or newly launched models. With
`MIND_ATLAS_MODEL_PRICE_POLICY=require-model`, every exposed Chat model must
resolve to a built-in or override `provider:model` price; otherwise the model is
not exposed and requests for it are rejected.
`require-provider` allows exact model prices or a provider-level `provider:*`
fallback. `allow-default` falls back to `MIND_ATLAS_DEFAULT_INPUT_USD_PER_1M` and
`MIND_ATLAS_DEFAULT_OUTPUT_USD_PER_1M` for unknown prices, which is convenient
for local development but unsafe for paid traffic.

Provider model lists are refreshed in the background every
`MIND_ATLAS_PROVIDER_MODEL_REFRESH_MS` milliseconds. For example, when
Anthropic's model API starts returning Claude Fable 5, the public selector will
show it after the next refresh because `claude-fable-5` has a built-in
USD 10 / 50 per 1M token price entry. Unpriced fetched models remain hidden.
For Anthropic Fable/Mythos models, the service also sends a tiny Messages API
probe before exposing the model, because Anthropic can list these models before
the current account is allowed to use them.

Current core-provider price sources:

- OpenAI API pricing: https://platform.openai.com/docs/pricing
- Anthropic Claude pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
- DeepSeek Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing

`MIND_ATLAS_SERVICE_MAX_REQUEST_ESTIMATE_MICRO_USD` is an operator safety
limit. It prevents one oversized Chat request from consuming too much of the
monthly internal AI budget. Set it to `0` only if you intentionally want to
disable that per-request ceiling.
Chat calls reserve the estimated request ceiling before contacting the upstream
provider, then settle the reservation to actual recorded usage after the
provider returns. If the upstream call fails, the reservation is refunded.
`MIND_ATLAS_SERVICE_CHAT_RESERVE_CHARS_PER_TOKEN` controls the conservative
input-token estimate used for that reservation. The default `2` means two
serialized input characters count as one token for reservation purposes.
Models whose output price is at least
`MIND_ATLAS_SERVICE_HIGH_COST_OUTPUT_USD_PER_1M` use
`MIND_ATLAS_SERVICE_HIGH_COST_MAX_OUTPUT_TOKENS` as their upstream output cap.
This keeps high-cost options such as Claude Fable 5 usable without raising the
global per-request safety limit.
Claude Fable 5 also has a one-pass hosted-service exception: if the user has
any Mind Atlas token remaining, the request reserves the user's full remaining
credit, skips the normal per-request estimate ceiling, and is allowed to settle
above the reservation. A successful Fable 5 call leaves the user's token at
0 percent so a second call is rejected by the normal entitlement check. If the
upstream call fails, the full reservation is refunded.
Realtime, Dictation, and web search also reserve their configured fixed,
estimated, or minimum cost before upstream execution, then settle or refund the
reservation.

## Build For Public Service

Build with hosted-service mode enabled. Do not deploy a plain `npm run build`
output to ConoHa; that build is for local developer mode and can expose local
AI surfaces in the browser.

```bash
cd /opt/mind-atlas
npm run build:hosted
npm run verify:hosted-dist
```

Run migrations:

```bash
npm run service:migrate
```

Smoke test the service locally on the VPS:

```bash
npm run service:start
curl http://127.0.0.1:8788/health
```

Stop it with `Ctrl+C` after the smoke test.

## systemd

Install the included systemd template:

```bash
sudo cp deploy/conoha/mind-atlas.service /etc/systemd/system/mind-atlas.service
```

Set permissions:

```bash
sudo chown -R www-data:www-data /opt/mind-atlas
sudo chmod 600 /opt/mind-atlas/.env.service
sudo systemctl daemon-reload
sudo systemctl enable --now mind-atlas
sudo systemctl status mind-atlas
```

## nginx And HTTPS

Install the included nginx template:

```bash
sudo cp deploy/conoha/nginx.conf /etc/nginx/sites-available/mind-atlas
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/mind-atlas /etc/nginx/sites-enabled/mind-atlas
sudo nginx -t
sudo systemctl reload nginx
```

Install HTTPS with Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mind-atlas.org -d www.mind-atlas.org
```

After Certbot, verify:

```bash
curl https://mind-atlas.org/health
```

## Admin CUI

Run from `/opt/mind-atlas`:

```bash
npm run service:admin -- doctor
npm run service:admin -- users
npm run service:admin -- user user@example.com
npm run service:admin -- usage user@example.com
npm run service:admin -- grant-admin user@example.com
npm run service:admin -- grant-credit user@example.com 20
npm run service:admin -- set-credit user@example.com 0
```

`doctor` checks the built `dist` directory, Google OAuth, Stripe, OpenAI,
configured chat providers, model price coverage, and PostgreSQL migration
status. It prints only presence/health information and does not print secret
values.

`usage` lists recent metered AI usage for one user, including provider, model,
estimated cost, token spend, duration, and request id.

`grant-credit` accepts a percent value. It cannot raise the user above 100
percent for the current credit period.

`set-credit` sets the current period to an exact percent from 0 to 100. Use it
for staging exhaustion tests and emergency operator adjustments.

## Local Staging Before ConoHa

Before moving to ConoHa, run the local VPS-like staging environment described
in [staging-service.md](staging-service.md). It uses Docker Compose to run
PostgreSQL, the Node hosted service, and nginx together, and it can verify the
Google/Stripe/provider flow with explicit staging mocks before real keys are
available.

## Verification Checklist

Before public promotion:

1. `npm ci`
2. `npm run verify:hosted-service`
3. `npm run verify:hosted-public-ui`
4. `docker compose -f docker-compose.staging.yml up --build -d`
5. `npm run staging:verify`
6. `docker compose -f docker-compose.staging.yml exec app node server/admin.mjs set-credit staging-user@example.test 0`
7. Confirm an AI request returns HTTP 402, then restore with `set-credit ... 100`.
8. `npm run build:hosted`
9. `npm run verify:hosted-dist`
10. `npm run service:migrate`
11. `npm run service:admin -- doctor`
12. `npm run service:start`
13. `curl http://127.0.0.1:8788/health`
14. `curl https://mind-atlas.org/health`
15. Open `https://mind-atlas.org/`.
16. Confirm the top-right AI feature button appears.
17. Confirm unauthenticated users can edit the notebook but cannot open Chat.
18. Complete Google login.
19. Complete Stripe checkout in test mode first.
20. Confirm `/api/service/session` returns `entitlement.aiEnabled=true`.
21. Confirm Chat works with a configured provider.
22. Confirm token percent decreases after a metered Chat response.
23. Confirm `npm run service:admin -- usage user@example.com` shows the Chat
    request.
24. Confirm token percent decreases after web search and Dictation.
25. Confirm Realtime Talk connects only after entitlement is active and records
    a `realtime_session_reservation` usage event.
26. Confirm Code/Codex, Claude Code, OpenClaw, and Local controls are hidden in
    public service mode.

## Rollback

The safety branch for this implementation is:

```text
codex/mind-atlas-vps-service
```

To roll back the VPS app to the previous deployed commit:

```bash
cd /opt/mind-atlas
git fetch origin
git checkout <previous-good-commit>
npm ci
VITE_MIND_ATLAS_PUBLIC_SERVICE=true \
VITE_MIND_ATLAS_SERVICE_URL=https://mind-atlas.org \
npm run build
sudo systemctl restart mind-atlas
```

Do not commit `.env.service` or provider API keys.
