import crypto from "node:crypto";
import pg from "pg";
import { getRequiredEnv } from "./service-config.mjs";

const { Pool } = pg;

export const MONTHLY_CREDIT_MICRO_USD = 5_000_000;

export const pool = new Pool({
  connectionString: getRequiredEnv("DATABASE_URL"),
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function migrateDatabase() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      google_sub text unique,
      email text not null,
      name text not null default '',
      picture_url text not null default '',
      role text not null default 'user',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table users drop constraint if exists users_email_key;
    create index if not exists users_email_idx on users(email);

    create table if not exists sessions (
      id_hash text primary key,
      user_id text not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      last_seen_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );

    alter table sessions add column if not exists last_seen_at timestamptz not null default now();
    create index if not exists sessions_user_id_idx on sessions(user_id);
    create index if not exists sessions_expires_at_idx on sessions(expires_at);
    create index if not exists sessions_last_seen_at_idx on sessions(last_seen_at);

    create table if not exists subscriptions (
      user_id text primary key references users(id) on delete cascade,
      stripe_customer_id text unique,
      stripe_subscription_id text unique,
      status text not null default 'none',
      price_id text not null default '',
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean not null default false,
      updated_at timestamptz not null default now()
    );

    alter table subscriptions add column if not exists unit_amount_minor integer;
    alter table subscriptions add column if not exists currency text not null default 'usd';
    alter table subscriptions add column if not exists billing_interval text not null default 'month';
    alter table subscriptions add column if not exists activated_at timestamptz;
    alter table subscriptions add column if not exists cancelled_at timestamptz;

    create table if not exists credit_accounts (
      user_id text not null references users(id) on delete cascade,
      period_key text not null,
      credit_limit_micro_usd bigint not null,
      credit_remaining_micro_usd bigint not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (user_id, period_key)
    );

    create table if not exists credit_ledger (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      period_key text not null,
      delta_micro_usd bigint not null,
      reason text not null,
      request_id text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists credit_ledger_user_created_idx on credit_ledger(user_id, created_at desc);

    create table if not exists usage_events (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      request_id text not null,
      provider text not null,
      model text not null,
      input_tokens integer not null default 0,
      output_tokens integer not null default 0,
      estimated_cost_micro_usd bigint not null default 0,
      credit_spent_micro_usd bigint not null default 0,
      duration_ms integer,
      created_at timestamptz not null default now()
    );

    create index if not exists usage_events_user_created_idx on usage_events(user_id, created_at desc);

    create table if not exists stripe_events (
      id text primary key,
      type text not null default '',
      status text not null default 'processing',
      created_at timestamptz not null default now(),
      processed_at timestamptz
    );

    create index if not exists stripe_events_status_created_idx on stripe_events(status, created_at desc);

    create table if not exists cloud_notebooks (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      visibility text not null default 'private',
      share_token text unique,
      title text not null default '',
      data jsonb not null,
      size_bytes integer not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_accessed_at timestamptz
    );

    create index if not exists cloud_notebooks_user_updated_idx on cloud_notebooks(user_id, updated_at desc);
    create index if not exists cloud_notebooks_user_created_idx on cloud_notebooks(user_id, created_at asc);
    create index if not exists cloud_notebooks_share_token_idx on cloud_notebooks(share_token) where share_token is not null;

    create table if not exists product_events (
      id text primary key,
      event_id text not null unique,
      event_name text not null,
      source text not null default 'client',
      actor_hash text,
      session_hash text,
      user_id text references users(id) on delete set null,
      occurred_at timestamptz not null,
      locale text not null default 'unknown',
      page_group text not null default 'unknown',
      referrer_host text not null default '',
      utm_source text not null default '',
      utm_medium text not null default '',
      utm_campaign text not null default '',
      utm_content text not null default '',
      utm_term text not null default '',
      first_referrer_host text not null default '',
      first_utm_source text not null default '',
      first_utm_medium text not null default '',
      first_utm_campaign text not null default '',
      first_utm_content text not null default '',
      first_utm_term text not null default '',
      device_class text not null default 'unknown',
      experiment_id text not null default '',
      variant text not null default '',
      properties jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists product_events_name_occurred_idx on product_events(event_name, occurred_at desc);
    create index if not exists product_events_actor_occurred_idx on product_events(actor_hash, occurred_at desc) where actor_hash is not null;
    create index if not exists product_events_user_occurred_idx on product_events(user_id, occurred_at desc) where user_id is not null;
    alter table product_events add column if not exists first_referrer_host text not null default '';
    alter table product_events add column if not exists first_utm_source text not null default '';
    alter table product_events add column if not exists first_utm_medium text not null default '';
    alter table product_events add column if not exists first_utm_campaign text not null default '';
    alter table product_events add column if not exists first_utm_content text not null default '';
    alter table product_events add column if not exists first_utm_term text not null default '';

    create table if not exists traffic_daily (
      day date not null,
      page_group text not null default 'unknown',
      landing_page text not null default 'unknown',
      referrer_host text not null default '',
      utm_source text not null default '',
      utm_medium text not null default '',
      utm_campaign text not null default '',
      locale text not null default 'unknown',
      device_class text not null default 'unknown',
      pv integer not null default 0,
      unique_visitors integer not null default 0,
      bot_pv integer not null default 0,
      error_4xx integer not null default 0,
      error_5xx integer not null default 0,
      response_ms_total bigint not null default 0,
      response_count integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (day, page_group, landing_page, referrer_host, utm_source, utm_medium, utm_campaign, locale, device_class)
    );

    create index if not exists traffic_daily_day_idx on traffic_daily(day desc);

    create table if not exists analytics_daily_snapshots (
      day date primary key,
      report jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists analytics_ingest_daily (
      day date primary key,
      accepted integer not null default 0,
      rejected integer not null default 0,
      duplicates integer not null default 0,
      updated_at timestamptz not null default now()
    );
  `);
}

export async function upsertGoogleUser(profile) {
  const id = `usr_${crypto.randomUUID()}`;
  const result = await pool.query(
    `
      insert into users (id, google_sub, email, name, picture_url)
      values ($1, $2, $3, $4, $5)
      on conflict (google_sub) do update set
        email = excluded.email,
        name = excluded.name,
        picture_url = excluded.picture_url,
        updated_at = now()
      returning id, google_sub, email, name, picture_url, role, created_at, updated_at, (xmax = 0) as created
    `,
    [id, profile.sub, profile.email, profile.name || "", profile.picture || ""],
  );
  return result.rows[0];
}

export async function createSession(userId, ttlDays = 30) {
  const token = crypto.randomBytes(32).toString("base64url");
  const idHash = hashSessionToken(token);
  await pool.query(
    "insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)",
    [idHash, userId, ttlDays],
  );
  return token;
}

export async function deleteSession(token) {
  if (!token) return;
  await pool.query("delete from sessions where id_hash = $1", [hashSessionToken(token)]);
}

export async function getSessionUser(token, idleTtlDays = 7) {
  if (!token) return null;
  const result = await pool.query(
    `
      update sessions
      set last_seen_at = now()
      from users
      where sessions.user_id = users.id
        and sessions.id_hash = $1
        and sessions.expires_at > now()
        and sessions.last_seen_at > now() - ($2 || ' days')::interval
      returning
        users.id,
        users.google_sub,
        users.email,
        users.name,
        users.picture_url,
        users.role,
        users.created_at,
        users.updated_at
    `,
    [hashSessionToken(token), idleTtlDays],
  );
  return result.rows[0] ?? null;
}

export async function deleteExpiredSessions(idleTtlDays = 7) {
  const result = await pool.query(
    `
      delete from sessions
      where expires_at <= now()
         or last_seen_at <= now() - ($1 || ' days')::interval
    `,
    [idleTtlDays],
  );
  return result.rowCount ?? 0;
}

export async function getUserSubscription(userId) {
  const result = await pool.query("select * from subscriptions where user_id = $1", [userId]);
  return result.rows[0] ?? null;
}

export async function upsertSubscriptionByUserId(userId, patch) {
  const result = await pool.query(
    `
      insert into subscriptions (
        user_id,
        stripe_customer_id,
        stripe_subscription_id,
        status,
        price_id,
        current_period_start,
        current_period_end,
        cancel_at_period_end,
        unit_amount_minor,
        currency,
        billing_interval,
        activated_at,
        cancelled_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        case when $4 = 'active' then now() else null end,
        case when $4 = 'canceled' then now() else null end,
        now())
      on conflict (user_id) do update set
        stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
        status = excluded.status,
        price_id = coalesce(nullif(excluded.price_id, ''), subscriptions.price_id),
        current_period_start = coalesce(excluded.current_period_start, subscriptions.current_period_start),
        current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
        cancel_at_period_end = excluded.cancel_at_period_end,
        unit_amount_minor = coalesce(excluded.unit_amount_minor, subscriptions.unit_amount_minor),
        currency = coalesce(nullif(excluded.currency, ''), subscriptions.currency),
        billing_interval = coalesce(nullif(excluded.billing_interval, ''), subscriptions.billing_interval),
        activated_at = case
          when excluded.status = 'active' and subscriptions.status <> 'active' then now()
          else subscriptions.activated_at
        end,
        cancelled_at = case
          when excluded.status = 'canceled' and subscriptions.status <> 'canceled' then now()
          else subscriptions.cancelled_at
        end,
        updated_at = now()
      returning *
    `,
    [
      userId,
      patch.stripeCustomerId ?? null,
      patch.stripeSubscriptionId ?? null,
      patch.status ?? "none",
      patch.priceId ?? "",
      patch.currentPeriodStart ?? null,
      patch.currentPeriodEnd ?? null,
      patch.cancelAtPeriodEnd === true,
      Number.isFinite(Number(patch.unitAmountMinor)) ? Math.max(0, Math.round(Number(patch.unitAmountMinor))) : null,
      patch.currency ?? "usd",
      patch.billingInterval ?? "month",
    ],
  );
  return result.rows[0];
}

export async function upsertSubscriptionByStripeCustomer(stripeCustomerId, patch) {
  const user = await pool.query("select user_id from subscriptions where stripe_customer_id = $1", [stripeCustomerId]);
  const userId = user.rows[0]?.user_id;
  if (!userId) return null;
  return await upsertSubscriptionByUserId(userId, { ...patch, stripeCustomerId });
}

export function isSubscriptionActive(subscription) {
  return subscription?.status === "active";
}

export function creditPeriodKey(subscription = null) {
  const value = subscription?.current_period_start;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hasSubscriptionBillingPeriod(subscription = null) {
  if (!creditPeriodKey(subscription)) return false;
  const value = subscription?.current_period_end;
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime());
}

export async function ensureCreditAccount(userId, subscription = null) {
  const periodKey = creditPeriodKey(subscription);
  if (!periodKey) return null;
  const result = await pool.query(
    `
      insert into credit_accounts (user_id, period_key, credit_limit_micro_usd, credit_remaining_micro_usd)
      values ($1, $2, $3, $3)
      on conflict (user_id, period_key) do nothing
      returning *
    `,
    [userId, periodKey, MONTHLY_CREDIT_MICRO_USD],
  );
  if (result.rows[0]) {
    await pool.query(
      "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason) values ($1, $2, $3, $4, $5)",
      [`led_${crypto.randomUUID()}`, userId, periodKey, MONTHLY_CREDIT_MICRO_USD, "monthly_grant"],
    );
    return result.rows[0];
  }
  const existing = await pool.query("select * from credit_accounts where user_id = $1 and period_key = $2", [userId, periodKey]);
  return existing.rows[0] ?? null;
}

export async function debitCredit({ userId, subscription, amountMicroUsd, requestId, metadata = {} }) {
  const account = await ensureCreditAccount(userId, subscription);
  if (!account) throw new Error("Credit account could not be created");
  const debit = Math.max(0, Math.round(amountMicroUsd));
  if (debit === 0) return account;
  const result = await pool.query(
    `
      update credit_accounts
      set credit_remaining_micro_usd = greatest(0, credit_remaining_micro_usd - $3),
          updated_at = now()
      where user_id = $1 and period_key = $2
      returning *
    `,
    [userId, account.period_key, debit],
  );
  await pool.query(
    "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason, request_id, metadata) values ($1, $2, $3, $4, $5, $6, $7)",
    [`led_${crypto.randomUUID()}`, userId, account.period_key, -debit, "ai_usage", requestId, metadata],
  );
  return result.rows[0] ?? account;
}

export async function reserveCredit({ userId, subscription, amountMicroUsd, requestId, metadata = {} }) {
  const account = await ensureCreditAccount(userId, subscription);
  if (!account) throw new Error("Credit account could not be created");
  const reserve = Math.max(0, Math.round(amountMicroUsd));
  if (reserve === 0) return account;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        update credit_accounts
        set credit_remaining_micro_usd = credit_remaining_micro_usd - $3,
            updated_at = now()
        where user_id = $1
          and period_key = $2
          and credit_remaining_micro_usd >= $3
        returning *
      `,
      [userId, account.period_key, reserve],
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason, request_id, metadata) values ($1, $2, $3, $4, $5, $6, $7)",
      [`led_${crypto.randomUUID()}`, userId, account.period_key, -reserve, "ai_usage_reserve", requestId, metadata],
    );
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function settleCreditReservation({ userId, subscription, reservedMicroUsd, actualMicroUsd, requestId, metadata = {} }) {
  const account = await ensureCreditAccount(userId, subscription);
  if (!account) throw new Error("Credit account could not be created");
  const reserved = Math.max(0, Math.round(reservedMicroUsd));
  const actual = Math.max(0, Math.round(actualMicroUsd));
  const delta = reserved - actual;
  if (delta === 0) return account;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        update credit_accounts
        set credit_remaining_micro_usd = greatest(0, least(credit_limit_micro_usd, credit_remaining_micro_usd + $3)),
            updated_at = now()
        where user_id = $1 and period_key = $2
        returning *
      `,
      [userId, account.period_key, delta],
    );
    await client.query(
      "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason, request_id, metadata) values ($1, $2, $3, $4, $5, $6, $7)",
      [
        `led_${crypto.randomUUID()}`,
        userId,
        account.period_key,
        delta,
        delta > 0 ? "ai_usage_refund" : "ai_usage_overage",
        requestId,
        metadata,
      ],
    );
    await client.query("commit");
    return result.rows[0] ?? account;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function refundStaleCreditReservations({ olderThanMinutes = 30, limit = 100 } = {}) {
  const cutoffMinutes = Math.max(1, Math.trunc(Number(olderThanMinutes) || 30));
  const rowLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const stale = await pool.query(
    `
      select
        credit_ledger.user_id,
        credit_ledger.period_key,
        credit_ledger.request_id,
        -credit_ledger.delta_micro_usd as reserved_micro_usd,
        credit_ledger.metadata
      from credit_ledger
      where credit_ledger.reason = 'ai_usage_reserve'
        and credit_ledger.request_id is not null
        and credit_ledger.created_at < now() - ($1 || ' minutes')::interval
        and not exists (
          select 1
          from credit_ledger settled
          where settled.request_id = credit_ledger.request_id
            and settled.reason in ('ai_usage_refund', 'ai_usage_overage')
        )
        and not exists (
          select 1
          from usage_events
          where usage_events.request_id = credit_ledger.request_id
        )
      order by credit_ledger.created_at asc
      limit $2
    `,
    [cutoffMinutes, rowLimit],
  );
  let refunded = 0;
  for (const row of stale.rows) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const stillStale = await client.query(
        `
          select 1
          from credit_ledger reserve
          where reserve.request_id = $1
            and reserve.reason = 'ai_usage_reserve'
            and not exists (
              select 1
              from credit_ledger settled
              where settled.request_id = reserve.request_id
                and settled.reason in ('ai_usage_refund', 'ai_usage_overage')
            )
            and not exists (
              select 1
              from usage_events
              where usage_events.request_id = reserve.request_id
            )
          limit 1
        `,
        [row.request_id],
      );
      if (!stillStale.rows[0]) {
        await client.query("rollback");
        continue;
      }
      const amount = Math.max(1, Math.round(Number(row.reserved_micro_usd ?? 0)));
      await client.query(
        `
          update credit_accounts
          set credit_remaining_micro_usd = greatest(0, least(credit_limit_micro_usd, credit_remaining_micro_usd + $3)),
              updated_at = now()
          where user_id = $1 and period_key = $2
        `,
        [row.user_id, row.period_key, amount],
      );
      await client.query(
        "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason, request_id, metadata) values ($1, $2, $3, $4, $5, $6, $7)",
        [
          `led_${crypto.randomUUID()}`,
          row.user_id,
          row.period_key,
          amount,
          "ai_usage_refund",
          row.request_id,
          {
            ...(row.metadata ?? {}),
            refundReason: "stale_reservation_reaper",
            staleReservation: true,
          },
        ],
      );
      await client.query("commit");
      refunded += 1;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return refunded;
}

export async function markStripeEventProcessing(eventId, type = "") {
  if (!eventId) return true;
  const result = await pool.query(
    `
      insert into stripe_events (id, type, status)
      values ($1, $2, 'processing')
      on conflict (id) do update set
        type = excluded.type,
        status = 'processing',
        created_at = now(),
        processed_at = null
      where stripe_events.status = 'processing'
        and stripe_events.created_at < now() - interval '1 hour'
      returning id
    `,
    [eventId, type],
  );
  return Boolean(result.rows[0]);
}

export async function markStripeEventProcessed(eventId) {
  if (!eventId) return;
  await pool.query(
    "update stripe_events set status = 'processed', processed_at = now() where id = $1",
    [eventId],
  );
}

export async function forgetStripeEvent(eventId) {
  if (!eventId) return;
  await pool.query("delete from stripe_events where id = $1 and status = 'processing'", [eventId]);
}

export async function recordUsageEvent(event) {
  await pool.query(
    `
      insert into usage_events (
        id,
        user_id,
        request_id,
        provider,
        model,
        input_tokens,
        output_tokens,
        estimated_cost_micro_usd,
        credit_spent_micro_usd,
        duration_ms
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      `use_${crypto.randomUUID()}`,
      event.userId,
      event.requestId,
      event.provider,
      event.model,
      event.inputTokens ?? 0,
      event.outputTokens ?? 0,
      event.estimatedCostMicroUsd ?? 0,
      event.creditSpentMicroUsd ?? 0,
      event.durationMs ?? null,
    ],
  );
}

export async function insertProductEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return { inserted: 0, duplicates: 0 };
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("begin");
    for (const event of events) {
      const result = await client.query(
        `
          insert into product_events (
            id, event_id, event_name, source, actor_hash, session_hash, user_id, occurred_at,
            locale, page_group, referrer_host, utm_source, utm_medium, utm_campaign,
            utm_content, utm_term, first_referrer_host, first_utm_source, first_utm_medium,
            first_utm_campaign, first_utm_content, first_utm_term,
            device_class, experiment_id, variant, properties
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26::jsonb
          )
          on conflict (event_id) do nothing
        `,
        [
          `evt_${crypto.randomUUID()}`,
          event.eventId,
          event.eventName,
          event.source ?? "client",
          event.actorHash ?? null,
          event.sessionHash ?? null,
          event.userId ?? null,
          event.occurredAt ?? new Date().toISOString(),
          event.locale ?? "unknown",
          event.pageGroup ?? "unknown",
          event.referrerHost ?? "",
          event.utmSource ?? "",
          event.utmMedium ?? "",
          event.utmCampaign ?? "",
          event.utmContent ?? "",
          event.utmTerm ?? "",
          event.firstReferrerHost ?? "",
          event.firstUtmSource ?? "",
          event.firstUtmMedium ?? "",
          event.firstUtmCampaign ?? "",
          event.firstUtmContent ?? "",
          event.firstUtmTerm ?? "",
          event.deviceClass ?? "unknown",
          event.experimentId ?? "",
          event.variant ?? "",
          JSON.stringify(event.properties ?? {}),
        ],
      );
      inserted += result.rowCount ?? 0;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { inserted, duplicates: events.length - inserted };
}

export async function linkAnalyticsActorToUser(actorHash, userId) {
  if (!actorHash || !userId) return 0;
  const result = await pool.query(
    `
      update product_events
      set user_id = $2
      where actor_hash = $1
        and user_id is null
        and occurred_at >= now() - interval '90 days'
    `,
    [actorHash, userId],
  );
  return result.rowCount ?? 0;
}

export async function recordAnalyticsIngestStats({ accepted = 0, rejected = 0, duplicates = 0 } = {}) {
  await pool.query(
    `
      insert into analytics_ingest_daily (day, accepted, rejected, duplicates)
      values (current_date, $1, $2, $3)
      on conflict (day) do update set
        accepted = analytics_ingest_daily.accepted + excluded.accepted,
        rejected = analytics_ingest_daily.rejected + excluded.rejected,
        duplicates = analytics_ingest_daily.duplicates + excluded.duplicates,
        updated_at = now()
    `,
    [accepted, rejected, duplicates],
  );
}

export async function replaceTrafficDaily(day, rows) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from traffic_daily where day = $1::date", [day]);
    for (const row of rows) {
      await client.query(
        `
          insert into traffic_daily (
            day, page_group, landing_page, referrer_host, utm_source, utm_medium,
            utm_campaign, locale, device_class, pv, unique_visitors, bot_pv,
            error_4xx, error_5xx, response_ms_total, response_count
          ) values ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
        [
          day,
          row.pageGroup,
          row.landingPage,
          row.referrerHost,
          row.utmSource,
          row.utmMedium,
          row.utmCampaign,
          row.locale,
          row.deviceClass,
          row.pv,
          row.uniqueVisitors,
          row.botPv,
          row.error4xx,
          row.error5xx,
          row.responseMsTotal,
          row.responseCount,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return rows.length;
}

export async function cleanupAnalyticsData({ eventDays = 730, trafficDays = 730, snapshotDays = 730 } = {}) {
  const events = await pool.query("delete from product_events where occurred_at < now() - ($1 || ' days')::interval", [eventDays]);
  const traffic = await pool.query("delete from traffic_daily where day < current_date - $1::integer", [trafficDays]);
  const snapshots = await pool.query("delete from analytics_daily_snapshots where day < current_date - $1::integer", [snapshotDays]);
  return {
    productEvents: events.rowCount ?? 0,
    trafficDays: traffic.rowCount ?? 0,
    snapshots: snapshots.rowCount ?? 0,
  };
}

export async function saveAnalyticsSnapshot(day, report) {
  await pool.query(
    `
      insert into analytics_daily_snapshots (day, report)
      values ($1::date, $2::jsonb)
      on conflict (day) do update set report = excluded.report, updated_at = now()
    `,
    [day, JSON.stringify(report)],
  );
}

export async function buildEntitlement(user) {
  if (!user) return { subscription: null, credit: null, entitlement: { aiEnabled: false, reason: "anonymous" } };
  const subscription = await getUserSubscription(user.id);
  if (!isSubscriptionActive(subscription)) {
    return { subscription, credit: null, entitlement: { aiEnabled: false, reason: "subscription_required" } };
  }
  if (!hasSubscriptionBillingPeriod(subscription)) {
    return { subscription, credit: null, entitlement: { aiEnabled: false, reason: "billing_period_unavailable" } };
  }
  const credit = await ensureCreditAccount(user.id, subscription);
  const remaining = Number(credit?.credit_remaining_micro_usd ?? 0);
  return {
    subscription,
    credit,
    entitlement: {
      aiEnabled: remaining > 0,
      reason: remaining > 0 ? "active" : "credit_exhausted",
    },
  };
}

export async function createCloudNotebook({ userId, title, data, sizeBytes, visibility = "private", shareToken = null, quotaBytes }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        insert into cloud_notebooks (id, user_id, visibility, share_token, title, data, size_bytes)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        returning id, user_id, visibility, share_token, title, size_bytes, created_at, updated_at
      `,
      [
        `cld_${crypto.randomUUID()}`,
        userId,
        visibility === "public" ? "public" : "private",
        shareToken || null,
        String(title || "Mind Atlas").slice(0, 240),
        JSON.stringify(data),
        Math.max(0, Math.round(Number(sizeBytes) || 0)),
      ],
    );
    const prunedCount = await pruneCloudNotebookQuota(client, userId, quotaBytes, result.rows[0].id);
    const quota = await getCloudNotebookQuota(client, userId, quotaBytes);
    await client.query("commit");
    return { notebook: result.rows[0], prunedCount, quota };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCloudNotebook({ userId, notebookId, title, data, sizeBytes, quotaBytes }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      "select id from cloud_notebooks where user_id = $1 and id = $2 for update",
      [userId, notebookId],
    );
    if (!existing.rows[0]) {
      await client.query("rollback");
      return null;
    }
    const result = await client.query(
      `
        update cloud_notebooks
        set title = $3,
            data = $4::jsonb,
            size_bytes = $5,
            updated_at = now()
        where user_id = $1 and id = $2
        returning id, user_id, visibility, share_token, title, size_bytes, created_at, updated_at
      `,
      [
        userId,
        notebookId,
        String(title || "Mind Atlas").slice(0, 240),
        JSON.stringify(data),
        Math.max(0, Math.round(Number(sizeBytes) || 0)),
      ],
    );
    const prunedCount = await pruneCloudNotebookQuota(client, userId, quotaBytes, notebookId);
    const quota = await getCloudNotebookQuota(client, userId, quotaBytes);
    await client.query("commit");
    return { notebook: result.rows[0], prunedCount, quota };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function renameCloudNotebook({ userId, notebookId, title, quotaBytes }) {
  const result = await pool.query(
    `
      update cloud_notebooks
      set title = $3,
          updated_at = now()
      where user_id = $1 and id = $2
      returning id, user_id, visibility, share_token, title, size_bytes, created_at, updated_at
    `,
    [userId, notebookId, String(title || "Mind Atlas").slice(0, 240)],
  );
  if (!result.rows[0]) return null;
  return {
    notebook: result.rows[0],
    prunedCount: 0,
    quota: await getCloudNotebookQuota(pool, userId, quotaBytes),
  };
}

export async function deleteCloudNotebook(userId, notebookId, quotaBytes) {
  const result = await pool.query(
    `
      delete from cloud_notebooks
      where user_id = $1 and id = $2
      returning id
    `,
    [userId, notebookId],
  );
  return {
    deleted: Boolean(result.rows[0]),
    quota: await getCloudNotebookQuota(pool, userId, quotaBytes),
  };
}

export async function shareCloudNotebook({ userId, notebookId, shareToken, quotaBytes }) {
  const result = await pool.query(
    `
      update cloud_notebooks
      set visibility = 'public',
          share_token = coalesce(share_token, $3),
          updated_at = now()
      where user_id = $1 and id = $2
      returning id, user_id, visibility, share_token, title, size_bytes, created_at, updated_at
    `,
    [userId, notebookId, shareToken],
  );
  if (!result.rows[0]) return null;
  return {
    notebook: result.rows[0],
    quota: await getCloudNotebookQuota(pool, userId, quotaBytes),
  };
}

export async function listCloudNotebooks(userId, quotaBytes) {
  const result = await pool.query(
    `
      select id, visibility, share_token, title, size_bytes, created_at, updated_at
      from cloud_notebooks
      where user_id = $1
      order by updated_at desc
      limit 100
    `,
    [userId],
  );
  return {
    notebooks: result.rows,
    quota: await getCloudNotebookQuota(pool, userId, quotaBytes),
  };
}

export async function getCloudNotebook(userId, notebookId) {
  const result = await pool.query(
    `
      select id, visibility, share_token, title, data, size_bytes, created_at, updated_at
      from cloud_notebooks
      where user_id = $1 and id = $2
      limit 1
    `,
    [userId, notebookId],
  );
  return result.rows[0] ?? null;
}

export async function getCloudNotebookByShareToken(shareToken) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        update cloud_notebooks
        set last_accessed_at = now()
        where share_token = $1
          and visibility = 'public'
        returning id, user_id, visibility, share_token, title, data, size_bytes, created_at, updated_at
      `,
      [shareToken],
    );
    await client.query("commit");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function pruneCloudNotebookQuota(client, userId, quotaBytes, keepId) {
  const quotaLimit = Math.max(1, Math.round(Number(quotaBytes) || 1));
  const totalResult = await client.query(
    "select coalesce(sum(size_bytes), 0)::bigint as total from cloud_notebooks where user_id = $1",
    [userId],
  );
  let total = Number(totalResult.rows[0]?.total ?? 0);
  if (total <= quotaLimit) return 0;

  const candidates = await client.query(
    `
      select id, size_bytes
      from cloud_notebooks
      where user_id = $1
        and id <> $2
      order by created_at asc
      for update
    `,
    [userId, keepId],
  );
  let prunedCount = 0;
  for (const row of candidates.rows) {
    if (total <= quotaLimit) break;
    await client.query("delete from cloud_notebooks where id = $1 and user_id = $2", [row.id, userId]);
    total -= Number(row.size_bytes ?? 0);
    prunedCount += 1;
  }
  return prunedCount;
}

async function getCloudNotebookQuota(client, userId, quotaBytes) {
  const result = await client.query(
    "select coalesce(sum(size_bytes), 0)::bigint as used_bytes from cloud_notebooks where user_id = $1",
    [userId],
  );
  return {
    usedBytes: Number(result.rows[0]?.used_bytes ?? 0),
    limitBytes: Math.max(1, Math.round(Number(quotaBytes) || 1)),
  };
}

export async function listUsers(limit = 100) {
  const result = await pool.query(
    `
      select
        users.id,
        users.email,
        users.name,
        users.role,
        users.created_at,
        subscriptions.status as subscription_status,
        subscriptions.current_period_start,
        subscriptions.current_period_end,
        credit_accounts.period_key,
        credit_accounts.credit_remaining_micro_usd,
        credit_accounts.credit_limit_micro_usd
      from users
      left join subscriptions on subscriptions.user_id = users.id
      left join lateral (
        select *
        from credit_accounts
        where credit_accounts.user_id = users.id
          and credit_accounts.period_key = to_char(subscriptions.current_period_start at time zone 'UTC', 'YYYY-MM-DD')
        limit 1
      ) credit_accounts on true
      order by users.created_at desc
      limit $1
    `,
    [limit],
  );
  return result.rows;
}

export async function listUsageEvents(email, limit = 30) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const result = await pool.query(
    `
      select
        request_id,
        provider,
        model,
        input_tokens,
        output_tokens,
        estimated_cost_micro_usd,
        credit_spent_micro_usd,
        duration_ms,
        created_at
      from usage_events
      where user_id = $1
      order by created_at desc
      limit $2
    `,
    [user.id, Math.max(1, Math.min(500, Number(limit) || 30))],
  );
  return { user, events: result.rows };
}

export async function findUserByEmail(email) {
  const result = await pool.query("select * from users where lower(email) = lower($1) limit 1", [email]);
  return result.rows[0] ?? null;
}

export async function setUserRole(email, role) {
  const result = await pool.query("update users set role = $2, updated_at = now() where lower(email) = lower($1) returning *", [email, role]);
  return result.rows[0] ?? null;
}

export async function grantCreditPercent(email, percent, reason = "admin_grant") {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const subscription = await getUserSubscription(user.id);
  const account = await ensureCreditAccount(user.id, subscription);
  if (!account) throw new Error("Credit account could not be created because subscription billing period is unavailable");
  const delta = Math.round(MONTHLY_CREDIT_MICRO_USD * (percent / 100));
  const result = await pool.query(
    `
      update credit_accounts
      set credit_remaining_micro_usd = least(credit_limit_micro_usd, credit_remaining_micro_usd + $3),
          updated_at = now()
      where user_id = $1 and period_key = $2
      returning *
    `,
    [user.id, account.period_key, delta],
  );
  await pool.query(
    "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason) values ($1, $2, $3, $4, $5)",
    [`led_${crypto.randomUUID()}`, user.id, account.period_key, delta, reason],
  );
  return { user, account: result.rows[0] };
}

export async function setCreditPercent(email, percent, reason = "admin_set") {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const subscription = await getUserSubscription(user.id);
  const account = await ensureCreditAccount(user.id, subscription);
  if (!account) throw new Error("Credit account could not be created because subscription billing period is unavailable");
  const nextRemaining = Math.round(account.credit_limit_micro_usd * (percent / 100));
  const delta = nextRemaining - Number(account.credit_remaining_micro_usd ?? 0);
  const result = await pool.query(
    `
      update credit_accounts
      set credit_remaining_micro_usd = greatest(0, least(credit_limit_micro_usd, $3)),
          updated_at = now()
      where user_id = $1 and period_key = $2
      returning *
    `,
    [user.id, account.period_key, nextRemaining],
  );
  await pool.query(
    "insert into credit_ledger (id, user_id, period_key, delta_micro_usd, reason) values ($1, $2, $3, $4, $5)",
    [`led_${crypto.randomUUID()}`, user.id, account.period_key, delta, reason],
  );
  return { user, account: result.rows[0] };
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
