import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Mind Atlas shogi landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ja">/i);
  assert.match(html, /Mind Atlas 将棋棋譜/);
  assert.match(html, /将棋アプリでの全ての棋譜をひとつのツリーに整理する/);
  assert.match(html, /将棋ウォーズ/);
  assert.match(html, /将棋クエスト/);
  assert.match(html, /棋桜/);
  assert.match(html, /「ここ、どうだった？」を、その場で聞けます。/);
  assert.match(html, /やねうら王/);
  assert.match(html, /水匠5/);
  assert.doesNotMatch(html, /AI解析は、ただいま準備中です。/);
  assert.match(html, /kif-import-guide\.png/);
  assert.match(html, /kif-merge-menu-guide\.png/);
  assert.match(html, /kif-merge-dialog-guide\.png/);
  assert.match(html, /初期局面/);
  assert.doesNotMatch(html, /<span>01<\/span>|<span>02<\/span>|<span>03<\/span>/);
  assert.match(html, /kio-copy-guide-v3\.png/);
  assert.match(html, /https:\/\/mind-atlas\.org\/\?mode=shogi/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
