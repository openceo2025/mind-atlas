const appUrl = "https://mind-atlas.org/?mode=shogi";
const mainSiteUrl = "https://mind-atlas.org";

const importSources = [
  {
    name: "将棋ウォーズ",
    image: "/wars-copy.png",
    alt: "将棋ウォーズの棋譜画面にあるコピーと共有の操作",
    heading: "棋譜をコピー",
    action: "棋譜画面で棋譜をコピーするか、共有リンクを取得します。",
  },
  {
    name: "将棋クエスト",
    image: "/quest-share.png",
    alt: "将棋クエストの共有メニューにある棋譜を送る操作",
    heading: "棋譜をコピー",
    action: "「棋譜を送る」から棋譜共有リンクをクリップボードへコピーします。",
  },
  {
    name: "棋桜",
    image: "/kio-copy-guide-v3.png",
    alt: "棋桜の棋譜画面で棋譜コピーを押す場所",
    heading: "棋譜コピーを押す",
    action: "対局画面の下にある「棋譜コピー」を押して、棋譜をコピーします。",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ページ先頭へ">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Mind Atlas</span>
          <small>将棋の棋譜を整理する</small>
        </a>
        <a className="header-action" href={appUrl}>
          無料で使う
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">棋譜を捨てるのは勿体ない</p>
          <h1>将棋アプリでの全ての棋譜をひとつのツリーに整理する</h1>
          <p className="hero-lead">
            将棋ウォーズ、将棋クエスト、棋桜の棋譜をひとつにまとめます。
            分岐を比べ、気づいたことはその局面にメモ。
            次の対局前に、迷った手だけを振り返れます。
          </p>
          <div className="hero-actions">
            <a className="primary-action" href={appUrl}>
              無料で棋譜を開く
              <span aria-hidden="true">→</span>
            </a>
            <a className="text-action" href="#import">
              取り込み方を見る
            </a>
          </div>
          <p className="hero-note">登録なしで使えます。KIFの読み込み・再生・編集は無料です。</p>
        </div>
        <div className="scroll-cue" aria-hidden="true">
          <span />
          SCROLL
        </div>
      </section>

      <section className="intro-band" id="import">
        <div className="section-inner intro-grid">
          <div>
            <p className="section-kicker">棋譜を開く</p>
            <h2>KIFを入れるだけ。すぐ盤で見られます。</h2>
            <p className="section-copy">
              サブメニューからインポートを選ぶと、KIFファイルをマインドアトラスに読み込みます。難しい設定はありません。
            </p>
          </div>
          <figure className="guide-shot import-guide-shot">
            <img
              src="/kif-import-guide.png"
              alt="Mind Atlasのサブメニューでインポートを選ぶ場所を黄色い線で示した画面"
            />
            <figcaption>サブメニューの「インポート」からKIFを読み込みます。</figcaption>
          </figure>
        </div>
      </section>

      <section className="sources-band">
        <div className="section-inner">
          <p className="section-kicker">対局アプリから追加</p>
          <h2>いつもの対局アプリから、そのまま持ってこられます。</h2>
          <p className="section-copy source-intro">
            各アプリで棋譜をコピーし、サブメニューから「KIF棋譜をマージ」を選択して貼り付けます。将棋ウォーズや将棋クエストの共有用リンクも読み込めます。
          </p>

          <div className="source-list">
            {importSources.map((source) => (
              <article className="source-item" key={source.name}>
                <div className="source-label">{source.name}</div>
                <div className="phone-crop">
                  <img src={source.image} alt={source.alt} />
                </div>
                <div className="source-copy">
                  <h3>{source.heading}</h3>
                  <p>{source.action}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="merge-route" aria-label="3つの対局アプリからMind Atlasへ棋譜を貼り付ける流れ">
            <div className="merge-route-sources">
              <span>将棋ウォーズ</span>
              <span>将棋クエスト</span>
              <span>棋桜</span>
            </div>
            <div className="merge-route-arrow" aria-hidden="true">
              <span>クリップボードへコピー</span>
              <strong>↓</strong>
            </div>
            <div className="merge-route-target">Mind Atlasの「KIF棋譜をマージ」</div>
          </div>

          <div className="merge-guide-grid">
            <figure className="guide-shot">
              <img
                src="/kif-merge-menu-guide.png"
                alt="Mind AtlasのサブメニューでKIF棋譜をマージを選ぶ場所を黄色い線で示した画面"
              />
              <figcaption>サブメニューから「KIF棋譜をマージ」を選びます。</figcaption>
            </figure>
            <figure className="guide-shot">
              <img
                src="/kif-merge-dialog-guide.png"
                alt="棋譜テキストまたは共有URLの入力欄とマージボタンを黄色い線で示した画面"
              />
              <figcaption>コピーした棋譜を貼り付け、「この棋譜にマージ」を押します。</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="merge-band">
        <div className="section-inner merge-grid">
          <div className="variation-visual" aria-label="同一局面から複数の指し手が分岐するイメージ">
            <span className="variation-label variation-label-root">開始局面</span>
            <i className="variation-line line-a" />
            <i className="variation-line line-b" />
            <i className="variation-line line-c" />
            <button className="variation-node variation-root" type="button" tabIndex={-1}>初期局面</button>
            <button className="variation-node variation-a" type="button" tabIndex={-1}>▲76歩</button>
            <button className="variation-node variation-b" type="button" tabIndex={-1}>▲26歩</button>
            <button className="variation-node variation-c" type="button" tabIndex={-1}>▲56歩</button>
            <span className="variation-note">研究メモ</span>
          </div>
          <div>
            <p className="section-kicker">分岐を整理</p>
            <h2>自分の対局記録をツリーに残そう</h2>
            <p className="section-copy">
              同じ局面まで進んだ棋譜は一つに重なり、違う手から枝分かれします。
            </p>
            <ul className="feature-lines">
              <li><span>盤と連動</span>分岐先をクリックすると対応する局面へ移動</li>
              <li><span>局面メモ</span>気づきや反省をその局面に書き残す</li>
              <li><span>共有</span>作成した棋譜データはシェアリンクで共有</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="product-band">
        <div className="section-inner product-grid">
          <div>
            <p className="section-kicker">盤で見返す</p>
            <h2>盤を進めれば、分岐とメモもついてきます。</h2>
            <p className="section-copy">
              前後の手へ進む、候補手を選ぶ、将棋盤で分岐を作成する。
            </p>
          </div>
          <figure className="product-shot">
            <img
              src="/mind-atlas-shogi-board.png"
              alt="Mind Atlasで将棋盤と棋譜の分岐を同時に表示したモバイル画面"
            />
            <figcaption>実際の将棋棋譜モード</figcaption>
          </figure>
        </div>
      </section>

      <section className="save-band">
        <div className="section-inner">
          <p className="section-kicker">保存する</p>
          <h2>途中で閉じても、続きから。</h2>
          <div className="save-list">
            <article>
              <h3>自動保存</h3>
              <p>登録なしでも、作業中の棋譜をブラウザデータに保存します。</p>
            </article>
            <article>
              <h3>KIFで保存</h3>
              <p>分岐と局面メモを含めて、KIFとして書き出せます。</p>
            </article>
            <article>
              <h3>別の端末でも</h3>
              <p>Google連携すると、クラウド保存と共有リンクが使えます。</p>
            </article>
          </div>
        </div>
      </section>

      <section className="ai-note-band">
        <div className="section-inner">
          <div className="ai-note">
            <div>
              <p className="section-kicker">AI解析</p>
              <h2>「ここ、どうだった？」を、その場で聞けます。</h2>
            </div>
            <p>
              気になった局面で右上の「AI」を押すと、将棋AI「やねうら王」と評価関数「水匠5」が5秒考えて、評価値・最善手・その先の読み筋を返します。待っている必要はありません。別の局面を見たりメモを書いたりしている間に解析は進み、終わるとその局面が光って知らせます。
            </p>
          </div>
          <div className="analysis-list">
            <article>
              <h3>結果は局面のメモに</h3>
              <p>いつ・どのAIで解析したか、評価値、最善手、読み筋が、その局面のメモに追記されます。</p>
            </article>
            <article>
              <h3>読み筋がそのまま枝に</h3>
              <p>最善手からの5手が分岐として盤とツリーに並びます。すでに指されている手はそのまま使われ、同じ枝は増えません。</p>
            </article>
            <article>
              <h3>KIFにも残る</h3>
              <p>解析でできた分岐もメモも、いつものKIF書き出しに含まれます。</p>
            </article>
          </div>
          <p className="ai-note-terms">
            AI解析を使うにはGoogleログインが必要です。追加料金はありません。棋譜の読み込み・再生・編集はこれまでどおり登録なしで使えます。
          </p>
        </div>
      </section>

      <section className="final-cta">
        <div className="section-inner">
          <p>まずは一局、開いてみてください。</p>
          <h2>対局のあとに考えたことを、次の一局へ。</h2>
          <a className="primary-action" href={appUrl}>
            無料で棋譜を開く
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <footer>
        <span>Mind Atlas</span>
        <nav aria-label="フッターナビゲーション">
          <a href={`${mainSiteUrl}/about.html`}>Mind Atlasについて</a>
          <a href={`${mainSiteUrl}/privacy.html`}>プライバシー</a>
          <a href={`${mainSiteUrl}/terms.html`}>利用規約</a>
        </nav>
      </footer>
    </main>
  );
}
