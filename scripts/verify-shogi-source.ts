import {
  parseShogiQuestHtml,
  parseShogiWarsHtml,
  validateShogiSourceUrl,
} from "../server/shogi-source.mjs";
import { importShogiRecordText } from "../src/features/shogi/shogiRecord.ts";

const warsProps = {
  gameHash: {
    name: "fixture-wars",
    sente: "Sente player",
    gote: "Gote player",
    init_sfen_position: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
    moves: [{ m: "+7776FU" }, { m: "-3334FU" }],
  },
};
const warsAttribute = JSON.stringify(warsProps).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const warsHtml = '<div data-react-props="' + warsAttribute + '" data-react-cache-id="fixture"></div>';
const wars = parseShogiWarsHtml(warsHtml, new URL("https://shogiwars.heroz.jp/games/fixture-wars?ply=0"));
const warsRecord = importShogiRecordText(wars.text, wars.datasetName, "csa");
if (wars.provider !== "shogi-wars" || countNodes(warsRecord.root) !== 5) {
  throw new Error("Shogi Wars public-page parsing failed.");
}

const questHtml = [
  "<title>将棋クエスト | Sente player(R1500) vs Gote player(R1500)</title>",
  "<script>window.__NUXT__=(function(a,b){var x={};x.position={moves:[{m:a},{m:b}]};return x}(\"7776FU\",\"3334FU\"))</script>",
].join("");
const quest = parseShogiQuestHtml(questHtml, new URL("https://kifu.questgames.net/shogi/games/fixture123"));
const questRecord = importShogiRecordText(quest.text, quest.datasetName, "csa");
if (quest.provider !== "shogi-quest" || countNodes(questRecord.root) !== 5) {
  throw new Error("Shogi Quest public-page parsing failed.");
}

for (const unsafe of [
  "http://shogiwars.heroz.jp/games/example",
  "https://user:pass@shogiwars.heroz.jp/games/example",
  "https://shogiwars.heroz.jp:8443/games/example",
  "https://localhost/games/example",
  "https://shogiwars.heroz.jp/other/example",
  "https://kifu.questgames.net/chess/games/example",
]) {
  let rejected = false;
  try {
    validateShogiSourceUrl(unsafe);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe shogi source URL was accepted: " + unsafe);
}

console.log("verify:shogi-source:passed");

function countNodes(node: { children: Array<{ children: unknown[] }> }): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}
