import type { AtlasNode, PlanetTexture, WorkStatus } from "./types";

export const NOTEBOOK_TEMPLATES = [
  {
    id: "blank",
    title: "空白のスペース",
    description: "何もない空間から始めます。",
  },
  {
    id: "daily-notes",
    title: "日常メモのスペース",
    description: "今日の判断を四つの置き場に分けます。",
  },
  {
    id: "novel",
    title: "小説を書く",
    description: "世界観、人物、あらすじ、本文を一つの宇宙で育てます。",
  },
  {
    id: "swot",
    title: "SWOT分析をする",
    description: "強み、弱み、機会、脅威から次の一手を整理します。",
  },
  {
    id: "travel",
    title: "旅行計画を立てる",
    description: "やりたいこと、日程、持ち物、予約情報をまとめます。",
  },
  {
    id: "scamper",
    title: "アイデアを練る",
    description: "SCAMPERの問いで、ひとつの着想を広げます。",
  },
] as const;

export type NotebookTemplateId = (typeof NOTEBOOK_TEMPLATES)[number]["id"];

type TemplateDraft = {
  title: string;
  body?: string;
  children?: TemplateDraft[];
  status?: WorkStatus;
  color?: string;
  texture?: PlanetTexture;
};

const COLORS = ["#d8ba58", "#76badf", "#a783d2", "#72c6a0", "#dc8c70", "#7ca4e8", "#cf7ca2"];
const TEXTURES: PlanetTexture[] = ["bands", "speckled", "freckles", "cell", "craters", "mist"];

export function createNotebookFromTemplate(templateId: NotebookTemplateId): AtlasNode {
  return buildTemplateTree(templateId, templateDraft(templateId));
}

function templateDraft(templateId: NotebookTemplateId): TemplateDraft {
  switch (templateId) {
    case "daily-notes":
      return root("日常メモのスペース", "今日のことを、次に動く場所へ分けておきます。", [
        category("すぐにやること", "すぐにやること1"),
        category("そのうちやること", "そのうちやること1"),
        category("あとまわしにすること", "あとまわしにすること1"),
        category("だれかに頼むこと", "だれかに頼むこと1"),
      ]);
    case "novel":
      return root("小説を書く", "物語の材料を、書きながら増やしていくためのスペースです。", [
        item("世界観", "時代、場所、ルール、空気感を書きます。", [
          item("舞台", "物語が始まる場所と、その場所らしさ。"),
          item("ルール", "この世界で守られていること、破られたときに起きること。"),
        ]),
        item("登場人物", "人物の望み、葛藤、秘密を置きます。", [
          item("主人公", "主人公が欲しいものと、まだ見えていない弱さ。"),
          item("相手役", "主人公の選択を揺らす人物。"),
        ]),
        item("あらすじ", "始まり、中盤、終わりの変化を短く並べます。", [
          item("始まり", "何が壊れ、主人公が動き出すのか。"),
          item("転換点", "戻れなくなる決断。"),
          item("結末", "最後に残る変化。"),
        ]),
        item("本文", "実際の文章を書く場所です。", [
          item("第1章", "最初の場面を書きます。", [item("冒頭", "読者を物語へ連れていく最初の数行。")]),
        ]),
      ]);
    case "swot":
      return root("SWOT分析", "四つの視点から状況を見て、次の一手を決めます。", [
        item("Strengths - 強み", "自分たちがすでに持っている有利な点。", [item("活かせる資産", "人、技術、信頼、経験など。")]),
        item("Weaknesses - 弱み", "今のままでは足を引っ張る点。", [item("補うこと", "先に小さく改善できること。")]),
        item("Opportunities - 機会", "追い風になりそうな変化や空白。", [item("試すこと", "小さく検証できる機会。")]),
        item("Threats - 脅威", "外から来るリスクや変化。", [item("備えること", "先に決めておく回避策。")]),
      ]);
    case "travel":
      return root("旅行計画", "行きたいことと必要な準備を、一つの地図にまとめます。", [
        item("やりたいこと", "旅先で心に残したいこと。", [
          item("見たい景色", "時間帯や場所の候補。"),
          item("体験したいこと", "予約が必要かどうかも書きます。"),
          item("食べたいもの", "店や地域の候補。"),
          item("聞きたいこと", "現地で知りたい話や音。"),
        ]),
        item("旅行計画", "日ごとの動きと余白を置きます。", [
          item("1日目", "到着から夜まで。", [item("スケジュール", "移動、休憩、最初の目的地。")]),
          item("2日目", "一番やりたいことに時間を使う日。", [item("スケジュール", "午前、午後、夜の案。")]),
        ]),
        item("持ち物", "忘れたくないものを増やします。", [
          item("必需品", "身分証、支払い手段、充電器。"),
          item("天候に合わせるもの", "服、傘、歩きやすい靴。"),
        ]),
        item("予約/チケット情報", "番号や締切をまとめます。", [
          item("移動", "出発時刻、座席、集合場所。"),
          item("宿泊・入場", "予約番号、チェックイン、キャンセル期限。"),
        ]),
      ]);
    case "scamper":
      return root("アイデアを練る", "SCAMPERの問いを使い、ひとつの着想を違う角度から見ます。", [
        item("テーマ", "考えたい対象や困りごとを一文で書きます。"),
        item("Substitute - 置き換える", "何を別のものに変えられるか。"),
        item("Combine - 組み合わせる", "何と組み合わせると新しくなるか。"),
        item("Adapt - 応用する", "別の場面の仕組みを借りられないか。"),
        item("Modify - 変える", "大きさ、順番、強さ、見せ方を変える。"),
        item("Put to another use - 転用する", "別の人、別の目的に使えないか。"),
        item("Eliminate - 減らす", "なくしても本当に困らないものは何か。"),
        item("Reverse - 逆にする", "順序や役割を反転できないか。"),
        item("次に試すこと", "最初に小さく確かめる一歩。", [item("実験メモ", "何を見れば、進めるかを判断できるか。")]),
      ]);
    case "blank":
    default:
      return root("空白のスペース", "ここから自由に始めます。", []);
  }
}

function root(title: string, body: string, children: TemplateDraft[]): TemplateDraft {
  return { title, body, children, status: "waiting", color: "#d8ba58", texture: "bands" };
}

function category(title: string, childTitle: string): TemplateDraft {
  return item(title, "この場所に集めます。", [item(childTitle, "ここに詳細を書く")]);
}

function item(title: string, body: string, children: TemplateDraft[] = []): TemplateDraft {
  return { title, body, children };
}

function buildTemplateTree(templateId: NotebookTemplateId, draft: TemplateDraft): AtlasNode {
  const createdAt = new Date().toISOString();
  const unique = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let serial = 0;

  const build = (current: TemplateDraft, parentId: string | undefined, depth: number): AtlasNode => {
    const index = serial;
    serial += 1;
    const id = `template-${templateId}-${unique}-${index}`;
    const body = current.body ?? "";
    const color = current.color ?? COLORS[index % COLORS.length];
    const texture = current.texture ?? TEXTURES[index % TEXTURES.length];
    return {
      id,
      kind: depth === 0 ? "root" : "thread",
      nodeType: "note",
      title: current.title,
      subtitle: depth === 0 ? "Mind Atlas" : "note",
      body,
      author: "human",
      status: current.status ?? "waiting",
      color,
      texture,
      radius: depth === 0 ? 46 : 28,
      summary: body.split("\n").find(Boolean) ?? current.title,
      nextDecision: depth === 0 ? "最初に書き始める場所を選びます。" : "このノードを具体的にします。",
      tags: [],
      attachments: [],
      createdAt,
      updatedAt: createdAt,
      sourceParentId: parentId,
      children: (current.children ?? []).map((child) => build(child, id, depth + 1)),
    };
  };

  return build(draft, undefined, 0);
}
