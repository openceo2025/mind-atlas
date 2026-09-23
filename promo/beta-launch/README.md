# MindAtlas β 宣伝動画（X / YouTube）

53秒・H.264 + AAC の MP4（横 1920×1080 と 縦 1080×1920）と、YouTube 用サムネイル（1280×720）を作る一式。
実際のアプリを台本どおりに操作して録画し、字幕と音楽を重ねています。

| できあがり | 場所 |
|---|---|
| 動画（横・X / YouTube） | `out/mindatlas-beta.mp4` |
| 動画（縦・Shorts / X / リール / TikTok） | `out/mindatlas-beta-vertical.mp4` |
| サムネイル | `out/thumbnail.png` |

`out/` は生成物なので git には入れていません（コマ画像が数百MBあります）。

## 1分版（導入アニメーションつき）

| できあがり | 場所 |
|---|---|
| 横 | `out/mindatlas-beta-60s.mp4` |
| 縦 | `out/mindatlas-beta-60s-vertical.mp4` |

約56秒。JavaScript で描いた導入（`cards/intro.html` / `intro.js`）から、実際の画面へつなぎます。

| 時間 | 導入 | 画面 |
|---|---|---|
| 0:00 | AIをフル活用している人ほど | AI への依頼の吹き出しが、どんどん積み上がる |
| 0:04 | 認知と判断で、脳機能の消耗が激しい。 | 画面があふれて赤みを帯び、「思考の余力」が 100% → 8% に減る |
| 0:08 | AI時代の、新しい思考整理ツール | 混沌が点に縮み、X / Y / Z の軸にそってカードとして整列する |
| 0:12 | マインドアトラス / MindAtlas β | 名前。光の玉が広がって、そのまま実際の画面へ |
| 0:15 | 以降、実際の画面（6場面）→ 締め | |

実際の画面は `edit.mjs` が編集します。字幕の出ている間を 1 場面として残し、場面と場面の
つなぎ（字幕の無い所）は切ります。場面の中は、画面がどれだけ動いているかで速さを変えます
（動いている所は等速、止まっている所ほど速く、最大 2.5 倍。字幕が入る最初の 0.8 秒は落ち着かせる）。
録画は画面が変わったときだけ絵が届くので、その密度をそのまま「動いている量」に使っています。

導入の間の音は、鼓動・通知音・ざわめきが増えていく張りつめた音にし、整列するところで和音に解き放ちます。

作り直し方（録画はそのまま使い回せます）：

```bash
node promo/beta-launch/record-intro.mjs
node promo/beta-launch/edit.mjs
python promo/beta-launch/music.py out/edit-landscape.json out/music-60s.wav
node promo/beta-launch/encode.mjs mindatlas-beta-60s.mp4 --edit out/edit-landscape.json --audio out/music-60s.wav
node promo/beta-launch/vertical.mjs --name mindatlas-beta-60s-vertical.mp4 --edit out/edit-vertical.json --audio out/music-60s.wav
```

## 導入アニメーション・英語版

| できあがり | 場所 |
|---|---|
| 横 | `out/mindatlas-intro-en.mp4` |
| 縦 | `out/mindatlas-intro-en-vertical.mp4` |

約15秒、導入だけの動画（音つき）。`cards/intro.html?lang=en` で、言葉・依頼の吹き出し・
メーター（Mental reserve）がすべて英語になります。拍の時刻は日本語版と同じです。

| 日本語 | 英語 |
|---|---|
| AIをフル活用している人ほど | The more you work with AI, |
| 認知と判断で、脳機能の消耗が激しい。 | the more your brain drains from thinking and deciding. |
| AI時代の、新しい思考整理ツール | A new way to organize your thinking for the AI era. |
| マインドアトラス | MindAtlas — Think in space. β |

```bash
node promo/beta-launch/record-intro.mjs --lang en
node promo/beta-launch/edit.mjs --lang en --intro-only
python promo/beta-launch/music.py out/edit-intro-landscape-en.json out/music-intro-en.wav
node promo/beta-launch/encode.mjs mindatlas-intro-en.mp4 --edit out/edit-intro-landscape-en.json --audio out/music-intro-en.wav
node promo/beta-launch/vertical.mjs --name mindatlas-intro-en-vertical.mp4 --edit out/edit-intro-vertical-en.json --audio out/music-intro-en.wav
```

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
   node promo/beta-launch/vertical.mjs
   node promo/beta-launch/thumbnail.mjs
   ```
3. 確かめる（映像の中の決めた時刻を並べた一枚ができる）
   ```bash
   node promo/beta-launch/lib/check-mp4.mjs
   node promo/beta-launch/lib/check-mp4.mjs mindatlas-beta-vertical.mp4
   ```

### 縦版のつくり

横版と同じ録画を使い回しています。上に見出し（思考を、空間に。）、真ん中に録画の切り出し、
下に大きな字幕、いちばん下に URL。冒頭と締めは中央を正方形で切り出しています。

真ん中の切り出しは「いま大事な所」が全部入るように決めます。録画中にページが 0.1 秒ごとに
カーソル・開いている窓・操作の輪・選んだカード・範囲選択の位置を記録していて（`overlay.js`）、
それが全部入る範囲を映します。ふだんは等倍、入らないときだけ少し引きます（最大 0.83 倍）。
少し先の出来事まで見て動かすので、操作の瞬間にカメラが遅れて追いかけることはありません。

字幕は映像に焼き込まず、時刻だけ記録しておき、書き出すときに横版・縦版それぞれの形で重ねます。

必要なのは Google Chrome と Python（numpy）だけです。ffmpeg は要りません。MP4 への圧縮は
Chrome 自身の H.264 / AAC 符号器（WebCodecs）で行い、`lib/mp4.js` がそれを MP4 に詰めます。

### 中身

| ファイル | 役割 |
|---|---|
| `record.mjs` | 台本。アプリを操作して、画面を時刻つきの JPEG で録る |
| `overlay.js` | 録画中のページに差し込む見えるカーソル・クリックの波紋と、縦版のための「大事な所」の記録 |
| `lib/captions.mjs` | 横版の字幕を字幕ごとの絵にする（書き出しで重ねる） |
| `cards/` | 冒頭と締めの画面（HTML / CSS のアニメーション） |
| `music.py` | 音楽と効果音をその場で合成（既存の楽曲・音源は使っていない） |
| `encode.html` / `encode.mjs` / `lib/mp4.js` | Chrome で H.264 / AAC に圧縮し、faststart の MP4 に詰める |
| `vertical.mjs` | 縦版の飾り（見出し・字幕・URL）を字幕ごとに描き、縦の MP4 にする |
| `cards/intro.html`, `cards/intro.js` | 1分版の導入アニメーション（横・縦どちらの大きさでも動く） |
| `record-intro.mjs` | 導入を横と縦で録る |
| `edit.mjs` | 1分版の編集（場面の選び出し・つなぎのカット・止まっている所の早送り） |
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
