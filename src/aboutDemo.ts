import type { AtlasNode, NotificationPulseKind } from "./types";
import type { AtlasLayoutMode } from "./layout/atlasLayout";

export type AboutDemoKind = "novel" | "travel" | "app";
export type AboutDemoView = "atlas" | "mind-map" | "tree" | "editor";

export interface AboutDemoConfig {
  kind: AboutDemoKind;
  view: AboutDemoView;
}

export interface AboutDemoNotification {
  nodeId: string;
  kind: NotificationPulseKind;
  title: string;
}

const DEMO_PARAM = "aboutDemo";
const VIEW_PARAM = "aboutView";
const DEMO_DATE = "2026-07-05T00:00:00.000Z";

export function readAboutDemoConfig(): AboutDemoConfig | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const kind = normalizeAboutDemoKind(params.get(DEMO_PARAM));
  if (!kind) return null;
  return {
    kind,
    view: normalizeAboutDemoView(params.get(VIEW_PARAM)),
  };
}

export function isAboutDemoMode() {
  return readAboutDemoConfig() !== null;
}

export function getAboutDemoLayoutMode(config: AboutDemoConfig): AtlasLayoutMode {
  if (config.view === "tree") return "tree";
  if (config.view === "mind-map") return "mind-map";
  return "phyllotaxis";
}

export function getAboutDemoSelectedNodeId(config: AboutDemoConfig) {
  if (config.kind === "travel") return "about-travel-train";
  if (config.kind === "app") return "about-app-sprint";
  if (config.view === "editor") return "about-novel-root";
  return "about-novel-bookshop";
}

export function getAboutDemoNotification(config: AboutDemoConfig): AboutDemoNotification | null {
  if (config.kind !== "travel") return null;
  return {
    nodeId: "about-travel-train",
    kind: "needs_review",
    title: "Reminder: 新幹線を予約",
  };
}

export function createAboutDemoNotebook(kind: AboutDemoKind): AtlasNode {
  switch (kind) {
    case "travel":
      return travelNotebook();
    case "app":
      return appNotebook();
    case "novel":
    default:
      return novelNotebook();
  }
}

function normalizeAboutDemoKind(value: string | null): AboutDemoKind | null {
  if (value === "novel" || value === "travel" || value === "app") return value;
  return null;
}

function normalizeAboutDemoView(value: string | null): AboutDemoView {
  if (value === "mind-map" || value === "tree" || value === "editor") return value;
  return "atlas";
}

function novelNotebook() {
  return rootNode("about-novel-root", "夜明けの古書店", "三つの視点で進む短編小説の設計図。", "#d9cc72", [
    node("about-novel-bookshop", "古書店の夜", "閉店後、棚の奥から一冊だけ未来の日付が入った日記が見つかる。", {
      color: "#d1b34d",
      texture: "bands",
      summary: "導入。読者に最初の謎を渡す場面。",
      children: [
        node("about-novel-diary", "未来の日記", "日記には明日の客の名前と、まだ起きていない停電が書かれている。", {
          color: "#8bbdd8",
          texture: "mist",
          summary: "事件の種。",
        }),
        node("about-novel-owner", "店主の秘密", "店主は同じ日記を過去にも一度だけ見たことがある。", {
          color: "#a887d5",
          texture: "freckles",
          summary: "主人公の内面。",
        }),
      ],
    }),
    node("about-novel-clock", "時を戻す針", "古い柱時計だけが、日記の時間と同じタイミングで逆回転する。", {
      color: "#75c7a1",
      texture: "cell",
      summary: "第2章。仕掛けの発見。",
    }),
    node("about-novel-ending", "朝の一行", "最後のページには、店を開けるか閉めるかだけが空欄で残されている。", {
      color: "#da846d",
      texture: "craters",
      status: "needs_review",
      summary: "結末候補。読後感を決める分岐。",
    }),
  ]);
}

function travelNotebook() {
  const reminderAt = new Date(Date.now() - 60_000).toISOString();
  return rootNode("about-travel-root", "京都週末旅行", "移動、予約、当日の余白をひとつの宇宙にまとめる。", "#87c9e6", [
    node("about-travel-train", "新幹線を予約", "金曜 19:03 東京発。窓側席とスマートEXの通知を確認する。", {
      color: "#78b8ef",
      texture: "mist",
      status: "needs_review",
      summary: "通知が立っているタスク。",
      nextDecision: "今日中に予約を確定する。",
      reminderAt,
      reminderFiredAt: new Date().toISOString(),
    }),
    node("about-travel-hotel", "町家ホテル", "チェックイン後に荷物を置いて、鴨川まで歩ける場所にする。", {
      color: "#e0bd65",
      texture: "bands",
      summary: "宿泊候補。",
    }),
    node("about-travel-route", "朝の散歩", "喫茶店、古書店、庭園を90分で回る軽いルート。", {
      color: "#88d7a8",
      texture: "speckled",
      children: [
        node("about-travel-coffee", "喫茶店", "朝8時開店。混む前に入る。", { color: "#bd8f62", texture: "freckles" }),
        node("about-travel-garden", "庭園", "写真よりも座ってメモする時間を取る。", { color: "#7bbf94", texture: "cell" }),
      ],
    }),
  ]);
}

function appNotebook() {
  return rootNode("about-app-root", "個人アプリ開発", "課金前提のAI相談をノードごとに残す開発ボード。", "#9fd8ff", [
    node("about-app-sprint", "今週の実装", "公開ページ、ログイン、決済、AIプロキシの順で小さく出す。", {
      color: "#83bdf7",
      texture: "mist",
      status: "running",
      summary: "AIに相談しながら進める単位。",
      nextDecision: "紹介ページのデモを軽くする。",
      children: [
        node("about-app-auth", "Google OAuth", "ユーザー登録とセッション確認を本番URLで通す。", {
          color: "#80d2a6",
          texture: "speckled",
          status: "done",
        }),
        node("about-app-billing", "Stripe Billing", "月額プランとwebhookでAIトークンを付与する。", {
          color: "#e4c565",
          texture: "bands",
          status: "done",
        }),
      ],
    }),
    node("about-app-ai", "AI相談ログ", "Chatで方針を相談し、返答はこの宇宙の新しい枝として残す。", {
      color: "#b5a0ff",
      texture: "freckles",
      status: "waiting",
      summary: "実リクエストは紹介ページでは無効。",
    }),
  ]);
}

function rootNode(id: string, title: string, body: string, color: string, children: AtlasNode[]): AtlasNode {
  return {
    id,
    kind: "root",
    nodeType: "note",
    title,
    subtitle: title,
    body,
    author: "human",
    status: "waiting",
    color,
    texture: "mist",
    radius: 62,
    summary: body,
    nextDecision: "Scroll the introduction page, then open Mind Atlas.",
    tags: ["about-demo"],
    attachments: [],
    createdAt: DEMO_DATE,
    updatedAt: DEMO_DATE,
    children,
  };
}

function node(
  id: string,
  title: string,
  body: string,
  options: Partial<Pick<AtlasNode, "color" | "texture" | "status" | "summary" | "nextDecision" | "reminderAt" | "reminderFiredAt" | "children">> = {},
): AtlasNode {
  return {
    id,
    kind: "thread",
    nodeType: "note",
    title,
    subtitle: title,
    body,
    author: "human",
    status: options.status ?? "waiting",
    color: options.color ?? "#d8f56d",
    texture: options.texture ?? "speckled",
    radius: 28,
    summary: options.summary ?? body.slice(0, 120),
    nextDecision: options.nextDecision ?? "",
    tags: ["about-demo"],
    attachments: [],
    createdAt: DEMO_DATE,
    updatedAt: DEMO_DATE,
    reminderAt: options.reminderAt,
    reminderFiredAt: options.reminderFiredAt,
    children: options.children ?? [],
  };
}
