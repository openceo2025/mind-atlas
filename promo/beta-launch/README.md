# MindAtlas β 宣伝動画（X / YouTube）

53秒・1920×1080・H.264 + AAC の MP4 と、YouTube 用サムネイル（1280×720）を作る一式。
実際のアプリを台本どおりに操作して録画し、字幕と音楽を重ねています。

| できあがり | 場所 |
|---|---|
| 動画 | `out/mindatlas-beta.mp4` |
| サムネイル | `out/thumbnail.png` |

`out/` は生成物なので git には入れていません（コマ画像が数百MBあります）。

## 構成（約53秒）

| 時間 | 場面 | 字幕 |
|---|---|---|
| 0:00 | タイトル | 思考を、空間に。 / MindAtlas β |
| 0:04 | 空間の全景 | メモを置くだけ。AIが**意味**で並べる。 |
| 0:07 | 軸を2回切り替え、カードが並び替わる | 軸を変えれば、同じメモが**別の地図**に。 |
| 0:14 | 1枚を手で運び出し、子カードを3枚 | ひとつの考えから、**次の考え**を。 |
| 0:26 | AIに頼むと課題カードが3枚でき、A案につながる | 頼むだけで、AIがカードを**作って、つなぐ**。 |
| 0:35 | 関係の発見 | 見落としていた**つながり**も、AIが見つける。 |
| 0:41 | 範囲選択 → グループ化 | 散らばった考えを、ひとつに**まとめる**。 |
| 0:49 | 締め | beta.mind-atlas.org / ブラウザで、いますぐ。 |

## 作り直し方

本番（mind-atlas.org / beta）には一切触れません。手元のステージング用サービスを相手に録ります。

1. サービスをモックで起こす（ログイン・課金・AI すべてモック）
   `MIND_ATLAS_STAGING_MOCK_AUTH=1`、`MIND_ATLAS_STAGING_MOCK_BILLING=1`、`MIND_ATLAS_STAGING_MOCK_PROVIDERS=1` を付けて
   `server/mind-atlas-service.mjs` を `127.0.0.1:8799` で。配信する画面は手元の URL を向けて作っておく：
   ```bash
   VITE_MIND_ATLAS_SERVICE_URL=http://127.0.0.1:8799 npm run spatial:build:hosted
   ```
2. 撮る → 音を作る → MP4 にする → サムネイル
   ```bash
   node promo/beta-launch/record.mjs
   python promo/beta-launch/music.py
   node promo/beta-launch/encode.mjs
   node promo/beta-launch/thumbnail.mjs
   ```
3. 確かめる（映像の中の決めた時刻を並べた一枚ができる）
   ```bash
   node promo/beta-launch/lib/check-mp4.mjs
   ```

必要なのは Google Chrome と Python（numpy）だけです。ffmpeg は要りません。MP4 への圧縮は
Chrome 自身の H.264 / AAC 符号器（WebCodecs）で行い、`lib/mp4.js` がそれを MP4 に詰めます。

### 中身

| ファイル | 役割 |
|---|---|
| `record.mjs` | 台本。アプリを操作して、画面を時刻つきの JPEG で録る |
| `overlay.js` | 録画中のページに差し込む字幕・見えるカーソル・クリックの波紋 |
| `cards/` | 冒頭と締めの画面（HTML / CSS のアニメーション） |
| `music.py` | 音楽と効果音をその場で合成（既存の楽曲・音源は使っていない） |
| `encode.html` / `encode.mjs` / `lib/mp4.js` | Chrome で H.264 / AAC に圧縮し、faststart の MP4 に詰める |
| `thumbnail.mjs` | サムネイル |
| `lib/recorder.mjs`, `lib/contact.mjs`, `lib/check-mp4.mjs` | 録画と確認用の道具 |

## 知っておいてほしいこと

- **AI の返事は台本です。** 映っている操作と機能はすべて実物ですが、AI が返す内容（作られる3枚の課題カード、
  関係の理由の文）は毎回同じになるよう `record.mjs` の `scriptedTurn` で決めています。気になる場合は、
  投稿文や動画の隅に「画面はデモです」と添えてください。
- β の AI 機能はログインと購読が要ります。締めの「ブラウザで、いますぐ」はそのままでも嘘にはなりませんが、
  「無料」とは書いていません。
- カードの中身は β の最初に入っているデモ空間（架空の企業・人物を含む）です。

## 投稿用の文面（たたき台）

**X**

> 考えを、空間に並べるノート「MindAtlas β」を公開しました。
> メモを置くとAIが“意味”で配置。軸を変えれば同じメモが別の地図に。
> 「A案の課題を3つカードにして」と頼めば、AIがカードを作ってつないでくれます。
> ブラウザでそのまま使えます👇
> https://beta.mind-atlas.org
> #MindAtlas #思考整理 #AI

**YouTube**

- タイトル：`思考を、空間に。— AIが意味でカードを並べる「MindAtlas β」`
- 説明（53秒の動画ではチャプターの条件「各10秒以上」を満たせないので、箇条書きにしてある）：
  ```
  MindAtlas β は、メモやアイデアを空間に置くと、AI が“意味”で並べてくれる思考ツールです。

  ・メモが意味で並ぶ
  ・軸を変えると、同じメモが別の地図に
  ・ひとつのカードから子カードを生やす
  ・AIに頼むと、カードを作ってつないでくれる
  ・見落としていたつながりを見つける
  ・まとめてグループ化

  ブラウザですぐ使えます：https://beta.mind-atlas.org
  ※ 画面はデモ用の空間です。

  #MindAtlas #思考整理 #AI #マインドマップ
  ```
