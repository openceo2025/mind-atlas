import { deriveAtlasLayoutFrame, type AtlasLayoutMode } from "./layout/atlasLayout";
import type { AtlasNode, ChatOptionsResult, ChatReasoningEffort, ChatServiceId, ChatServiceOption, NotificationPulseKind, ProviderUsageResult } from "./types";

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

export interface AboutDemoFocusRequest {
  x: number;
  y: number;
  z: number;
  diameter: number;
  nodeId?: string;
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
  if (config.kind === "travel") return "about-travel-root";
  if (config.kind === "app") return "about-app-root";
  return "about-novel-root";
}

export function getAboutDemoNotification(config: AboutDemoConfig): AboutDemoNotification | null {
  if (config.kind !== "travel") return null;
  return {
    nodeId: "about-travel-ticket-pass",
    kind: "needs_review",
    title: "Reminder: チケットを確認",
  };
}

export function getAboutDemoOverviewFocusRequest(root: AtlasNode, config: AboutDemoConfig): AboutDemoFocusRequest | null {
  if (config.view !== "atlas") return null;
  const frame = deriveAtlasLayoutFrame(root, "phyllotaxis");
  const width = frame.bounds.maxX - frame.bounds.minX;
  const height = frame.bounds.maxY - frame.bounds.minY;
  const depth = frame.bounds.maxZ - frame.bounds.minZ;
  return {
    x: (frame.bounds.minX + frame.bounds.maxX) / 2,
    y: (frame.bounds.minY + frame.bounds.maxY) / 2,
    z: (frame.bounds.minZ + frame.bounds.maxZ) / 2,
    diameter: Math.max(width, height, depth * 0.7, 520) + 220,
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

export function getAboutDemoChatOptions(): ChatOptionsResult {
  return {
    defaultService: "openai",
    services: [
      chatService("openai", "OpenAI", "gpt-5.5", [
        ["gpt-5.5", "GPT-5.5"],
        ["gpt-4o", "GPT-4o"],
      ]),
      chatService("anthropic", "Claude", "claude-fable-5", [
        ["claude-fable-5", "Fable 5"],
        ["claude-opus-4-8", "Opus 4.8"],
      ]),
      chatService("deepseek", "DeepSeek", "deepseek-v4-pro", [
        ["deepseek-v4-pro", "V4 Pro"],
        ["deepseek-v4-flash", "V4 Flash"],
      ]),
      chatService("glm", "GLM", "glm-4.5", [
        ["glm-4.5", "GLM 4.5"],
        ["glm-4.5-air", "GLM 4.5 Air"],
        ["glm-z1-air", "GLM Z1 Air"],
      ]),
      chatService("gemini", "Gemini", "gemini-2.5-pro", [
        ["gemini-2.5-pro", "Gemini 2.5 Pro"],
        ["gemini-2.5-flash", "Gemini 2.5 Flash"],
        ["gemini-2.0-flash", "Gemini 2.0 Flash"],
      ]),
      chatService("grok", "Grok", "grok-4", [
        ["grok-4", "Grok 4"],
        ["grok-3", "Grok 3"],
        ["grok-3-mini", "Grok 3 Mini"],
      ]),
      chatService("qwen", "Qwen", "qwen-max", [
        ["qwen-max", "Qwen Max"],
        ["qwen-plus", "Qwen Plus"],
        ["qwen3-coder", "Qwen3 Coder"],
      ]),
      chatService("kimi", "Kimi", "kimi-k2", [
        ["kimi-k2", "Kimi K2"],
        ["kimi-latest", "Kimi Latest"],
      ]),
      chatService("minimax", "MiniMax", "minimax-m1", [
        ["minimax-m1", "MiniMax M1"],
        ["minimax-text-01", "MiniMax Text-01"],
      ]),
      chatService("composer", "Composer", "composer-pro", [
        ["composer-pro", "Composer Pro"],
        ["composer-fast", "Composer Fast"],
      ]),
      chatService("mimo", "Mimo", "mimo-pro", [
        ["mimo-pro", "Mimo Pro"],
        ["mimo-flash", "Mimo Flash"],
      ]),
    ],
  };
}

export function getAboutDemoProviderUsage(): ProviderUsageResult {
  return {
    fetchedAt: DEMO_DATE,
    metrics: [
      {
        id: "about-demo-ai-token",
        vendor: "mind-atlas",
        vendorLabel: "Mind Atlas Pro",
        kind: "balance",
        label: "AIトークン残高",
        available: true,
        displayValue: "68%",
        value: 68,
        unit: "percent",
        barPercent: 68,
        detail: "Googleアカウント登録と月$10のMind Atlas ProプランでAI機能が解放されます。",
        source: "demo",
        defaultVisible: true,
      },
    ],
  };
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
  return rootNode("about-novel-root", "夜明けの古書店", "閉店後にだけ開く古書店を舞台に、登場人物、章、伏線を同じ宇宙で見渡す小説ノートです。", "#d9cc72", [
    node("about-novel-cast", "登場人物", "人物の目的、秘密、関係性を枝として残します。", {
      color: "#8bbdd8",
      texture: "mist",
      children: [
        node("about-novel-hero", "主人公", "未来の日付が入った日記を最初に見つける新人店員。", {
          color: "#79b8df",
          texture: "speckled",
          children: [
            node("about-novel-hero-goal", "目的", "日記の最後の空白ページを埋める方法を探す。", { color: "#8fcff0" }),
            node("about-novel-hero-fear", "弱点", "過去の失敗を思い出す場所には近づけない。", { color: "#6fa7c8", texture: "freckles" }),
          ],
        }),
        node("about-novel-owner", "店主", "同じ日記を一度だけ読んだことがある。", {
          color: "#a887d5",
          texture: "freckles",
          children: [
            node("about-novel-owner-secret", "隠していること", "本棚の奥に一冊だけ売れない本を残している。", { color: "#8b6ec8" }),
          ],
        }),
        node("about-novel-visitor", "謎の客", "未来の日付で予約を入れてくる常連客。", { color: "#da846d", texture: "craters" }),
      ],
    }),
    node("about-novel-act1", "第1章", "日記の発見から、閉店後の古書店が別の時間につながっていると気づくまで。", {
      color: "#d1b34d",
      texture: "bands",
      children: [
        node("about-novel-scene-open", "開店準備", "棚卸し中に、まだ起きていない出来事が書かれた日記を見つける。", { color: "#c8a742" }),
        node("about-novel-scene-bell", "閉店のベル", "ベルが鳴った瞬間、外の時計だけが朝に戻る。", { color: "#b89035" }),
      ],
    }),
    node("about-novel-act2", "第2章", "日記が予言ではなく、選ばなかった可能性の記録だと分かる。", {
      color: "#75c7a1",
      texture: "cell",
      children: [
        node("about-novel-scene-clock", "時を戻す針", "古い懐中時計が、日記のページ数と同じ回数だけ逆回転する。", { color: "#64b790" }),
        node("about-novel-scene-map", "街の地図", "古書店の周囲だけ、地図にない路地が増えている。", { color: "#55a983" }),
      ],
    }),
    node("about-novel-ending", "結末", "本を開くか閉じるかで、主人公が守る未来が変わる。", {
      color: "#e98775",
      texture: "craters",
      status: "needs_review",
      children: [
        node("about-novel-ending-a", "余韻", "最後のページに読者の今日の日付だけが残る。", { color: "#ef9c89" }),
      ],
    }),
  ]);
}

function travelNotebook() {
  const reminderAt = new Date(Date.now() - 60_000).toISOString();
  return rootNode("about-travel-root", "旅行計画", "やりたいこと、チケット、当日の流れをまとめて見渡す旅行ノートです。", "#87c9e6", [
    node("about-travel-wants", "やりたいこと", "旅先で試したいことを先に浮かせます。", {
      color: "#78b8ef",
      texture: "mist",
      children: [
        node("about-travel-view", "景色を見る", "朝と夕方で候補を分けておく。", {
          color: "#78c6ef",
          children: [
            node("about-travel-view-morning", "朝の散歩", "混む前に歩ける場所を選ぶ。", { color: "#a5d9f5" }),
            node("about-travel-view-night", "夜の眺め", "帰り道から無理なく寄れる場所にする。", { color: "#6faed8" }),
          ],
        }),
        node("about-travel-food", "食事", "予約が必要な店と、気軽に入る店を分ける。", { color: "#e0bd65", texture: "bands" }),
        node("about-travel-shopping", "買い物", "お土産と自分用を別ノードにする。", { color: "#bf96dc", texture: "freckles" }),
      ],
    }),
    node("about-travel-tickets", "チケット類", "移動、宿泊、入場予約を一か所で確認します。", {
      color: "#e0bd65",
      texture: "bands",
      children: [
        node("about-travel-ticket-pass", "交通チケット", "出発前にQRコードと座席を確認する。", {
          color: "#e8cc78",
          texture: "bands",
          status: "needs_review",
          nextDecision: "出発前にチケットを確認する。",
          reminderAt,
          reminderFiredAt: new Date().toISOString(),
        }),
        node("about-travel-hotel", "宿泊予約", "チェックイン時間と荷物預けをメモする。", { color: "#d7b35b" }),
        node("about-travel-entry", "入場予約", "時間指定がある予定だけ通知対象にする。", { color: "#f0d990" }),
      ],
    }),
    node("about-travel-plan", "計画", "1日目と2日目を分けて、予定の詰めすぎを避けます。", {
      color: "#88d7a8",
      texture: "speckled",
      children: [
        node("about-travel-day1", "1日目", "到着から夕食までの流れ。", {
          color: "#82cfa3",
          texture: "cell",
          children: [
            node("about-travel-day1-am", "午前", "移動と荷物預け。", { color: "#9addb4" }),
            node("about-travel-day1-pm", "午後", "散歩とカフェ。", { color: "#7cc896" }),
            node("about-travel-day1-night", "夜", "夕食後は近場だけにする。", { color: "#64b47f" }),
          ],
        }),
        node("about-travel-day2", "2日目", "帰る前に残したい予定を少なめに置く。", {
          color: "#79c997",
          texture: "cell",
          children: [
            node("about-travel-day2-am", "午前", "景色を見る。", { color: "#97dcb1" }),
            node("about-travel-day2-pm", "午後", "買い物と帰路。", { color: "#6fbc89" }),
          ],
        }),
      ],
    }),
  ]);
}

function appNotebook() {
  return rootNode("about-app-root", "個人アプリ開発", "Googleアカウント登録と月$10のMind Atlas ProプランでAI機能が解放されます。AI相談はノードとして残せます。", "#9fd8ff", [
    node("about-app-auth", "Googleアカウント登録", "Google OAuthでユーザー登録とセッションを作ります。", {
      color: "#80d2a6",
      texture: "speckled",
      status: "done",
      children: [
        node("about-app-auth-callback", "ログイン確認", "戻りURL、Cookie、セッションAPIを確認する。", { color: "#93dfb7", status: "done" }),
        node("about-app-auth-profile", "ユーザー情報", "メールアドレスと表示名をアカウントに紐づける。", { color: "#6dc796", status: "done" }),
      ],
    }),
    node("about-app-pro", "Mind Atlas Pro", "月$10のプランでAIトークンを付与します。", {
      color: "#e4c565",
      texture: "bands",
      status: "done",
      children: [
        node("about-app-stripe", "Stripe Billing", "Checkout、Webhook、サブスク状態を同期する。", { color: "#ecd27e", status: "done" }),
        node("about-app-credit", "AIトークン残高", "利用前に予約し、実使用量で精算する。", { color: "#d7b64b", status: "running" }),
      ],
    }),
    node("about-app-ai", "AI相談", "Chatで設計を相談し、返答をこの宇宙のノードとして残します。", {
      color: "#b5a0ff",
      texture: "freckles",
      status: "running",
      children: [
        node("about-app-ai-models", "モデル選択", "OpenAI、Claude、DeepSeekなどを切り替える。", { color: "#c1adff" }),
        node("about-app-ai-log", "AI Partner log", "会話とツール実行をあとから読み返す。", { color: "#a691ed" }),
      ],
    }),
    node("about-app-sprint", "実装タスク", "公開前にUI、料金説明、エラー文言を磨きます。", {
      color: "#83bdf7",
      texture: "mist",
      status: "waiting",
      children: [
        node("about-app-task-about", "紹介ページ", "触れるサンプルで魅力を伝える。", { color: "#9ccdf8", status: "running" }),
        node("about-app-task-mobile", "モバイル確認", "小さい画面でパネルが重ならないか確認する。", { color: "#7bb2e8" }),
        node("about-app-task-cost", "価格調整", "モデル価格と上限を現実のAPI価格に合わせる。", { color: "#6aa3dc" }),
      ],
    }),
  ]);
}

function chatService(id: ChatServiceId, label: string, defaultModel: string, models: Array<[string, string]>): ChatServiceOption {
  const defaultEfforts: ChatReasoningEffort[] = ["default"];
  return {
    id,
    label,
    configured: true,
    defaultModel,
    defaultReasoningEffort: "default",
    supportedReasoningEfforts: defaultEfforts,
    models: models.map(([model, displayName]) => ({
      model,
      displayName,
      defaultReasoningEffort: "default",
      supportedReasoningEfforts: [...defaultEfforts],
    })),
    detail: "Landing page demo",
  };
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
    nextDecision: "Mind Atlasを開いて、自分の宇宙を作り始める。",
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
    radius: options.children?.length ? 34 : 24,
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
