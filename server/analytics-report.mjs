import { pool } from "./service-db.mjs";

const MEANINGFUL_EVENTS = ["first_node_created", "meaningful_edit", "cloud_save_completed", "share_link_created", "ai_request_succeeded"];
const FUNNEL_EVENTS = ["landing_view", "app_opened", "first_node_created", "activation_reached", "google_login_completed", "cloud_save_completed"];

export async function buildGrowthReport({ days = 30 } = {}) {
  const normalizedDays = Math.max(1, Math.min(730, Math.round(Number(days) || 30)));
  const [current, previous, northStar, previousNorthStar] = await Promise.all([
    buildPeriod(normalizedDays, 0),
    buildPeriod(normalizedDays, normalizedDays),
    countMeaningfulActiveUsers(7, 0),
    countMeaningfulActiveUsers(7, 7),
  ]);
  current.northStar = { meaningfulActiveUsers: northStar, windowDays: 7 };
  previous.northStar = { meaningfulActiveUsers: previousNorthStar, windowDays: 7 };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    timezone: "UTC",
    days: normalizedDays,
    period: current.period,
    northStar: current.northStar,
    overview: current.overview,
    funnel: current.funnel,
    acquisition: current.acquisition,
    retention: current.retention,
    sharing: current.sharing,
    billing: current.billing,
    aiEconomics: current.aiEconomics,
    dataQuality: current.dataQuality,
    comparison: compareReports(current, previous),
    previousPeriod: {
      start: previous.period.start,
      end: previous.period.end,
      northStar: previous.northStar,
      overview: previous.overview,
    },
    notes: [
      "Rates with a denominator below 20 are marked referenceOnly.",
      "Pre-analytics traffic and activation attribution remain unknown instead of being inferred.",
      "Revenue is subscription MRR; Stripe fees and tax are not deducted.",
      "Cookieless period UU is the sum of privacy-preserving daily approximate UU and should be read as visitor-days.",
    ],
  };
}

async function countMeaningfulActiveUsers(days, offsetDays) {
  const result = await pool.query(
    `select count(distinct coalesce(product_events.user_id, product_events.actor_hash, product_events.session_hash))::int as users
     from product_events
     where occurred_at >= current_date - ($2::integer + $1::integer - 1)
       and occurred_at < current_date - $2::integer + interval '1 day'
       and event_name = any($3::text[])
       and not exists (select 1 from users u where u.id=product_events.user_id and u.role='admin')`,
    [days, offsetDays, MEANINGFUL_EVENTS],
  );
  return Number(result.rows[0]?.users ?? 0);
}

async function buildPeriod(days, offsetDays) {
  const params = [days, offsetDays];
  const period = (await pool.query(
    `select
       (current_date - ($2::integer + $1::integer - 1))::date as start,
       (current_date - $2::integer)::date as end`,
    params,
  )).rows[0];
  const rangeSql = "occurred_at >= current_date - ($2::integer + $1::integer - 1) and occurred_at < current_date - $2::integer + interval '1 day'";
  const trafficRangeSql = "day >= current_date - ($2::integer + $1::integer - 1) and day <= current_date - $2::integer";
  const nonAdminSql = "not exists (select 1 from users analytics_user where analytics_user.id = product_events.user_id and analytics_user.role = 'admin')";
  const actorSql = "coalesce(product_events.user_id, product_events.actor_hash, product_events.session_hash)";

  const [traffic, trafficSegments, northStar, funnelRows, acquisitionRows, lastTouchRows, retention, sharing, billing, ai, quality, ingestQuality] = await Promise.all([
    pool.query(
      `select coalesce(sum(pv),0)::int as pv, coalesce(sum(unique_visitors),0)::int as uu,
              coalesce(sum(error_4xx),0)::int as error_4xx, coalesce(sum(error_5xx),0)::int as error_5xx,
              coalesce(sum(bot_pv),0)::int as bot_pv
       from traffic_daily where ${trafficRangeSql} and page_group = '__all__'`,
      params,
    ),
    buildTrafficSegments(days, offsetDays),
    pool.query(
      `select count(distinct ${actorSql})::int as users
       from product_events
       where ${rangeSql} and ${nonAdminSql}
         and event_name = any($3::text[])`,
      [...params, MEANINGFUL_EVENTS],
    ),
    pool.query(
      `select event_name, count(distinct ${actorSql})::int as actors
       from product_events
       where ${rangeSql} and ${nonAdminSql} and event_name = any($3::text[])
       group by event_name`,
      [...params, FUNNEL_EVENTS],
    ),
    pool.query(
      `select coalesce(nullif(first_utm_source,''), nullif(first_referrer_host,''), 'direct/unknown') as source,
              count(distinct ${actorSql})::int as actors
       from product_events
       where ${rangeSql} and ${nonAdminSql} and event_name in ('landing_view','app_opened')
       group by 1 order by actors desc limit 20`,
      params,
    ),
    pool.query(
      `select coalesce(nullif(utm_source,''), nullif(referrer_host,''), 'direct/unknown') as source,
              count(distinct ${actorSql})::int as actors
       from product_events
       where ${rangeSql} and ${nonAdminSql} and event_name in ('landing_view','app_opened')
       group by 1 order by actors desc limit 20`,
      params,
    ),
    buildRetention(days, offsetDays),
    buildSharing(days, offsetDays),
    buildBilling(days, offsetDays),
    buildAiEconomics(days, offsetDays),
    pool.query(
      `select
         count(*) filter (where source = 'client')::int as client_events,
         count(distinct actor_hash) filter (where actor_hash is not null)::int as consent_actors,
         count(*) filter (where page_group = 'other' or locale = 'unknown')::int as incomplete_events,
         count(*) filter (where event_name = 'ai_request_started')::int as ai_started,
         count(*) filter (where event_name in ('ai_request_succeeded','ai_request_failed'))::int as ai_finished
       from product_events
       where ${rangeSql} and ${nonAdminSql}`,
      params,
    ),
    pool.query(
      `select coalesce(sum(accepted),0)::int as accepted, coalesce(sum(rejected),0)::int as rejected,
              coalesce(sum(duplicates),0)::int as duplicates
       from analytics_ingest_daily
       where day >= current_date - ($2::integer + $1::integer - 1) and day <= current_date - $2::integer`,
      params,
    ),
  ]);

  const trafficRow = traffic.rows[0];
  const funnelMap = new Map(funnelRows.rows.map((row) => [row.event_name, Number(row.actors)]));
  const funnel = FUNNEL_EVENTS.map((eventName, index) => {
    const actors = funnelMap.get(eventName) ?? 0;
    const previousActors = index === 0 ? null : funnelMap.get(FUNNEL_EVENTS[index - 1]) ?? 0;
    return {
      event: eventName,
      actors,
      fromPrevious: previousActors === null ? null : rate(actors, previousActors),
    };
  });
  const estimatedUu = Number(trafficRow.uu ?? 0);
  const consentActors = Number(quality.rows[0]?.consent_actors ?? 0);
  billing.activationToPro = rate(billing.newSubscriptions, funnelMap.get("activation_reached") ?? 0);
  ai.costToMrr = rate(ai.estimatedCostMicroUsd, billing.mrr.amountMinor * 10_000);
  const attributedActors = acquisitionRows.rows.reduce((sum, row) => sum + Number(row.actors ?? 0), 0);
  const unknownActors = acquisitionRows.rows
    .filter((row) => row.source === "direct/unknown")
    .reduce((sum, row) => sum + Number(row.actors ?? 0), 0);
  return {
    period: { start: dateOnly(period.start), end: dateOnly(period.end) },
    northStar: { meaningfulActiveUsers: Number(northStar.rows[0]?.users ?? 0), windowDays: days },
    overview: {
      humanPageViews: Number(trafficRow.pv ?? 0),
      estimatedUniqueVisitors: estimatedUu,
      googleUsersCreated: await countUsersCreated(days, offsetDays),
      cloudFilesCreated: await countCloudFilesCreated(days, offsetDays),
      meaningfulActiveUsers: Number(northStar.rows[0]?.users ?? 0),
    },
    funnel,
    acquisition: {
      sources: acquisitionRows.rows.map((row) => ({ source: row.source, actors: Number(row.actors) })),
      firstTouchSources: acquisitionRows.rows.map((row) => ({ source: row.source, actors: Number(row.actors) })),
      lastTouchSources: lastTouchRows.rows.map((row) => ({ source: row.source, actors: Number(row.actors) })),
      cookieless: trafficSegments,
    },
    retention,
    sharing,
    billing,
    aiEconomics: ai,
    dataQuality: {
      botRatio: rate(Number(trafficRow.bot_pv ?? 0), Number(trafficRow.pv ?? 0) + Number(trafficRow.bot_pv ?? 0)),
      analyticsConsentRate: rate(consentActors, estimatedUu),
      consentActors,
      clientEvents: Number(quality.rows[0]?.client_events ?? 0),
      incompleteEvents: Number(quality.rows[0]?.incomplete_events ?? 0),
      acceptedEvents: Number(ingestQuality.rows[0]?.accepted ?? 0),
      rejectedEvents: Number(ingestQuality.rows[0]?.rejected ?? 0),
      duplicateEvents: Number(ingestQuality.rows[0]?.duplicates ?? 0),
      missingEvents: Math.max(0, Number(quality.rows[0]?.ai_started ?? 0) - Number(quality.rows[0]?.ai_finished ?? 0)),
      unknownAttributionRate: rate(unknownActors, attributedActors),
      http4xx: Number(trafficRow.error_4xx ?? 0),
      http5xx: Number(trafficRow.error_5xx ?? 0),
    },
  };
}

async function countUsersCreated(days, offsetDays) {
  const result = await pool.query(
    `select count(*)::int as count from users
     where role <> 'admin'
       and created_at >= current_date - ($2::integer + $1::integer - 1)
       and created_at < current_date - $2::integer + interval '1 day'`,
    [days, offsetDays],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countCloudFilesCreated(days, offsetDays) {
  const result = await pool.query(
    `select count(*)::int as count from cloud_notebooks join users on users.id=cloud_notebooks.user_id
     where users.role <> 'admin'
       and cloud_notebooks.created_at >= current_date - ($2::integer + $1::integer - 1)
       and cloud_notebooks.created_at < current_date - $2::integer + interval '1 day'`,
    [days, offsetDays],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function buildTrafficSegments(days, offsetDays) {
  const range = "day >= current_date - ($2::integer + $1::integer - 1) and day <= current_date - $2::integer and page_group <> '__all__'";
  const [landing, language, device, referrer] = await Promise.all([
    pool.query(`select landing_page as key, sum(unique_visitors)::int as visitors from traffic_daily where ${range} group by 1 order by visitors desc limit 20`, [days, offsetDays]),
    pool.query(`select locale as key, sum(unique_visitors)::int as visitors from traffic_daily where ${range} group by 1 order by visitors desc limit 20`, [days, offsetDays]),
    pool.query(`select device_class as key, sum(unique_visitors)::int as visitors from traffic_daily where ${range} group by 1 order by visitors desc limit 20`, [days, offsetDays]),
    pool.query(`select coalesce(nullif(utm_source,''), nullif(referrer_host,''), 'direct/unknown') as key, sum(unique_visitors)::int as visitors from traffic_daily where ${range} group by 1 order by visitors desc limit 20`, [days, offsetDays]),
  ]);
  const rows = (result) => result.rows.map((row) => ({ key: row.key, estimatedUniqueVisitorDays: Number(row.visitors) }));
  return { landingPages: rows(landing), languages: rows(language), devices: rows(device), sources: rows(referrer) };
}

async function buildRetention(days, offsetDays) {
  const result = await pool.query(
    `with activated as (
       select coalesce(user_id, actor_hash, session_hash) as actor, min(occurred_at) as activated_at
       from product_events
       where event_name = 'activation_reached'
         and occurred_at >= current_date - ($2::integer + $1::integer - 1)
         and occurred_at < current_date - $2::integer + interval '1 day'
         and not exists (select 1 from users u where u.id = product_events.user_id and u.role = 'admin')
       group by 1
     ), activity as (
       select coalesce(user_id, actor_hash, session_hash) as actor, occurred_at
       from product_events where event_name = any($3::text[])
     )
     select count(*)::int as cohort,
       count(*) filter (where exists (select 1 from activity x where x.actor = activated.actor and x.occurred_at >= activated_at + interval '1 day' and x.occurred_at < activated_at + interval '2 day'))::int as d1,
       count(*) filter (where exists (select 1 from activity x where x.actor = activated.actor and x.occurred_at >= activated_at + interval '7 day' and x.occurred_at < activated_at + interval '8 day'))::int as d7,
       count(*) filter (where exists (select 1 from activity x where x.actor = activated.actor and x.occurred_at >= activated_at + interval '30 day' and x.occurred_at < activated_at + interval '31 day'))::int as d30,
       count(*) filter (where exists (select 1 from activity x where x.actor = activated.actor and x.occurred_at >= activated_at + interval '1 day' and x.occurred_at < activated_at + interval '8 day'))::int as rolling7,
       count(*) filter (where exists (select 1 from activity x where x.actor = activated.actor and x.occurred_at >= activated_at + interval '1 day' and x.occurred_at < activated_at + interval '31 day'))::int as rolling30
     from activated`,
    [days, offsetDays, MEANINGFUL_EVENTS],
  );
  const row = result.rows[0] ?? {};
  const cohort = Number(row.cohort ?? 0);
  return {
    cohort,
    d1: countAndRate(row.d1, cohort),
    d7: countAndRate(row.d7, cohort),
    d30: countAndRate(row.d30, cohort),
    rolling7: countAndRate(row.rolling7, cohort),
    rolling30: countAndRate(row.rolling30, cohort),
  };
}

async function buildSharing(days, offsetDays) {
  const result = await pool.query(
    `with period_events as (
       select *, coalesce(user_id, actor_hash, session_hash) as actor
       from product_events
       where occurred_at >= current_date - ($2::integer + $1::integer - 1)
         and occurred_at < current_date - $2::integer + interval '1 day'
         and not exists (select 1 from users u where u.id = product_events.user_id and u.role='admin')
     ), imports as (
       select actor, min(occurred_at) as imported_at from period_events where event_name='shared_atlas_imported' group by actor
     )
     select
       count(*) filter (where event_name='share_link_created')::int as shares,
       count(*) filter (where event_name='share_link_opened')::int as opens,
       count(distinct actor) filter (where event_name='share_link_opened')::int as viewers,
       count(*) filter (where event_name='shared_atlas_imported')::int as imports,
       count(distinct actor) filter (where event_name = any($3::text[]))::int as active_users,
       (select count(*)::int from imports where exists (
          select 1 from period_events activated
          where activated.actor=imports.actor and activated.event_name='activation_reached' and activated.occurred_at >= imports.imported_at
       )) as imported_activated
     from period_events`,
    [days, offsetDays, MEANINGFUL_EVENTS],
  );
  const row = result.rows[0] ?? {};
  const shares = Number(row.shares ?? 0);
  const opens = Number(row.opens ?? 0);
  const viewers = Number(row.viewers ?? 0);
  const imports = Number(row.imports ?? 0);
  const activeUsers = Number(row.active_users ?? 0);
  return {
    shares,
    opens,
    viewers,
    imports,
    sharesPerActiveUser: rate(shares, activeUsers),
    viewersPerShare: rate(viewers, shares),
    openToImport: rate(imports, opens),
    importToActivation: rate(Number(row.imported_activated ?? 0), imports),
  };
}

async function buildBilling(days, offsetDays) {
  const [events, active] = await Promise.all([
    pool.query(
      `select event_name, count(*)::int as count
       from product_events
       where occurred_at >= current_date - ($2::integer + $1::integer - 1)
         and occurred_at < current_date - $2::integer + interval '1 day'
         and event_name = any($3::text[])
       group by event_name`,
      [days, offsetDays, ["checkout_started", "checkout_completed", "subscription_activated", "subscription_cancelled", "invoice_paid", "payment_failed"]],
    ),
    pool.query(
      `select count(*)::int as active,
              coalesce(sum(case when billing_interval='year' then coalesce(unit_amount_minor,12000)/12.0 else coalesce(unit_amount_minor,1000) end),0)::numeric as mrr_minor
       from subscriptions join users on users.id=subscriptions.user_id
       where subscriptions.status='active' and users.role <> 'admin'`,
    ),
  ]);
  const map = new Map(events.rows.map((row) => [row.event_name, Number(row.count)]));
  const starts = map.get("checkout_started") ?? 0;
  const completed = map.get("checkout_completed") ?? 0;
  return {
    checkoutStarted: starts,
    checkoutCompleted: completed,
    checkoutConversion: rate(completed, starts),
    activeSubscriptions: Number(active.rows[0]?.active ?? 0),
    newSubscriptions: map.get("subscription_activated") ?? 0,
    cancellations: map.get("subscription_cancelled") ?? 0,
    invoicesPaid: map.get("invoice_paid") ?? 0,
    paymentFailures: map.get("payment_failed") ?? 0,
    mrr: { amountMinor: Math.round(Number(active.rows[0]?.mrr_minor ?? 0)), currency: "usd" },
  };
}

async function buildAiEconomics(days, offsetDays) {
  const [usage, failures, users] = await Promise.all([
    pool.query(
      `select provider, model, count(*)::int as requests, count(distinct user_id)::int as users,
              coalesce(sum(estimated_cost_micro_usd),0)::bigint as cost_micro_usd,
              percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
              percentile_cont(0.95) within group (order by duration_ms) as p95_ms
       from usage_events join users on users.id=usage_events.user_id
       where usage_events.created_at >= current_date - ($2::integer + $1::integer - 1)
         and usage_events.created_at < current_date - $2::integer + interval '1 day'
         and users.role <> 'admin'
       group by provider, model order by requests desc`,
      [days, offsetDays],
    ),
    pool.query(
      `select count(*)::int as failures from product_events
       where event_name='ai_request_failed'
         and occurred_at >= current_date - ($2::integer + $1::integer - 1)
         and occurred_at < current_date - $2::integer + interval '1 day'`,
      [days, offsetDays],
    ),
    pool.query(
      `select count(distinct usage_events.user_id)::int as users
       from usage_events join users on users.id=usage_events.user_id
       where usage_events.created_at >= current_date - ($2::integer + $1::integer - 1)
         and usage_events.created_at < current_date - $2::integer + interval '1 day'
         and users.role <> 'admin'`,
      [days, offsetDays],
    ),
  ]);
  const models = usage.rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    requests: Number(row.requests),
    users: Number(row.users),
    costMicroUsd: Number(row.cost_micro_usd),
    p50Ms: Math.round(Number(row.p50_ms ?? 0)),
    p95Ms: Math.round(Number(row.p95_ms ?? 0)),
  }));
  const succeeded = models.reduce((sum, row) => sum + row.requests, 0);
  const failed = Number(failures.rows[0]?.failures ?? 0);
  return {
    users: Number(users.rows[0]?.users ?? 0),
    succeeded,
    failed,
    successRate: rate(succeeded, succeeded + failed),
    estimatedCostMicroUsd: models.reduce((sum, row) => sum + row.costMicroUsd, 0),
    models,
  };
}

function compareReports(current, previous) {
  return {
    meaningfulActiveUsers: delta(current.northStar.meaningfulActiveUsers, previous.northStar.meaningfulActiveUsers),
    humanPageViews: delta(current.overview.humanPageViews, previous.overview.humanPageViews),
    estimatedUniqueVisitors: delta(current.overview.estimatedUniqueVisitors, previous.overview.estimatedUniqueVisitors),
    googleUsersCreated: delta(current.overview.googleUsersCreated, previous.overview.googleUsersCreated),
    cloudFilesCreated: delta(current.overview.cloudFilesCreated, previous.overview.cloudFilesCreated),
    activeSubscriptions: delta(current.billing.activeSubscriptions, previous.billing.activeSubscriptions),
    estimatedAiCostMicroUsd: delta(current.aiEconomics.estimatedCostMicroUsd, previous.aiEconomics.estimatedCostMicroUsd),
  };
}

function rate(numerator, denominator) {
  const n = Number(numerator ?? 0);
  const d = Number(denominator ?? 0);
  return { numerator: n, denominator: d, value: d > 0 ? n / d : null, referenceOnly: d < 20 };
}

function countAndRate(value, cohort) {
  const count = Number(value ?? 0);
  return { count, ...rate(count, cohort) };
}

function delta(current, previous) {
  const currentValue = Number(current ?? 0);
  const previousValue = Number(previous ?? 0);
  return {
    current: currentValue,
    previous: previousValue,
    absolute: currentValue - previousValue,
    percent: previousValue > 0 ? (currentValue - previousValue) / previousValue : null,
  };
}

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}
