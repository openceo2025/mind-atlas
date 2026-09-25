# MindAtlas β（空間UI）

カードを意味の軸（X/Y/Z）に沿って並べる新しいフロントエンド。`spatial/` に独立した Vite アプリとして置き、
既存の MindAtlas（`src/`、mind-atlas.org）とはビルドも配信も分けている。サーバーは既存の
`server/mind-atlas-service.mjs` をそのまま使い、β 用の API を `server/spatial-service.mjs` で足している。

## 構成

| 部分 | 場所 | 補足 |
| --- | --- | --- |
| フロントエンド | `spatial/src` | React 19 + Zustand + Framer Motion。出力は `dist-spatial/` |
| 意味配置 | `spatial/src/lib/semantic.ts`, `embeddings.ts` | サーバーの埋め込み（OpenAI `text-embedding-3-small`, 256 次元）。取れないときは端末内の近似 |
| 手で置いた位置 | `card.overrides[axisId]` | ドラッグした軸ごとに埋め込み由来の値を上書きして保存 |
| AI 操作 | `spatial/src/lib/ai.ts` | 要約・比較・展開・抽出・関係・チャット。既存の `/api/ai/text-partner-turn`（クレジット課金）を `product: "spatial"` で呼ぶ |
| 保存 | IndexedDB（常時）＋ `/api/spaces`（ログイン時） | 共有リンクは `/s/<token>`（閲覧専用） |
| 翻訳 | `spatial/src/i18n/locales/*.json` | 12 言語。`npm run verify:spatial-i18n` で鍵とプレースホルダーを検査 |
| 開発者モード | `spatial/src/devmode` | ローカルのみ。公開ビルドからは除外（`verify:spatial-dist` が検査） |

### データベース

本番の PostgreSQL（users / sessions / subscriptions / credits）を本体と共有する。β が足すのは次の 2 表だけで、
既存の表は変更しない（`server/spatial-service.mjs` の `migrateSpatialDatabase`）。

- `spatial_spaces` — 利用者ごとのスペース（jsonb）。共有トークン付き
- `spatial_embeddings` — 埋め込みのキャッシュ（`MIND_ATLAS_EMBEDDING_CACHE_DAYS` 日使われないと削除）

β は `MIND_ATLAS_MAINTENANCE_INTERVAL_MS=0` で動かし、セッション掃除とクレジット返金は本体だけが行う。
Stripe の Webhook も本体に登録済みのものだけを使う（β では登録しない）。

## ローカル開発

```bash
npm run spatial:dev:all
```

ブリッジ（:8787）と Vite（:5180）が起動する。Google・Stripe・本番 DB は不要で、AI と埋め込みはブリッジの鍵を使う。

公開モードの確認は、Postgres を用意して `MIND_ATLAS_STAGING_MOCK_AUTH/BILLING/PROVIDERS=1`、
`MIND_ATLAS_DIST_DIR=dist-spatial` でサービスを起動し、`npm run spatial:build:hosted` の出力を配信する。

## デプロイ（beta.mind-atlas.org）

コミットして push したあと、Git Bash で:

```bash
bash deploy/beta/deploy-beta.sh
```

VPS 側（`deploy/beta/remote-deploy.sh`）の流れ:

1. `/opt/mind-atlas-beta` を `/opt/mind-atlas-beta-backups/<日時>-<旧sha>` に複製（ロールバック用に 1 世代）
2. push 済みコミットの `git archive` を展開
3. `.env.service` を本体の `.env.service` から作り直し、β 用の値だけ上書き（ポート 8789、オリジン、`dist-spatial`、アナリティクス無効、メンテナンス無効）
4. `npm ci` → `npm run spatial:build:hosted` → `npm run verify:spatial-dist`
5. `pg_dump` で本番 DB をバックアップ（`/opt/mind-atlas-beta-backups/db`、直近 3 世代）→ `npm run spatial:migrate`
6. systemd `mind-atlas-beta` を再起動、nginx サイト `mind-atlas-beta` は初回だけ設置（以後は certbot が管理）
7. 証明書が無ければ `mind-atlas-beta-tls.timer` が 5 分おきに DNS を確かめ、このサーバーを指したら certbot で取得する

ロールバックはスクリプトの最後に出る 1 行（`systemctl stop mind-atlas-beta && … mv … && systemctl start mind-atlas-beta`）。

### 初回だけ必要な外部設定

- DNS: `beta.mind-atlas.org` の A レコード → `160.251.141.158`（ムームードメイン）
- Google OAuth クライアント: 承認済みリダイレクト URI `https://beta.mind-atlas.org/api/auth/google/callback`、
  承認済み JavaScript 生成元 `https://beta.mind-atlas.org`
