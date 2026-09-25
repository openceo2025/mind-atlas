// MindAtlas 空間UI（beta）のサーバー側 API。
//
// Mode: hosted-only（公開サービス）。既存の users / sessions / subscriptions / credits を
// そのまま使い、この機能のためのテーブルを「追加するだけ」にする。既存テーブルは変更しない。
//
//   GET    /api/spaces                 自分のスペース一覧
//   POST   /api/spaces                 新規保存 { space }
//   GET    /api/spaces/:id             読み込み
//   PUT    /api/spaces/:id             上書き保存 { space }
//   DELETE /api/spaces/:id             削除
//   POST   /api/spaces/:id/share       共有リンクの発行・停止 { enabled }
//   GET    /api/public/spaces/:token   共有スペース（読み取り専用）
//   POST   /api/embeddings             文章 → 埋め込みベクトル（未ログインでも回数制限つきで利用可）
//   GET    /s/:token                   共有リンクのページ（SPA の index.html を返す）
import crypto from "node:crypto";
import { pool } from "./service-db.mjs";
import { getEnv, readIntEnv } from "./service-config.mjs";

const SPACE_MAX_BYTES = readIntEnv("MIND_ATLAS_SPATIAL_SPACE_MAX_BYTES", 8 * 1024 * 1024);
const USER_MAX_BYTES = readIntEnv("MIND_ATLAS_SPATIAL_USER_MAX_BYTES", 80 * 1024 * 1024);
const SPACE_MAX_CARDS = readIntEnv("MIND_ATLAS_SPATIAL_SPACE_MAX_CARDS", 4000);
const USER_MAX_SPACES = readIntEnv("MIND_ATLAS_SPATIAL_USER_MAX_SPACES", 200);
const EMBEDDING_MODEL = getEnv("MIND_ATLAS_EMBEDDING_MODEL", "text-embedding-3-small");
const EMBEDDING_DIMS = readIntEnv("MIND_ATLAS_EMBEDDING_DIMS", 256);
const EMBEDDING_MAX_TEXTS = 64;
const EMBEDDING_MAX_CHARS = 1200;
const EMBEDDING_ANON_PER_MIN = readIntEnv("MIND_ATLAS_EMBEDDING_ANON_PER_MIN", 30);
const EMBEDDING_USER_PER_MIN = readIntEnv("MIND_ATLAS_EMBEDDING_USER_PER_MIN", 120);
const EMBEDDING_CACHE_DAYS = readIntEnv("MIND_ATLAS_EMBEDDING_CACHE_DAYS", 120);

export async function migrateSpatialDatabase() {
  await pool.query(`
    create table if not exists spatial_spaces (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null default '',
      data jsonb not null,
      size_bytes integer not null,
      card_count integer not null default 0,
      share_token text unique,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists spatial_spaces_user_updated_idx on spatial_spaces(user_id, updated_at desc);
    create index if not exists spatial_spaces_share_token_idx on spatial_spaces(share_token) where share_token is not null;

    create table if not exists spatial_embeddings (
      key text primary key,
      model text not null,
      dims integer not null,
      vector bytea not null,
      created_at timestamptz not null default now(),
      last_used_at timestamptz not null default now()
    );
  `);
}

/**
 * @param {object} deps 既存サービスの部品（認証・レート制限・応答・静的配信）
 */
export function createSpatialRoutes(deps) {
  const {
    ServiceError,
    authenticate,
    requireUser,
    readRawBody,
    sendJson,
    consumeRateLimit,
    requestClientIp,
    serveStatic,
    publicOrigin,
    openAiApiKey,
    openAiBaseUrl,
    mockProviders,
  } = deps;

  async function readBody(request, maxBytes) {
    const raw = await readRawBody(request, maxBytes);
    try {
      return raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      throw new ServiceError(400, "Invalid JSON");
    }
  }

  async function handle(request, response, url) {
    const { pathname } = url;
    const method = request.method;

    if (method === "GET" && /^\/s\/[A-Za-z0-9_-]{8,}\/?$/.test(pathname)) {
      await serveStatic(response, method, "/index.html");
      return true;
    }

    if (method === "POST" && pathname === "/api/embeddings") {
      await handleEmbeddings(request, response);
      return true;
    }

    if (method === "GET" && pathname.startsWith("/api/public/spaces/")) {
      const token = decodeURIComponent(pathname.slice("/api/public/spaces/".length));
      if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) throw new ServiceError(404, "not_found", "Not found");
      const { rows } = await pool.query("select title, data from spatial_spaces where share_token = $1", [token]);
      if (!rows[0]) throw new ServiceError(404, "not_found", "Not found");
      sendJson(response, 200, { title: rows[0].title, space: rows[0].data });
      return true;
    }

    if (!pathname.startsWith("/api/spaces")) return false;

    const user = await requireUser(request);
    const rest = pathname.slice("/api/spaces".length).replace(/^\/+/, "");
    const [idPart, action] = rest.split("/");
    const id = idPart ? decodeURIComponent(idPart) : "";

    if (!id) {
      if (method === "GET") {
        const { rows } = await pool.query(
          "select id, title, card_count, size_bytes, share_token, updated_at from spatial_spaces where user_id = $1 order by updated_at desc",
          [user.id],
        );
        const used = rows.reduce((s, r) => s + Number(r.size_bytes), 0);
        sendJson(response, 200, { spaces: rows.map(entryOf), usedBytes: used, limitBytes: USER_MAX_BYTES });
        return true;
      }
      if (method === "POST") {
        const body = await readBody(request, SPACE_MAX_BYTES + 64 * 1024);
        const space = sanitizeSpace(body.space);
        const json = JSON.stringify(space);
        const size = Buffer.byteLength(json);
        await assertQuota(user.id, size, "");
        const count = await pool.query("select count(*)::int as n from spatial_spaces where user_id = $1", [user.id]);
        if (count.rows[0].n >= USER_MAX_SPACES) throw new ServiceError(413, "space_too_large", "Too many spaces");
        const newId = `sp_${crypto.randomUUID()}`;
        const { rows } = await pool.query(
          `insert into spatial_spaces (id, user_id, title, data, size_bytes, card_count)
           values ($1, $2, $3, $4::jsonb, $5, $6)
           returning id, title, card_count, size_bytes, share_token, updated_at`,
          [newId, user.id, space.title, json, size, cardCount(space)],
        );
        sendJson(response, 200, { entry: entryOf(rows[0]) });
        return true;
      }
      throw new ServiceError(405, "method_not_allowed", "Method not allowed");
    }

    if (!/^sp_[0-9a-f-]{36}$/.test(id)) throw new ServiceError(404, "not_found", "Not found");

    if (action === "share" && method === "POST") {
      const body = await readBody(request, 4096);
      const enabled = body.enabled !== false;
      const token = enabled ? crypto.randomBytes(18).toString("base64url") : null;
      const { rows } = await pool.query(
        `update spatial_spaces set share_token = case when $3::boolean then coalesce(share_token, $4) else null end
         where id = $1 and user_id = $2 returning share_token`,
        [id, user.id, enabled, token],
      );
      if (!rows[0]) throw new ServiceError(404, "not_found", "Not found");
      const shareToken = rows[0].share_token;
      sendJson(response, 200, { shareToken, url: shareToken ? `${publicOrigin}/s/${shareToken}` : null });
      return true;
    }

    if (action) throw new ServiceError(404, "not_found", "Not found");

    if (method === "GET") {
      const { rows } = await pool.query(
        "select id, title, data, card_count, size_bytes, share_token, updated_at from spatial_spaces where id = $1 and user_id = $2",
        [id, user.id],
      );
      if (!rows[0]) throw new ServiceError(404, "not_found", "Not found");
      sendJson(response, 200, { space: rows[0].data, entry: entryOf(rows[0]) });
      return true;
    }

    if (method === "PUT") {
      const body = await readBody(request, SPACE_MAX_BYTES + 64 * 1024);
      const space = sanitizeSpace(body.space);
      const json = JSON.stringify(space);
      const size = Buffer.byteLength(json);
      await assertQuota(user.id, size, id);
      const { rows } = await pool.query(
        `update spatial_spaces set title = $3, data = $4::jsonb, size_bytes = $5, card_count = $6, updated_at = now()
         where id = $1 and user_id = $2
         returning id, title, card_count, size_bytes, share_token, updated_at`,
        [id, user.id, space.title, json, size, cardCount(space)],
      );
      if (!rows[0]) throw new ServiceError(404, "not_found", "Not found");
      sendJson(response, 200, { entry: entryOf(rows[0]) });
      return true;
    }

    if (method === "DELETE") {
      await pool.query("delete from spatial_spaces where id = $1 and user_id = $2", [id, user.id]);
      sendJson(response, 200, { ok: true });
      return true;
    }

    throw new ServiceError(405, "method_not_allowed", "Method not allowed");
  }

  async function assertQuota(userId, size, exceptId) {
    if (size > SPACE_MAX_BYTES) throw new ServiceError(413, "space_too_large", "Space is too large");
    const { rows } = await pool.query(
      "select coalesce(sum(size_bytes), 0)::bigint as used from spatial_spaces where user_id = $1 and id <> $2",
      [userId, exceptId],
    );
    if (Number(rows[0].used) + size > USER_MAX_BYTES) throw new ServiceError(413, "space_too_large", "Storage quota exceeded");
  }

  function sanitizeSpace(raw) {
    if (!raw || typeof raw !== "object" || !raw.cards || typeof raw.cards !== "object") {
      throw new ServiceError(400, "Invalid space");
    }
    const cards = {};
    let n = 0;
    for (const [key, card] of Object.entries(raw.cards)) {
      if (!card || typeof card !== "object" || typeof card.title !== "string") continue;
      if (++n > SPACE_MAX_CARDS) throw new ServiceError(413, "space_too_large", "Too many cards");
      const c = { ...card, id: String(key).slice(0, 80), title: card.title.slice(0, 500) };
      if (typeof c.body === "string") c.body = c.body.slice(0, 40000);
      // 表示時に安全なものだけを残す：リンクは http(s)、画像は data:image の base64
      if (c.url !== undefined && !(typeof c.url === "string" && /^https?:\/\//i.test(c.url) && c.url.length < 2000)) delete c.url;
      if (c.image !== undefined && !(typeof c.image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(c.image))) delete c.image;
      cards[c.id] = c;
    }
    return {
      schema: "mindatlas.space/1",
      id: typeof raw.id === "string" ? raw.id.slice(0, 80) : "",
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : "Untitled",
      description: typeof raw.description === "string" ? raw.description.slice(0, 4000) : "",
      cards,
      relations: Array.isArray(raw.relations) ? raw.relations.filter((r) => r && cards[r.from] && cards[r.to]).slice(0, 20000) : [],
      axes: raw.axes && typeof raw.axes === "object" ? { x: String(raw.axes.x ?? ""), y: String(raw.axes.y ?? ""), z: String(raw.axes.z ?? "") } : { x: "", y: "", z: "" },
      trail: Array.isArray(raw.trail) ? raw.trail.slice(-16) : [],
      // 線に使う言葉のセットと、ユーザーが作った言葉（文字だけ。表示は textContent で行う）
      ...(["think", "cause", "logic"].includes(raw.vocabulary) ? { vocabulary: raw.vocabulary } : {}),
      ...(Array.isArray(raw.relationWords)
        ? {
            relationWords: raw.relationWords
              .filter((w) => w && typeof w.id === "string" && w.id.startsWith("u:") && typeof w.label === "string")
              .slice(0, 12)
              .map((w) => ({
                id: w.id.slice(0, 40),
                label: w.label.slice(0, 24),
                ...(typeof w.back === "string" ? { back: w.back.slice(0, 24) } : {}),
                meaning: typeof w.meaning === "string" ? w.meaning.slice(0, 200) : "",
                directed: Boolean(w.directed),
                color: typeof w.color === "string" && /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : "#9fb4d8",
              })),
          }
        : {}),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
  }

  // ── 埋め込み ─────────────────────────────────────────
  async function handleEmbeddings(request, response) {
    const user = await authenticate(request);
    const actor = user ? `user:${user.id}` : `ip:${requestClientIp(request)}`;
    consumeRateLimit(`embeddings:${actor}`, user ? EMBEDDING_USER_PER_MIN : EMBEDDING_ANON_PER_MIN, 60_000);
    const body = await readBody(request, 256 * 1024);
    const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, EMBEDDING_MAX_CHARS)) : [];
    if (!texts.length || texts.length > EMBEDDING_MAX_TEXTS || texts.some((t) => !t)) throw new ServiceError(400, "texts must be 1-64 non-empty strings");

    const keys = texts.map((t) => crypto.createHash("sha256").update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}:${t}`).digest("hex"));
    const vectors = new Array(texts.length);
    const { rows } = await pool.query("select key, vector from spatial_embeddings where key = any($1::text[])", [keys]);
    const cached = new Map(rows.map((r) => [r.key, r.vector]));
    const missing = [];
    keys.forEach((k, i) => {
      const hit = cached.get(k);
      if (hit) vectors[i] = Buffer.from(hit).toString("base64");
      else missing.push(i);
    });
    if (cached.size) void pool.query("update spatial_embeddings set last_used_at = now() where key = any($1::text[])", [[...cached.keys()]]).catch(() => undefined);
    pruneEmbeddingCache();

    if (missing.length) {
      const fresh = await embed(missing.map((i) => texts[i]));
      const values = [];
      const params = [];
      missing.forEach((i, j) => {
        vectors[i] = fresh[j];
        params.push(keys[i], EMBEDDING_MODEL, EMBEDDING_DIMS, Buffer.from(fresh[j], "base64"));
        const b = j * 4;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      });
      await pool.query(`insert into spatial_embeddings (key, model, dims, vector) values ${values.join(", ")} on conflict (key) do nothing`, params);
    }
    sendJson(response, 200, { model: `${EMBEDDING_MODEL}@${EMBEDDING_DIMS}`, dims: EMBEDDING_DIMS, vectors });
  }

  // 長く使われていないキャッシュは 1 日 1 回まとめて捨てる（再計算すれば戻る）
  let lastPruneAt = 0;
  function pruneEmbeddingCache() {
    if (Date.now() - lastPruneAt < 24 * 60 * 60 * 1000) return;
    lastPruneAt = Date.now();
    void pool
      .query("delete from spatial_embeddings where last_used_at < now() - make_interval(days => $1)", [EMBEDDING_CACHE_DAYS])
      .catch((error) => console.error("embedding cache prune failed", error instanceof Error ? error.message : error));
  }

  async function embed(texts) {
    if (mockProviders) return texts.map((t) => mockVector(t));
    if (!openAiApiKey) throw new ServiceError(503, "service_not_configured", "Embeddings are not configured");
    const upstream = await fetch(`${openAiBaseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMS, encoding_format: "base64" }),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      console.error("embedding upstream failed", upstream.status, text.slice(0, 300));
      throw new ServiceError(502, "provider_unavailable", "Embedding provider failed");
    }
    const data = JSON.parse(text);
    const items = Array.isArray(data.data) ? [...data.data].sort((a, b) => a.index - b.index) : [];
    if (items.length !== texts.length) throw new ServiceError(502, "provider_unavailable", "Embedding provider returned a wrong count");
    return items.map((item) => (typeof item.embedding === "string" ? item.embedding : Buffer.from(new Float32Array(item.embedding).buffer).toString("base64")));
  }

  return { handle };
}

function entryOf(row) {
  return {
    id: row.id,
    title: row.title,
    cardCount: Number(row.card_count ?? 0),
    sizeBytes: Number(row.size_bytes ?? 0),
    shareToken: row.share_token ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at),
  };
}

function cardCount(space) {
  return Object.values(space.cards).filter((c) => c.kind !== "concept").length;
}

/** ステージングの擬似プロバイダ用：文字 n-gram から決定的に作るベクトル */
function mockVector(text) {
  const v = new Float32Array(EMBEDDING_DIMS);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    for (let n = 1; n <= 3 && i + n <= s.length; n++) {
      const h = crypto.createHash("md5").update(s.slice(i, i + n)).digest().readUInt32LE(0);
      v[h % EMBEDDING_DIMS] += h & 1 ? 1 : -1;
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return Buffer.from(v.buffer).toString("base64");
}
