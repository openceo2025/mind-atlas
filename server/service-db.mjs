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
      email text unique not null,
      name text not null default '',
      picture_url text not null default '',
      role text not null default 'user',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists sessions (
      id_hash text primary key,
      user_id text not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create index if not exists sessions_user_id_idx on sessions(user_id);
    create index if not exists sessions_expires_at_idx on sessions(expires_at);

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
      returning id, google_sub, email, name, picture_url, role, created_at, updated_at
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

export async function getSessionUser(token) {
  if (!token) return null;
  const result = await pool.query(
    `
      select
        users.id,
        users.google_sub,
        users.email,
        users.name,
        users.picture_url,
        users.role,
        users.created_at,
        users.updated_at
      from sessions
      join users on users.id = sessions.user_id
      where sessions.id_hash = $1 and sessions.expires_at > now()
      limit 1
    `,
    [hashSessionToken(token)],
  );
  return result.rows[0] ?? null;
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
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, now())
      on conflict (user_id) do update set
        stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
        status = excluded.status,
        price_id = coalesce(nullif(excluded.price_id, ''), subscriptions.price_id),
        current_period_start = coalesce(excluded.current_period_start, subscriptions.current_period_start),
        current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
        cancel_at_period_end = excluded.cancel_at_period_end,
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
  return subscription?.status === "active" || subscription?.status === "trialing";
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
