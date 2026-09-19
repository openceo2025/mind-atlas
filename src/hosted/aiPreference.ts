import type { ChatSettings, HostedAiPreference, HostedServiceSession } from "../types";
import { isHostedServiceMode, saveHostedAiPreference } from "./serviceClient";

// The AI model a signed-in user last chose, kept on their account so it follows them to
// other devices and to the spatial beta. Node-level AI settings in a notebook still win.

let preference: HostedAiPreference | null = null;
let signedIn = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(preference: HostedAiPreference | null) => void>();

export function syncAccountAiPreference(session: HostedServiceSession | null) {
  const nextSignedIn = Boolean(session?.authenticated);
  const next = nextSignedIn ? session?.aiPreference ?? null : null;
  const changed = nextSignedIn !== signedIn || JSON.stringify(next) !== JSON.stringify(preference);
  signedIn = nextSignedIn;
  preference = next;
  if (changed) for (const listener of listeners) listener(preference);
}

export function getAccountAiPreference() {
  return signedIn ? preference : null;
}

/** The account choice as chat settings, or null when signed out or nothing is saved yet. */
export function accountChatSettings(): ChatSettings | null {
  const current = getAccountAiPreference();
  if (!current?.provider) return null;
  return {
    service: current.provider as ChatSettings["service"],
    model: current.model,
    reasoningEffort: (current.reasoningEffort || "default") as ChatSettings["reasoningEffort"],
  };
}

export function subscribeAccountAiPreference(listener: (preference: HostedAiPreference | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rememberAccountAiPreference(settings: Pick<ChatSettings, "service" | "model" | "reasoningEffort">) {
  if (!isHostedServiceMode() || !signedIn || settings.service === "local") return;
  const next = { provider: settings.service, model: settings.model, reasoningEffort: settings.reasoningEffort };
  if (preference && preference.provider === next.provider && preference.model === next.model && preference.reasoningEffort === next.reasoningEffort) return;
  preference = { ...next };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveHostedAiPreference(next).catch(() => undefined);
  }, 600);
}
