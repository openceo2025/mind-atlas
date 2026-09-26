/**
 * Keeps judgments current while the app is open. A space is re-judged when
 * what the judge reads has changed; the active space waits until editing
 * has been quiet for a while, so typing does not trigger a request per key.
 * One request runs at a time. Failures back off and keep the old answers.
 *
 * Mode: shared-core. Which backend is allowed is decided by
 * `resolveJudgeAvailability` from the current mode.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { HostedServiceSession } from "../types";
import { isHostedServiceMode } from "../hosted/serviceClient";
import { useAtlasStore } from "../store/atlasStore";
import {
  fetchLocalJudgeStatus,
  hostedJudgeAvailability,
  judgeHash,
  judgeSpace,
  localJudgeAvailability,
  type JudgeAvailability,
  type LocalJudgeStatus,
} from "./galaxyJudge";
import { useGalaxyStore } from "./galaxyStore";

const QUIET_MS = 15_000;
const TICK_MS = 4_000;
const BACKOFF_MS = 90_000;

interface JudgeRuntime {
  availability: JudgeAvailability;
  localStatus: LocalJudgeStatus | null;
  runningSpaceId: string | null;
  lastError: string;
  backoffUntil: number;
  setAvailability: (availability: JudgeAvailability, localStatus?: LocalJudgeStatus | null) => void;
}

export const useJudgeRuntime = create<JudgeRuntime>((set) => ({
  availability: { available: false, reason: isHostedServiceMode() ? "hosted_sign_in" : "bridge_offline" },
  localStatus: null,
  runningSpaceId: null,
  lastError: "",
  backoffUntil: 0,
  setAvailability: (availability, localStatus) => set((state) => ({ availability, localStatus: localStatus === undefined ? state.localStatus : localStatus })),
}));

let lastEditAt = Date.now();
useAtlasStore.subscribe((state, previous) => {
  if (state.atlasRoot !== previous.atlasRoot) lastEditAt = Date.now();
});

/** Judge one space now. Resolves with an error message, or "" on success. */
export async function runJudge(spaceId: string): Promise<string> {
  const runtime = useJudgeRuntime.getState();
  const galaxyStore = useGalaxyStore.getState();
  const galaxy = galaxyStore.galaxy;
  const space = galaxy?.spaces.find((item) => item.id === spaceId);
  if (!galaxy || !space) return "missing";
  if (!runtime.availability.available) return runtime.availability.reason;
  if (runtime.runningSpaceId) return "busy";
  useJudgeRuntime.setState({ runningSpaceId: spaceId });
  try {
    const judgment = await judgeSpace(galaxy, space, galaxyStore.rootOf(spaceId), runtime.availability.backend);
    useGalaxyStore.getState().setJudgment(judgment);
    useJudgeRuntime.setState({ lastError: "" });
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const previous = useGalaxyStore.getState().galaxy?.judgments[spaceId];
    if (previous) useGalaxyStore.getState().setJudgment({ ...previous, error: message });
    useJudgeRuntime.setState({ lastError: message, backoffUntil: Date.now() + BACKOFF_MS });
    return message;
  } finally {
    useJudgeRuntime.setState({ runningSpaceId: null });
  }
}

/** Mount once. Tracks which judge is usable and runs automatic judging. */
export function useGalaxyJudgeRunner(hostedSession: HostedServiceSession | null) {
  const status = useGalaxyStore((state) => state.status);
  const backend = useGalaxyStore((state) => state.galaxy?.judge.backend);
  const llamaUrl = useGalaxyStore((state) => state.galaxy?.judge.llamaUrl);
  const auto = useGalaxyStore((state) => state.galaxy?.judge.auto ?? false);

  useEffect(() => {
    if (status !== "ready") return;
    if (isHostedServiceMode()) {
      useJudgeRuntime.getState().setAvailability(hostedJudgeAvailability(hostedSession), null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const local = await fetchLocalJudgeStatus(llamaUrl ?? "http://127.0.0.1:8089");
      if (cancelled) return;
      const chosen = backend === "llama-local" ? "llama-local" : "jev-local";
      useJudgeRuntime.getState().setAvailability(localJudgeAvailability(local, chosen), local);
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backend, hostedSession, llamaUrl, status]);

  useEffect(() => {
    if (status !== "ready" || !auto) return;
    const timer = window.setInterval(() => {
      const runtime = useJudgeRuntime.getState();
      if (!runtime.availability.available || runtime.runningSpaceId || Date.now() < runtime.backoffUntil) return;
      const galaxyStore = useGalaxyStore.getState();
      const galaxy = galaxyStore.galaxy;
      if (!galaxy || galaxyStore.switching) return;
      const due = galaxy.spaces.find((space) => {
        const root = galaxyStore.rootOf(space.id);
        const judgment = galaxy.judgments[space.id];
        if (judgment && judgment.contentHash === judgeHash(galaxy, space, root)) return false;
        if (space.id === galaxy.activeSpaceId && Date.now() - lastEditAt < QUIET_MS) return false;
        return true;
      });
      if (due) void runJudge(due.id);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [auto, status]);
}
