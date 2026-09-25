# マインドアトラス（スペース）とマインドアトラス（カード）

Mind Atlas は二つの見え方を持つ。

- **マインドアトラス（スペース）** — 天体（ノード）の宇宙。`src/`。mind-atlas.org の入口。
- **マインドアトラス（カード）** — カードを意味の軸（X/Y/Z）に沿って並べる空間。`spatial/`。
  旧「MindAtlas β」（beta.mind-atlas.org）。

スペースのノード（惑星）に入り込むと、その内側にあるカードの空間になる。入れ子は 1 段だけで、
カードの中にさらに入り込むことはない。カードから始めたい人のために、card.mind-atlas.org で
カードだけを単独でも使える。

Mode: カード空間は **hosted-only**。ローカル開発者モード（`npm run dev:all`）の宇宙には入口を出さない
（`App.tsx` の `planetEntryEnabled`）。カードアプリ単体のローカル開発（`npm run spatial:dev:all`）は従来どおり。

## 入り込む・上昇する

| 操作 | 動き |
| --- | --- |
| ノードを長押し（マウス・タッチ） | 1 秒で突入演出が始まる。動かしたら「離した」とみなす |
| 突入演出の前半（全体 900ms の半分 = 450ms まで）に離す・動かす | キャンセル。宇宙に戻る（クリック扱いにもならない） |
| フォーカスパネルの「カード」ボタン | 長押しなしで突入（キーボード操作の人向け） |
| カード側の「スペースへ」ボタン、サイドバーの「戻る」、ブラウザの「戻る」 | 上昇。開いていた空間の惑星へカメラが寄る |

演出はレンダリング「高」のときだけ。宇宙が惑星へ吸い込まれて白く飛び（600ms）、カード空間の読み込みが
終わるまでホワイトアウトを保ち、白が晴れてカードが現れる（300ms）。読み込みが長ければ「着陸中…」を出す。
「低」と `prefers-reduced-motion` では演出なしで、カード空間の準備ができた瞬間に切り替わる。

実装:

| 部分 | 場所 |
| --- | --- |
| 長押しの検出（キャンバスから呼ぶ） | `src/planet/planetHold.ts`、`UniverseCanvas.tsx` のノードのポインター処理 |
| 突入・上昇の状態機械、演出、iframe、履歴、リマインダーの見張り | `src/planet/PlanetGate.tsx`, `planetGate.css` |
| 宇宙とカードの取り決め（メッセージ、リマインダー索引） | `src/planet/cardBridge.ts`（両アプリが import する） |
| カード側の窓口 | `spatial/src/lib/embed.ts`、`spatial/src/App.tsx` の `useEmbeddedBoot` |

カードアプリは別ビルド（`dist-spatial/`、ベースパス `/card/`）のまま、宇宙の中で同じオリジンの iframe として
開く。一度読み込んだ iframe は宇宙に戻っても残すので、二回目以降の突入は速い。CSS やキーボード操作は
iframe で分かれているので、二つのアプリが互いを壊さない。ログインと支払いの画面は宇宙の窓で開く。

## ノードと空間の結びつき

- ノードは初めて入り込まれたときに `cardPlanetId` を持つ（`atlasStore.assignCardPlanet`）。
- カード側の空間は `anchor: { planetId, nodeId, nodeTitle }` を持つ。1 ノード = 1 空間。
- 惑星を開く順番: この端末の空間 → クラウドの空間（`/api/spaces` が `planetId` を返す）→ ノード名で新規作成。
- ノードの貼り付け（複製）、空間の取り込み・複製では結びつきを引き継がない（別の惑星・別の空間になる）。
- ノードに結びついていない空間（旧 β で作ったもの、単独版で作ったもの）はスペース一覧（Shelf）にそのまま
  残り、カード側で自由に行き来できる。上昇はいま開いている空間の惑星へ。結びつきが無ければ宇宙のその場へ戻る。

## リマインダー

カードに `reminder: { at, firedAt? }` を付けられる。ラジアルメニューとコマンドパレットの「リマインダーをセット」
（旧「抽出」の位置。抽出機能は廃止）から、言葉で頼む（AI が時刻を決める）か、時刻を選ぶ。AI アシスタントに
「このカードを明日の朝に知らせて」と頼んでもよい（`get_current_time` → `set_reminder`）。

- カード側は保存のたびに、端末内の索引（localStorage `mindatlas-card-reminders-v1`）へ写す。
- 宇宙はこの索引を 15 秒ごとに見張り、時刻が来たら惑星のノードに未読通知を付けて波紋を出す
  （署名 `card-reminder:<spaceId>:<cardId>:<at>`）。その惑星に入り込むと既読になる。
- 単独版（card.mind-atlas.org）ではカード側が見張り、トーストで知らせる。
- 索引は端末ごと・ドメインごと。

## 配信

| ホスト | サービス | 内容 |
| --- | --- | --- |
| mind-atlas.org | `mind-atlas`（:8788、`/opt/mind-atlas`） | `/` に宇宙（`dist/`）、`/card/` にカード（`dist-spatial/`） |
| card.mind-atlas.org | `mind-atlas-card`（:8789、`/opt/mind-atlas-card`） | `/` と `/card/` にカード |
| beta.mind-atlas.org | 同上（旧 nginx サイトが :8789 へ流す） | カード。端末内のスペースを新しい場所へ移す案内を出す |

旧 β の共有リンク `/s/<token>` は、どのホストでも `/card/s/<token>` へ転送する。

### mind-atlas.org のデプロイ

`mind-atlas-deploy` スキルのまま。`npm run build:hosted` がカードアプリも組み立て、
`npm run verify:hosted-dist` が `dist-spatial/` を検査する。

### card.mind-atlas.org のデプロイ

コミットして push したあと、Git Bash で:

```bash
bash deploy/card/deploy-card.sh
```

VPS 側（`deploy/card/remote-deploy.sh`）の流れ:

1. `/opt/mind-atlas-card` を `/opt/mind-atlas-card-backups/<日時>-<旧sha>` に複製（1 世代）
2. push 済みコミットの `git archive` を展開
3. `.env.service` を本体から作り直し、カード用の値だけ上書き（ポート 8789、`dist-spatial`、アナリティクスとメンテナンスは無効）。
   公開 origin は card の証明書ができるまでは beta、できたら card
4. `npm ci` → `npm run spatial:build:hosted` → `npm run verify:spatial-dist`
5. `pg_dump`（直近 3 世代）→ `npm run spatial:migrate`
6. 旧 `mind-atlas-beta` サービスが有効なら止めて無効化（`/opt/mind-atlas-beta` はロールバック用に残す）→ `mind-atlas-card` を起動
7. nginx サイト `mind-atlas-card` を初回だけ設置。証明書が無ければ `mind-atlas-card-tls.timer` が 5 分おきに DNS を確かめ、
   このサーバーを指したら certbot で取得し、公開 origin を card に切り替えてサービスを再起動する

### 初回だけ必要な外部設定（card.mind-atlas.org）

- DNS: `card.mind-atlas.org` の A レコード → `160.251.141.158`。`beta.mind-atlas.org` の A レコードは残す
- Google OAuth クライアント: 承認済みリダイレクト URI に `https://card.mind-atlas.org/api/auth/google/callback`、
  承認済み JavaScript 生成元に `https://card.mind-atlas.org` を追加（beta の分は移行が済むまで残す）

## 旧 β の端末内データ

ブラウザの保存領域はドメインごとに分かれているので、beta.mind-atlas.org で「この端末に保存」していた
スペースは新しいドメインから読めない。beta.mind-atlas.org を開くと案内が出て、「マインドアトラス（スペース）へ移す」
か「card.mind-atlas.org へ移す」を押すと、新しい窓を開いて窓どうしで手渡す（`spatial/src/lib/legacyMove.ts`、
サーバーは通さない）。同じ ID のスペースは二重に入らない。ログインしてクラウドに保存していたスペースは
どのドメインからでも開けるので、移す必要はない。

## データベース

本番の PostgreSQL（users / sessions / subscriptions / credits）を本体と共有する。カードが足すのは次の 2 表だけ。

- `spatial_spaces` — 利用者ごとの空間（jsonb）。共有トークン付き。`data.anchor.planetId` でノードと結びつく
- `spatial_embeddings` — 埋め込みのキャッシュ

## ローカル開発

```bash
npm run spatial:dev:all
```

カードアプリ単体（ブリッジ :8787、Vite :5180）。宇宙に埋め込んだ動きを確かめるときは、公開モードでビルドした
`dist/`（`VITE_MIND_ATLAS_PUBLIC_SERVICE=true`）と `npm run spatial:build:hosted` の `dist-spatial/` を、
`/` と `/card/` に配信して開く。
