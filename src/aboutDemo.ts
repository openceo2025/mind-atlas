import { aboutDemoCopy, type AboutDemoCopy, type AboutDemoTextKey } from "./aboutDemoContent";
import type { AppLocale } from "./i18n/locales";
import { deriveAtlasLayoutFrame, type AtlasLayoutMode } from "./layout/atlasLayout";
import type { AtlasNode, ChatOptionsResult, ChatReasoningEffort, ChatServiceId, ChatServiceOption, NotificationPulseKind, ProviderUsageResult } from "./types";

export type AboutDemoKind = "research" | "travel" | "app";
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
const TRAVEL_TICKET_ATTACHMENT_ID = "about-travel-ticket-qr";
const TRAVEL_TICKET_ASSET_PATH = "/demo/travel-ticket-qr.svg";
const TRAVEL_TICKET_ATTACHMENT_SIZE = 3157;

export function readAboutDemoConfig(): AboutDemoConfig | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const kind = normalizeAboutDemoKind(params.get(DEMO_PARAM));
  if (!kind) return null;
  return { kind, view: normalizeAboutDemoView(params.get(VIEW_PARAM)) };
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
  return "about-research-root";
}

export function getAboutDemoNotification(config: AboutDemoConfig, locale: AppLocale): AboutDemoNotification | null {
  if (config.kind !== "travel") return null;
  const copy = aboutDemoCopy(locale);
  return { nodeId: "about-travel-ticket-pass", kind: "needs_review", title: copy.reminder };
}

export function getAboutDemoAttachmentPreviewUrls(config: AboutDemoConfig): Record<string, string> {
  return config.kind === "travel" ? { [TRAVEL_TICKET_ATTACHMENT_ID]: TRAVEL_TICKET_ASSET_PATH } : {};
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

// Landing-page samples deliberately use their own compact content catalog.
// They stay stable while the normal notebook templates continue to evolve.
export function createAboutDemoNotebook(kind: AboutDemoKind, locale: AppLocale): AtlasNode {
  const copy = aboutDemoCopy(locale);
  if (kind === "travel") return travelNotebook(copy);
  if (kind === "app") return appNotebook(copy);
  return researchNotebook(copy);
}

export function getAboutDemoChatOptions(locale: AppLocale): ChatOptionsResult {
  const copy = aboutDemoCopy(locale);
  return {
    defaultService: "openai",
    services: [
      chatService("openai", "OpenAI", "gpt-5.5", [["gpt-5.5", "GPT-5.5"], ["gpt-4o", "GPT-4o"]], copy.chatDemoDetail),
      chatService("anthropic", "Claude", "claude-fable-5", [["claude-fable-5", "Fable 5"], ["claude-opus-4-8", "Opus 4.8"]], copy.chatDemoDetail),
      chatService("deepseek", "DeepSeek", "deepseek-v4-pro", [["deepseek-v4-pro", "V4 Pro"], ["deepseek-v4-flash", "V4 Flash"]], copy.chatDemoDetail),
      chatService("glm", "GLM", "glm-4.5", [["glm-4.5", "GLM 4.5"], ["glm-4.5-air", "GLM 4.5 Air"]], copy.chatDemoDetail),
      chatService("gemini", "Gemini", "gemini-2.5-pro", [["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"]], copy.chatDemoDetail),
      chatService("grok", "Grok", "grok-4", [["grok-4", "Grok 4"], ["grok-3", "Grok 3"]], copy.chatDemoDetail),
      chatService("qwen", "Qwen", "qwen-max", [["qwen-max", "Qwen Max"], ["qwen-plus", "Qwen Plus"]], copy.chatDemoDetail),
      chatService("kimi", "Kimi", "kimi-k2", [["kimi-k2", "Kimi K2"], ["kimi-latest", "Kimi Latest"]], copy.chatDemoDetail),
      chatService("minimax", "MiniMax", "minimax-m1", [["minimax-m1", "MiniMax M1"], ["minimax-text-01", "MiniMax Text-01"]], copy.chatDemoDetail),
      chatService("composer", "Composer", "composer-pro", [["composer-pro", "Composer Pro"], ["composer-fast", "Composer Fast"]], copy.chatDemoDetail),
      chatService("mimo", "Mimo", "mimo-pro", [["mimo-pro", "Mimo Pro"], ["mimo-flash", "Mimo Flash"]], copy.chatDemoDetail),
    ],
  };
}

export function getAboutDemoProviderUsage(locale: AppLocale): ProviderUsageResult {
  const copy = aboutDemoCopy(locale);
  return {
    fetchedAt: DEMO_DATE,
    metrics: [{
      id: "about-demo-ai-token", vendor: "mind-atlas", vendorLabel: "Mind Atlas Pro", kind: "balance", label: copy.aiTokenLabel,
      available: true, displayValue: "68%", value: 68, unit: "percent", barPercent: 68, detail: copy.aiTokenDetail, source: "demo", defaultVisible: true,
    }],
  };
}

function normalizeAboutDemoKind(value: string | null): AboutDemoKind | null {
  return value === "research" || value === "travel" || value === "app" ? value : null;
}

function normalizeAboutDemoView(value: string | null): AboutDemoView {
  return value === "mind-map" || value === "tree" || value === "editor" ? value : "atlas";
}

function researchNotebook(copy: AboutDemoCopy) {
  return root("about-research-root", "research.root", copy.researchBody, "#d9cc72", copy, [
    note("about-research-options", "research.options", copy, { color: "#8bbdd8", texture: "mist", children: [
      note("about-research-lightweight", "research.lightweight", copy, { color: "#79b8df", children: [note("about-research-price", "research.price", copy, { color: "#8fcff0" })] }),
    ] }),
    note("about-research-criteria", "research.criteria", copy, { color: "#d1b34d", texture: "bands", children: [note("about-research-battery", "research.battery", copy, { color: "#c8a742" })] }),
    note("about-research-findings", "research.findings", copy, { color: "#75c7a1", texture: "cell", children: [note("about-research-next-check", "research.nextCheck", copy, { color: "#64b790" })] }),
  ]);
}

function travelNotebook(copy: AboutDemoCopy) {
  const reminderAt = new Date(Date.now() - 60_000).toISOString();
  return root("about-travel-root", "travel.root", copy.travelBody, "#87c9e6", copy, [
    note("about-travel-activities", "travel.activities", copy, { color: "#78b8ef", texture: "mist", children: [
      note("about-travel-scenery", "travel.scenery", copy, { color: "#78c6ef", children: [note("about-travel-morning", "travel.morningView", copy, { color: "#a5d9f5" })] }),
    ] }),
    note("about-travel-tickets", "travel.tickets", copy, { color: "#e0bd65", texture: "bands", children: [
      note("about-travel-ticket-pass", "travel.travelPass", copy, { color: "#e8cc78", texture: "bands", status: "needs_review", nextDecision: copy.ticketDecision, reminderAt, reminderFiredAt: new Date().toISOString(), attachments: [travelTicketAttachment(copy)] }),
    ] }),
    note("about-travel-itinerary", "travel.itinerary", copy, { color: "#88d7a8", texture: "speckled", children: [
      note("about-travel-day1", "travel.day1", copy, { color: "#82cfa3", texture: "cell", children: [note("about-travel-day1-schedule", "travel.schedule", copy, { color: "#9addb4" })] }),
      note("about-travel-day2", "travel.day2", copy, { color: "#79c997", texture: "cell", children: [note("about-travel-day2-schedule", "travel.schedule", copy, { color: "#97dcb1" })] }),
    ] }),
  ]);
}

function appNotebook(copy: AboutDemoCopy) {
  return root("about-app-root", "app.root", copy.appBody, "#9fd8ff", copy, [
    note("about-app-plan", "app.plan", copy, { color: "#80d2a6", texture: "speckled", status: "done", children: [
      note("about-app-users", "app.users", copy, { color: "#93dfb7", status: "done", children: [note("about-app-needs", "app.needs", copy, { color: "#6dc796" })] }),
    ] }),
    note("about-app-design", "app.design", copy, { color: "#e4c565", texture: "bands", status: "done", children: [note("about-app-screen", "app.screen", copy, { color: "#ecd27e", status: "done" })] }),
    note("about-app-build", "app.build", copy, { color: "#83bdf7", texture: "mist", children: [note("about-app-core", "app.core", copy, { color: "#9ccdf8", status: "running" })] }),
    note("about-app-release", "app.release", copy, { color: "#ef9c89", texture: "craters", children: [note("about-app-test", "app.test", copy, { color: "#f2ad9c" })] }),
  ]);
}

function chatService(id: ChatServiceId, label: string, defaultModel: string, models: Array<[string, string]>, detail: string): ChatServiceOption {
  const efforts: ChatReasoningEffort[] = ["default"];
  return { id, label, configured: true, defaultModel, defaultReasoningEffort: "default", supportedReasoningEfforts: efforts, detail, models: models.map(([model, displayName]) => ({ model, displayName, defaultReasoningEffort: "default", supportedReasoningEfforts: [...efforts] })) };
}

function root(id: string, key: AboutDemoTextKey, body: string, color: string, copy: AboutDemoCopy, children: AtlasNode[]): AtlasNode {
  const title = copy.titles[key];
  return { id, kind: "root", nodeType: "note", title, subtitle: title, body, author: "human", status: "waiting", color, texture: "mist", radius: 62, summary: body, nextDecision: copy.nextDecision, tags: ["about-demo"], attachments: [], createdAt: DEMO_DATE, updatedAt: DEMO_DATE, children };
}

function note(id: string, key: AboutDemoTextKey, copy: AboutDemoCopy, options: Partial<Pick<AtlasNode, "color" | "texture" | "status" | "summary" | "nextDecision" | "reminderAt" | "reminderFiredAt" | "attachments" | "children">> = {}): AtlasNode {
  const title = copy.titles[key];
  const body = copy.nodeBody;
  return { id, kind: "thread", nodeType: "note", title, subtitle: title, body, author: "human", status: options.status ?? "waiting", color: options.color ?? "#d8f56d", texture: options.texture ?? "speckled", radius: options.children?.length ? 34 : 24, summary: options.summary ?? body, nextDecision: options.nextDecision ?? copy.nextDecision, tags: ["about-demo"], attachments: options.attachments ?? [], createdAt: DEMO_DATE, updatedAt: DEMO_DATE, reminderAt: options.reminderAt, reminderFiredAt: options.reminderFiredAt, children: options.children ?? [] };
}

function travelTicketAttachment(copy: AboutDemoCopy): AtlasNode["attachments"][number] {
  return { id: TRAVEL_TICKET_ATTACHMENT_ID, name: "travel-pass-qr.svg", kind: "image", mimeType: "image/svg+xml", size: TRAVEL_TICKET_ATTACHMENT_SIZE, path: TRAVEL_TICKET_ASSET_PATH, assetPath: TRAVEL_TICKET_ASSET_PATH, createdAt: DEMO_DATE };
}
