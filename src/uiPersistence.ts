import type { AiExecutionMode, ViewportState } from "./types";

export type PersistedCommandMode = AiExecutionMode | "note";

export type PersistedCameraPose = {
  yaw: number;
  pitch: number;
  offset: number;
};

export type PersistedUiState = {
  version: 1;
  savedAt: string;
  selectedNodeId?: string;
  viewport?: ViewportState;
  cameraPose?: PersistedCameraPose;
  renderQuality?: "high" | "low";
  vrModeEnabled?: boolean;
  mobilePanelTab?: "command" | "editor";
  commandDraft?: {
    value: string;
    mode: PersistedCommandMode;
  };
};

const UI_STATE_STORAGE_KEY = "mind-atlas-ui-state-v1";
const MAX_UI_STATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadPersistedUiState(): PersistedUiState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UI_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>;
    if (parsed.version !== 1 || typeof parsed.savedAt !== "string") return null;
    if (Date.now() - new Date(parsed.savedAt).getTime() > MAX_UI_STATE_AGE_MS) return null;
    return {
      version: 1,
      savedAt: parsed.savedAt,
      selectedNodeId: typeof parsed.selectedNodeId === "string" ? parsed.selectedNodeId : undefined,
      viewport: isViewportState(parsed.viewport) ? parsed.viewport : undefined,
      cameraPose: isPersistedCameraPose(parsed.cameraPose) ? parsed.cameraPose : undefined,
      renderQuality: parsed.renderQuality === "high" || parsed.renderQuality === "low" ? parsed.renderQuality : undefined,
      vrModeEnabled: typeof parsed.vrModeEnabled === "boolean" ? parsed.vrModeEnabled : undefined,
      mobilePanelTab: parsed.mobilePanelTab === "command" || parsed.mobilePanelTab === "editor" ? parsed.mobilePanelTab : undefined,
      commandDraft: isPersistedCommandDraft(parsed.commandDraft) ? parsed.commandDraft : undefined,
    };
  } catch {
    return null;
  }
}

export function persistUiStatePatch(patch: Omit<Partial<PersistedUiState>, "version" | "savedAt">) {
  if (typeof window === "undefined") return;
  const current = loadPersistedUiState();
  const next: PersistedUiState = {
    ...(current ?? { version: 1, savedAt: new Date().toISOString() }),
    ...patch,
    version: 1,
    savedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Restoring UI state is best effort; notebook data is persisted separately.
  }
}

export function isPersistedCameraPose(value: unknown): value is PersistedCameraPose {
  const pose = value as Partial<PersistedCameraPose>;
  return Number.isFinite(pose?.yaw) && Number.isFinite(pose?.pitch) && Number.isFinite(pose?.offset);
}

function isViewportState(value: unknown): value is ViewportState {
  const viewport = value as Partial<ViewportState>;
  return Number.isFinite(viewport?.x) && Number.isFinite(viewport?.y) && Number.isFinite(viewport?.zoom);
}

function isPersistedCommandDraft(value: unknown): value is NonNullable<PersistedUiState["commandDraft"]> {
  const draft = value as Partial<NonNullable<PersistedUiState["commandDraft"]>>;
  return typeof draft?.value === "string" && isPersistedCommandMode(draft.mode);
}

function isPersistedCommandMode(value: unknown): value is PersistedCommandMode {
  return value === "openai" || value === "local" || value === "codex" || value === "openclaw" || value === "note";
}
