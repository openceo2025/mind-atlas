import type { AvailableLocale } from "./i18n/locales";
import type { MessageId } from "./i18n/messages";
import type { AtlasNode, PlanetTexture, WorkStatus } from "./types";

export const NOTEBOOK_TEMPLATES = [
  {
    id: "blank",
    titleMessageId: "template.blank.title",
    descriptionMessageId: "template.blank.description",
  },
  {
    id: "daily-notes",
    titleMessageId: "template.daily.title",
    descriptionMessageId: "template.daily.description",
  },
  {
    id: "novel",
    titleMessageId: "template.novel.title",
    descriptionMessageId: "template.novel.description",
  },
  {
    id: "swot",
    titleMessageId: "template.swot.title",
    descriptionMessageId: "template.swot.description",
  },
  {
    id: "travel",
    titleMessageId: "template.travel.title",
    descriptionMessageId: "template.travel.description",
  },
  {
    id: "scamper",
    titleMessageId: "template.scamper.title",
    descriptionMessageId: "template.scamper.description",
  },
] as const satisfies readonly { id: string; titleMessageId: MessageId; descriptionMessageId: MessageId }[];

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

export function createNotebookFromTemplate(templateId: NotebookTemplateId, locale: AvailableLocale = "en"): AtlasNode {
  return buildTemplateTree(templateId, locale === "ja" ? templateDraftJa(templateId) : templateDraftEn(templateId));
}

function templateDraftJa(templateId: NotebookTemplateId): TemplateDraft {
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

function templateDraftEn(templateId: NotebookTemplateId): TemplateDraft {
  switch (templateId) {
    case "daily-notes":
      return root("Daily notes", "Sort today's notes by what should happen next.", [
        categoryEn("Do now", "Do now 1"),
        categoryEn("Do later", "Do later 1"),
        categoryEn("Defer", "Defer 1"),
        categoryEn("Delegate", "Delegate 1"),
      ]);
    case "novel":
      return root("Write a novel", "A space for developing the material of a story while you write.", [
        item("World", "Describe the era, place, rules, and atmosphere.", [
          item("Setting", "Where the story begins and what makes the place distinctive."),
          item("Rules", "What this world protects and what happens when a rule is broken."),
        ]),
        item("Characters", "Collect each character's desire, conflict, and secret.", [
          item("Protagonist", "What the protagonist wants and the weakness they cannot see yet."),
          item("Counterpart", "A person who unsettles the protagonist's choices."),
        ]),
        item("Plot", "Arrange the opening, middle, and ending as a short sequence of changes.", [
          item("Opening", "What breaks and makes the protagonist move."),
          item("Turning point", "The decision that makes it impossible to return."),
          item("Ending", "The change that remains at the end."),
        ]),
        item("Manuscript", "Write the actual prose here.", [
          item("Chapter 1", "Write the first scene.", [item("Opening lines", "The first lines that lead the reader into the story.")]),
        ]),
      ]);
    case "swot":
      return root("SWOT analysis", "Use four viewpoints to understand the situation and decide the next move.", [
        item("Strengths", "Advantages already available to us.", [item("Assets to use", "People, technology, trust, experience, and other assets.")]),
        item("Weaknesses", "Factors that hold us back in the current state.", [item("What to improve", "A small improvement we can make first.")]),
        item("Opportunities", "Changes or open spaces that may create a tailwind.", [item("What to test", "An opportunity we can validate on a small scale.")]),
        item("Threats", "External risks and changes.", [item("What to prepare", "A preventive action to decide in advance.")]),
      ]);
    case "travel":
      return root("Trip plan", "Collect what you want to do and the preparation you need in one map.", [
        item("Things to do", "What you want to remember from the trip.", [
          item("Views to see", "Candidate places and the best time of day."),
          item("Experiences", "Note whether a reservation is required."),
          item("Food to try", "Candidate restaurants or regional dishes."),
          item("Things to hear", "Stories or sounds you want to discover locally."),
        ]),
        item("Itinerary", "Leave room around each day's movement.", [
          item("Day 1", "From arrival through the evening.", [item("Schedule", "Travel, breaks, and the first destination.")]),
          item("Day 2", "A day for the thing you most want to do.", [item("Schedule", "Ideas for morning, afternoon, and evening.")]),
        ]),
        item("Packing", "Add anything you do not want to forget.", [
          item("Essentials", "Identification, payment method, and charger."),
          item("Weather", "Clothes, umbrella, and comfortable shoes."),
        ]),
        item("Reservations and tickets", "Collect confirmation numbers and deadlines.", [
          item("Transport", "Departure time, seat, and meeting place."),
          item("Stay and admission", "Booking number, check-in, and cancellation deadline."),
        ]),
      ]);
    case "scamper":
      return root("Develop an idea", "Use the SCAMPER prompts to see one idea from different angles.", [
        item("Topic", "Describe the subject or problem in one sentence."),
        item("Substitute", "What could be replaced?"),
        item("Combine", "What could be combined to make something new?"),
        item("Adapt", "Could a mechanism from another context be borrowed?"),
        item("Modify", "Change the size, order, strength, or presentation."),
        item("Put to another use", "Could another person use it for another purpose?"),
        item("Eliminate", "What can be removed without causing a real problem?"),
        item("Reverse", "Could the order or roles be reversed?"),
        item("Next experiment", "The first small step to validate the idea.", [item("Experiment note", "What evidence would tell us whether to continue?")]),
      ]);
    case "blank":
    default:
      return root("Blank space", "Start freely from here.", []);
  }
}

function root(title: string, body: string, children: TemplateDraft[]): TemplateDraft {
  return { title, body, children, status: "waiting", color: "#d8ba58", texture: "bands" };
}

function category(title: string, childTitle: string): TemplateDraft {
  return item(title, "この場所に集めます。", [item(childTitle, "ここに詳細を書く")]);
}

function categoryEn(title: string, childTitle: string): TemplateDraft {
  return item(title, "Collect matching notes here.", [item(childTitle, "Write the details here.")]);
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
