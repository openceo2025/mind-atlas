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
- Users receive `AI usage token` as a 0-100 percent balance for the current
  Stripe subscription billing period.
- Internally, 100 percent equals the configured per-period AI credit budget
  `MONTHLY_CREDIT_MICRO_USD=5000000`, but the UI does not show dollars.
- When the token reaches 0 percent, AI requests return HTTP 402 until Stripe
  advances the subscription to the next billing period and creates a fresh
  credit account.
- Credit periods must be derived from Stripe subscription item
  `current_period_start` / `current_period_end`. If those dates are not synced,
  hosted AI is disabled instead of creating a fallback period from the current
  date.
- Chat and web search debit estimated provider cost after each response.
  Dictation debits a small estimated transcription cost. Realtime Talk debits
  a fixed reservation amount when a WebRTC session is successfully opened.
  Realtime sessions are additionally capped by session expiration, output-token
  limit, one-session-per-user concurrency, and a browser-side auto-close timer
  because final Realtime usage is not reported back through the server-side
  SDP exchange.

## Required External Setup

### DNS

Point `mind-atlas.org` to the ConoHa VPS public IPv4 address:

```text
A       mind-atlas.org      <VPS IPv4>
CNAME   www.mind-atlas.org  mind-atlas.org.
```

An `A` record for `www` pointing to the same VPS is also valid. Keep both host
names resolvable because nginx redirects `www` permanently to the canonical
`https://mind-atlas.org` origin.

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

Clone and install, for a **new** host only:

```bash
sudo mkdir -p /opt/mind-atlas
sudo chown "$USER":"$USER" /opt/mind-atlas
git clone https://github.com/openceo2025/mind-atlas.git /opt/mind-atlas
cd /opt/mind-atlas
npm ci
```

The live host at `mind-atlas.org` no longer carries a `.git` directory
(verified 2026-08-19): its tree is delivered as an archive of a pushed commit.
Updating and rolling back that host therefore never involve git on the server —
see Deploying An Update and Rollback.

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
MIND_ATLAS_REALTIME_SESSION_MICRO_USD=750000
MIND_ATLAS_REALTIME_MAX_OUTPUT_TOKENS=512
MIND_ATLAS_REALTIME_MAX_SESSION_SECONDS=300
MIND_ATLAS_REALTIME_MODELS=gpt-realtime-2
MIND_ATLAS_STRIPE_WEBHOOK_MAX_BYTES=1048576
MIND_ATLAS_STRIPE_WEBHOOK_TOLERANCE_SECONDS=300
MIND_ATLAS_TRANSCRIPTION_MIN_MICRO_USD=2000
MIND_ATLAS_TRANSCRIPTION_USD_PER_MINUTE=0.006
MIND_ATLAS_WEB_SEARCH_MIN_MICRO_USD=15000
MIND_ATLAS_WEB_SEARCH_MAX_QUERY_CHARS=1000
MIND_ATLAS_DEFAULT_INPUT_USD_PER_1M=1.5
MIND_ATLAS_DEFAULT_OUTPUT_USD_PER_1M=8
MIND_ATLAS_RATE_LIMIT_WINDOW_MS=60000
MIND_ATLAS_RATE_LIMIT_IP_MAX=180
MIND_ATLAS_RATE_LIMIT_AUTH_MAX=20
MIND_ATLAS_RATE_LIMIT_USER_AI_MAX=30
MIND_ATLAS_AI_CONCURRENT_REQUESTS=2
MIND_ATLAS_REALTIME_CONCURRENT_SESSIONS=1
MIND_ATLAS_SESSION_IDLE_DAYS=7
MIND_ATLAS_STALE_RESERVATION_MINUTES=30
MIND_ATLAS_MAINTENANCE_INTERVAL_MS=300000
MIND_ATLAS_CLOUD_NOTEBOOK_MAX_BYTES=10485760
MIND_ATLAS_CLOUD_NOTEBOOK_MAX_NODES=5000
```

Hosted cloud save is text-only. Attachments and package export stay local-only,
and the service stores each Google account's cloud notebooks in PostgreSQL under
the `MIND_ATLAS_CLOUD_NOTEBOOK_MAX_BYTES` quota. The public UI treats this as a
small file manager: users can save the current atlas under a new name, overwrite
an existing cloud file, rename files, delete files, load a selected file, and
create a public share link from a selected cloud file. Public share links are
backed by an unguessable token and do not expose local attachments. When a new
save or overwrite would exceed the quota, the service keeps the new/updated row
and deletes older cloud rows for that same user until the total is under the
limit.

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
enough Mind Atlas token for the estimated input and the request remains within
the normal per-request safety ceiling, it reserves the user's full remaining
credit and is allowed to settle above the reservation. A successful Fable 5 call
leaves the user's token at 0 percent so a second call is rejected by the normal
entitlement check. If the upstream call fails, the full reservation is refunded.
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

## Deploying An Update

The running host is updated by shipping an archive of a pushed commit, not by
pulling on the server. Use the `mind-atlas-deploy` skill, which performs the
whole sequence and prints a ready-to-paste rollback line:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\skills\mind-atlas-deploy\scripts\deploy.ps1"
```

What it does, if you ever need to do it by hand:

1. Refuse to continue unless the working tree is clean and `HEAD` is pushed, so
   the deployed tree is reproducible from a commit anyone can fetch.
2. `git archive --format=tar.gz -o <sha>.tar.gz HEAD` and `scp` it to
   `/opt/mind-atlas-backups/`.
3. On the server: `cp -a /opt/mind-atlas
   /opt/mind-atlas-backups/<timestamp>-<old-sha>`, extract the archive over
   `/opt/mind-atlas`, and write the full SHA to `/opt/mind-atlas/.deploy-commit`.
   The archive holds only committed files, so `.env.service`, `node_modules/`
   and the serving `dist/` are untouched until the build replaces `dist/`.
4. `npm ci`, then the hosted build, `verify:hosted-dist` and `service:migrate`
   above.
5. `chown -R www-data:www-data /opt/mind-atlas`, then restore `.env.service` to
   `root:www-data` mode `640` — the service reads it through its group.
6. `systemctl restart mind-atlas`, then check `systemctl is-active` and
   `/health`.
7. Once the new tree is confirmed serving, delete the uploaded archive and
   every older backup directory, so `/opt/mind-atlas-backups` holds exactly one
   generation. See Rollback for why one and not more.

`/opt/mind-atlas` has no `.git`, so `git fetch`, `git checkout` and `git pull`
there all fail with `fatal: not a git repository`. Extraction also lays the new
tree over the old one, so a file deleted in a commit stays on the server until
it is removed explicitly.

Which commit is live:

```bash
cat /opt/mind-atlas/.deploy-commit
curl -s https://mind-atlas.org/.mind-atlas-build.json
```

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

### Shogi engine bridge

Shogi position analysis runs as a second unit on the same host. It is the only
service that can talk to the engine, and nginx never exposes it: it listens on
`127.0.0.1:8787` and the web service reaches it from localhost.

Install the engine and its evaluation file under `/opt/shogi` first:

```bash
sudo apt-get install -y clang lld make git 7zip
sudo mkdir -p /opt/shogi && cd /opt/shogi
sudo git clone --depth 1 https://github.com/yaneurao/YaneuraOu.git
cd YaneuraOu/source
sudo nice -n 19 make -j3 normal COMPILER=clang++ TARGET_CPU=AVX512VNNI YANEURAOU_EDITION=YANEURAOU_ENGINE_NNUE
sudo cp YaneuraOu-by-gcc /opt/shogi/bin/yaneuraou
```

`lld` is required: the LTO build passes `-fuse-ld=lld` and fails without it.
Pick `TARGET_CPU` from `lscpu`; the current host reports `avx512_vnni`, and
`AVX512VNNI` measured about 10% faster there than `AVX2`. Build both and
compare with a fixed `go movetime` search before choosing — and hold the
engine's stdin open while measuring, because YaneuraOu treats EOF as a quit and
will answer from depth 1 with zero nodes otherwise.

The evaluation file is Suisho5, pinned by release:

```bash
curl -fsSL -o /opt/shogi/dist/Suisho5.7z \
  https://github.com/yaneurao/YaneuraOu/releases/download/suisho5/Suisho5.7z
# sha256 6734e3a3d28e67b9206c3442f6d10f16148138327dff811cadedfcf581f79809
sudo 7z x -o/opt/shogi/eval /opt/shogi/dist/Suisho5.7z   # nn.bin, 64,217,066 bytes
sudo chmod -R a+rX /opt/shogi
```

Then install the unit:

```bash
sudo cp deploy/conoha/mind-atlas-shogi-engine.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mind-atlas-shogi-engine
curl -s http://127.0.0.1:8787/health
```

The unit is `PartOf=mind-atlas.service`, so the restart at the end of a deploy
propagates to it and the bridge always runs the deployed `server/shogi-engine.mjs`.
Its `MIND_ATLAS_SHOGI_*` settings come from the same `.env.service`.

`CPUWeight=20` is the setting that protects the site. One search saturates its
threads for the whole movetime, so on this 4 vCPU host the engine is deliberately
given a lower scheduling weight than the web service: browsing wins the CPU
whenever it wants it and analysis fills the gaps. Resident cost is about 400 MB
(64 MB evaluation weights, a 128 MB transposition table, two search threads and
the Node bridge), capped by `MemoryMax=700M`.

## nginx And HTTPS

Install the included nginx template:

```bash
sudo cp deploy/conoha/nginx-rate-limits.conf /etc/nginx/conf.d/mind-atlas-rate-limits.conf
sudo cp deploy/conoha/nginx-analytics.conf /etc/nginx/conf.d/mind-atlas-analytics.conf
sudo cp deploy/conoha/nginx.conf /etc/nginx/sites-available/mind-atlas
sudo cp deploy/conoha/mind-atlas-analytics.logrotate /etc/logrotate.d/mind-atlas-analytics
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

After the certificate exists, install the tracked live TLS configuration so
the canonical `www` redirect remains explicit and reproducible:

```bash
sudo cp deploy/conoha/nginx-live.conf /etc/nginx/sites-available/mind-atlas
sudo nginx -t
sudo systemctl reload nginx
```

After Certbot, verify:

```bash
curl https://mind-atlas.org/health
curl -I https://mind-atlas.org/ | grep -i strict-transport-security
curl -I https://www.mind-atlas.org/ | grep -iE "HTTP/|location:"
```

The expected `www` response is `301` with
`Location: https://mind-atlas.org/`. Certbot should retain the dedicated
redirect server from `deploy/conoha/nginx.conf`; do not combine `www` into the
application proxy server after certificate renewal.

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
npm run service:admin -- sync-stripe-periods [user@example.com]
npm run service:admin -- reap-stale-reservations [minutes]
npm run service:admin -- cleanup-sessions [idleDays]
npm run service:admin -- growth-report --days 30
npm run service:admin -- growth-report --days 30 --json
npm run service:admin -- analytics-cleanup
npm run service:admin -- analytics-daily [--date YYYY-MM-DD]
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

`sync-stripe-periods` refreshes stored subscription billing period start/end
dates from Stripe. Run it after Stripe API-version changes, webhook issues, or
whenever an active user shows no next token renewal date. When it fixes a
previously missing period, it moves the latest existing credit account to the
Stripe period key instead of granting a second 100 percent balance.

`reap-stale-reservations` refunds old AI credit reservations that were created
before an upstream call but never settled because the service crashed or was
restarted mid-request. The service also runs this cleanup automatically on
startup and periodically.

`cleanup-sessions` deletes expired sessions and sessions idle longer than
`MIND_ATLAS_SESSION_IDLE_DAYS`.

`growth-report` returns the promotion KPI report without exposing a public
admin API. The JSON form has a fixed schema for Codex analysis. Its North Star
is the last seven days of Meaningful Active Users even when the surrounding
report period is 30 days. Rates with fewer than 20 observations are marked as
reference-only and retain their numerator and denominator.

`analytics-daily` reads the previous day's privacy-preserving nginx JSON log,
replaces that day's `traffic_daily` aggregates, stores a 30-day KPI snapshot,
and deletes expired analytics rows. Raw nginx analytics logs rotate after 14
days; daily aggregates and snapshots are retained for 24 months. Product
events never contain notebook titles/bodies, AI prompts, email addresses,
Google sub values, share tokens, IP addresses, or complete URLs.

For the staged rollout, set `MIND_ATLAS_ANALYTICS_ENABLED=1` and
`MIND_ATLAS_CLIENT_ANALYTICS_ENABLED=0` first. This records only
server-authoritative Google, cloud, sharing, Stripe, and AI events while the
nginx daily aggregator is checked. After 24 hours of internal validation, set
`MIND_ATLAS_CLIENT_ANALYTICS_ENABLED=1` and restart `mind-atlas`; only then do
storage-free browser events begin. The client uses page-lifetime in-memory
identifiers and does not display a consent banner or persist analytics IDs in
cookies, localStorage, or sessionStorage.

Install the daily timer after deploying the templates:

```bash
sudo cp deploy/conoha/mind-atlas-analytics.service /etc/systemd/system/
sudo cp deploy/conoha/mind-atlas-analytics.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mind-atlas-analytics.timer
systemctl list-timers mind-atlas-analytics.timer
```

Generate `MIND_ATLAS_ANALYTICS_HMAC_KEY` locally and store it only in the VPS
`.env.service`. Do not commit it:

```bash
openssl rand -base64 48
```

From the Windows workspace, the read-only SSH wrapper is:

```powershell
$env:MIND_ATLAS_VPS_HOST = "160.251.141.158"
$env:MIND_ATLAS_VPS_USER = "root"
$env:MIND_ATLAS_VPS_KEY_PATH = "$env:USERPROFILE\.ssh\mind-atlas-api-key-01.pem"
npm run ops:kpi -- --days 30
npm run ops:kpi -- --days 30 --json
```

The wrapper invokes only the read-only `growth-report` under
`/opt/mind-atlas`. It does not run migrations, open a web dashboard, expose a
management HTTP endpoint, or mutate analytics data.

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

Roll back by putting the previous tree back. Each deploy leaves one full copy of
what it replaced, including that build's `dist/` and `node_modules/`, so no
rebuild is needed and the site returns in seconds:

```bash
ls -1 /opt/mind-atlas-backups
systemctl stop mind-atlas
rm -rf /opt/mind-atlas
mv /opt/mind-atlas-backups/<timestamp>-<old-sha> /opt/mind-atlas
systemctl start mind-atlas
curl -fsS http://127.0.0.1:8788/health
```

Do not run `git` commands in `/opt/mind-atlas` — see the warning under
Deploying An Update. To go back further than one generation, deploy the older
commit with the normal flow rather than checking it out on the server; git
holds every deployed commit, so nothing is lost by keeping only one copy here.

Only one generation is retained on purpose. A second copy would protect nothing
that git does not already protect, and a full copy contains `.env.service`, so
every extra generation is another plain-text copy of the database password and
the provider keys sitting on the server. Nothing creates these backups
automatically — no cron entry and no systemd timer — so they appear only when a
deploy runs.

The safety branch for the original implementation is:

```text
codex/mind-atlas-vps-service
```

Do not commit `.env.service` or provider API keys.
