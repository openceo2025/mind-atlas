/**
 * Galaxy state: spaces (one notebook each), philosophy, resources, ledger and
 * judgments. The active space's tree lives in `useAtlasStore` exactly as
 * before; inactive spaces' trees live in the galaxy database. Switching a
 * space writes the outgoing tree first, then loads the incoming one, so a
 * crash between the two steps loses nothing.
 *
 * Mode: shared-core.
 */
import { create } from "zustand";
import { formatAppMessage } from "../i18n/format";
import type { AtlasNode } from "../types";
import { createBlankNotebookRoot, useAtlasStore, waitForNotebookSavesToSettle } from "../store/atlasStore";
import type { LedgerDraft } from "./galaxyQuickEntry";
import {
  deleteSpaceRoot,
  galaxyStorageAvailable,
  loadAllSpaceRoots,
  loadGalaxyState,
  saveGalaxyState,
  saveSpaceRoot,
} from "./galaxyPersistence";
import {
  GALAXY_FILE_KIND,
  GALAXY_SCHEMA_VERSION,
  type Currency,
  type GalaxyFile,
  type GalaxyResource,
  type GalaxySpace,
  type GalaxyState,
  type JudgeSettings,
  type LedgerEntry,
  type SpaceJudgment,
} from "./galaxyTypes";

export type GalaxyStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

interface GalaxyStore {
  status: GalaxyStatus;
  error: string;
  galaxy: GalaxyState | null;
  /** Trees of inactive spaces. The active tree is `useAtlasStore().atlasRoot`. */
  inactiveRoots: Record<string, AtlasNode>;
  switching: boolean;
  init: () => Promise<void>;
  rootOf: (spaceId: string) => AtlasNode | null;
  switchSpace: (spaceId: string) => Promise<void>;
  createSpace: (title: string) => Promise<string>;
  deleteSpace: (spaceId: string) => Promise<void>;
  updateSpace: (spaceId: string, patch: Partial<Omit<GalaxySpace, "id" | "createdAt">>) => void;
  setPhilosophy: (text: string) => void;
  upsertResource: (resource: GalaxyResource) => void;
  removeResource: (resourceId: string) => void;
  upsertLedgerEntry: (entry: LedgerEntry) => void;
  removeLedgerEntry: (entryId: string) => void;
  setJudgment: (judgment: SpaceJudgment) => void;
  setJudgeSettings: (patch: Partial<JudgeSettings>) => void;
  setCurrency: (currency: Currency, jpyPerUsd?: number) => void;
  exportFile: () => GalaxyFile | null;
  importFile: (file: GalaxyFile) => Promise<{ spaces: number; entries: number }>;
}

const SPACE_COLORS = ["#8df5cf", "#9fb7ff", "#ffc58f", "#f59fd0", "#c8f58d", "#8fe3ff", "#ffe08f", "#c9a7ff", "#ff9f9f", "#8fffc3"];

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function newId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** A ledger entry from a parsed line, optionally allocated to one node. */
export function draftToEntry(draft: LedgerDraft, nodeId?: string): LedgerEntry {
  const now = new Date().toISOString();
  return {
    id: newId("led"),
    date: draft.date,
    kind: draft.kind,
    amount: draft.amount,
    currency: draft.currency,
    resourceId: draft.resourceId,
    memo: draft.memo,
    allocations: draft.spaceId ? [{ spaceId: draft.spaceId, nodeId, weight: 1 }] : [],
    recurrence: draft.recurrence,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

export function colorForIndex(index: number) {
  return SPACE_COLORS[index % SPACE_COLORS.length];
}

function defaultGalaxy(activeRoot: AtlasNode): GalaxyState {
  const now = new Date().toISOString();
  const locale = typeof navigator !== "undefined" ? navigator.language : "en";
  const spaceId = newId("space");
  return {
    schemaVersion: GALAXY_SCHEMA_VERSION,
    philosophy: "",
    philosophyHistory: [],
    resources: [
      { id: newId("res"), kind: "time", name: formatAppMessage("galaxy.resources.kind.time"), hoursPerWeek: 20 },
    ],
    spaces: [
      {
        id: spaceId,
        title: activeRoot.title || "Mind Atlas",
        color: colorForIndex(0),
        decision: "undecided",
        dependsOn: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeSpaceId: spaceId,
    ledger: [],
    judgments: {},
    judge: { auto: false, backend: "jev-hosted", llamaUrl: "http://127.0.0.1:8089" },
    displayCurrency: locale.toLowerCase().startsWith("ja") ? "JPY" : "USD",
    jpyPerUsd: 150,
    updatedAt: now,
  };
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const galaxy = useGalaxyStore.getState().galaxy;
    if (!galaxy) return;
    saveGalaxyState(galaxy).catch((error) => {
      console.error("Galaxy state could not be saved.", error);
      useGalaxyStore.setState({ error: String(error instanceof Error ? error.message : error) });
    });
  }, 300);
}

function waitForNotebookReady() {
  return new Promise<void>((resolve) => {
    const check = () => {
      const status = useAtlasStore.getState().notebookPersistenceStatus;
      return status === "ready" || status === "error";
    };
    if (check()) {
      resolve();
      return;
    }
    const unsubscribe = useAtlasStore.subscribe(() => {
      if (!check()) return;
      unsubscribe();
      resolve();
    });
  });
}

export const useGalaxyStore = create<GalaxyStore>((set, get) => {
  const mutate = (change: (galaxy: GalaxyState) => GalaxyState) => {
    const galaxy = get().galaxy;
    if (!galaxy) return;
    set({ galaxy: { ...change(galaxy), updatedAt: new Date().toISOString() } });
    scheduleSave();
  };

  return {
    status: "idle",
    error: "",
    galaxy: null,
    inactiveRoots: {},
    switching: false,

    init: async () => {
      if (get().status === "loading" || get().status === "ready") return;
      if (!galaxyStorageAvailable()) {
        set({ status: "unavailable" });
        return;
      }
      set({ status: "loading", error: "" });
      try {
        await waitForNotebookReady();
        const stored = await loadGalaxyState();
        let galaxy = stored ?? defaultGalaxy(useAtlasStore.getState().atlasRoot);
        // The current notebook's stamp wins over the stored active id: a switch
        // loads the notebook first and records the active id last.
        const stamped = useAtlasStore.getState().atlasRoot.galaxySpaceId;
        if (stamped && stamped !== galaxy.activeSpaceId && galaxy.spaces.some((space) => space.id === stamped)) {
          galaxy = { ...galaxy, activeSpaceId: stamped };
          await saveGalaxyState(galaxy);
        }
        const roots = await loadAllSpaceRoots();
        delete roots[galaxy.activeSpaceId];
        set({ galaxy, inactiveRoots: roots, status: "ready" });
        if (!stored) await saveGalaxyState(galaxy);
      } catch (error) {
        console.error("Galaxy could not start.", error);
        set({ status: "error", error: String(error instanceof Error ? error.message : error) });
      }
    },

    rootOf: (spaceId) => {
      const galaxy = get().galaxy;
      if (!galaxy) return null;
      if (spaceId === galaxy.activeSpaceId) return useAtlasStore.getState().atlasRoot;
      return get().inactiveRoots[spaceId] ?? null;
    },

    switchSpace: async (spaceId) => {
      const { galaxy, inactiveRoots, switching } = get();
      if (!galaxy || switching || spaceId === galaxy.activeSpaceId) return;
      const target = inactiveRoots[spaceId];
      if (!target) throw new Error("This space has no saved tree.");
      set({ switching: true });
      try {
        await waitForNotebookSavesToSettle();
        const outgoingId = galaxy.activeSpaceId;
        const outgoing = useAtlasStore.getState().atlasRoot;
        // 1. Park the outgoing tree before anything replaces it.
        await saveSpaceRoot(outgoingId, { ...outgoing, galaxySpaceId: outgoingId });
        // 2. Load the incoming tree, stamped with its space, as the current notebook.
        const atlas = useAtlasStore.getState();
        atlas.importNotebook({ ...target, galaxySpaceId: spaceId }, undefined, {}, { requestTitleEdit: false });
        useAtlasStore.setState({ historyPast: [], historyFuture: [] });
        await waitForNotebookSavesToSettle();
        // 3. Record the new active space. If the browser stops before this,
        //    startup trusts the stamp on the current notebook instead.
        const nextGalaxy: GalaxyState = { ...galaxy, activeSpaceId: spaceId, updatedAt: new Date().toISOString() };
        await saveGalaxyState(nextGalaxy);
        void useAtlasStore.getState().restoreAttachmentPreviews();
        const nextRoots = { ...inactiveRoots, [outgoingId]: outgoing };
        delete nextRoots[spaceId];
        set({ galaxy: nextGalaxy, inactiveRoots: nextRoots });
      } finally {
        set({ switching: false });
      }
    },

    createSpace: async (title) => {
      const galaxy = get().galaxy;
      if (!galaxy) throw new Error("Galaxy is not ready.");
      const now = new Date().toISOString();
      const id = newId("space");
      const root = createBlankNotebookRoot(title);
      await saveSpaceRoot(id, root);
      set({ inactiveRoots: { ...get().inactiveRoots, [id]: root } });
      mutate((current) => ({
        ...current,
        spaces: [
          ...current.spaces,
          { id, title, color: colorForIndex(current.spaces.length), decision: "undecided", dependsOn: [], createdAt: now, updatedAt: now },
        ],
      }));
      return id;
    },

    deleteSpace: async (spaceId) => {
      const galaxy = get().galaxy;
      if (!galaxy || spaceId === galaxy.activeSpaceId) return;
      await deleteSpaceRoot(spaceId);
      const nextRoots = { ...get().inactiveRoots };
      delete nextRoots[spaceId];
      set({ inactiveRoots: nextRoots });
      mutate((current) => {
        const judgments = { ...current.judgments };
        delete judgments[spaceId];
        return {
          ...current,
          spaces: current.spaces
            .filter((space) => space.id !== spaceId)
            .map((space) => ({ ...space, dependsOn: space.dependsOn.filter((id) => id !== spaceId) })),
          judgments,
        };
      });
    },

    updateSpace: (spaceId, patch) => {
      mutate((current) => ({
        ...current,
        spaces: current.spaces.map((space) => (space.id === spaceId ? { ...space, ...patch, updatedAt: new Date().toISOString() } : space)),
      }));
      if (typeof patch.title === "string") {
        const galaxy = get().galaxy;
        const atlas = useAtlasStore.getState();
        if (galaxy?.activeSpaceId === spaceId && atlas.atlasRoot.title !== patch.title) {
          atlas.updateNode(atlas.atlasRoot.id, { title: patch.title });
        } else if (galaxy && spaceId !== galaxy.activeSpaceId) {
          const root = get().inactiveRoots[spaceId];
          if (root) {
            const renamed = { ...root, title: patch.title, subtitle: patch.title, updatedAt: new Date().toISOString() };
            set({ inactiveRoots: { ...get().inactiveRoots, [spaceId]: renamed } });
            void saveSpaceRoot(spaceId, renamed);
          }
        }
      }
    },

    setPhilosophy: (text) => {
      mutate((current) => {
        if (current.philosophy === text) return current;
        const history = current.philosophy.trim()
          ? [{ text: current.philosophy, replacedAt: new Date().toISOString() }, ...current.philosophyHistory].slice(0, 50)
          : current.philosophyHistory;
        return { ...current, philosophy: text, philosophyHistory: history };
      });
    },

    upsertResource: (resource) => {
      mutate((current) => {
        const exists = current.resources.some((item) => item.id === resource.id);
        return {
          ...current,
          resources: exists ? current.resources.map((item) => (item.id === resource.id ? resource : item)) : [...current.resources, resource],
        };
      });
    },

    removeResource: (resourceId) => {
      mutate((current) => ({
        ...current,
        resources: current.resources.filter((item) => item.id !== resourceId),
        // Entries keep their amount; they just no longer name an account.
        ledger: current.ledger.map((entry) => (entry.resourceId === resourceId ? { ...entry, resourceId: undefined } : entry)),
      }));
    },

    upsertLedgerEntry: (entry) => {
      mutate((current) => {
        const exists = current.ledger.some((item) => item.id === entry.id);
        const stamped = { ...entry, updatedAt: new Date().toISOString() };
        return {
          ...current,
          ledger: exists ? current.ledger.map((item) => (item.id === entry.id ? stamped : item)) : [...current.ledger, stamped],
        };
      });
    },

    removeLedgerEntry: (entryId) => {
      mutate((current) => ({ ...current, ledger: current.ledger.filter((item) => item.id !== entryId) }));
    },

    setJudgment: (judgment) => {
      mutate((current) => ({ ...current, judgments: { ...current.judgments, [judgment.spaceId]: judgment } }));
    },

    setJudgeSettings: (patch) => {
      mutate((current) => ({ ...current, judge: { ...current.judge, ...patch } }));
    },

    setCurrency: (currency, jpyPerUsd) => {
      mutate((current) => ({
        ...current,
        displayCurrency: currency,
        jpyPerUsd: typeof jpyPerUsd === "number" && jpyPerUsd > 0 ? jpyPerUsd : current.jpyPerUsd,
      }));
    },

    exportFile: () => {
      const galaxy = get().galaxy;
      if (!galaxy) return null;
      const roots: Record<string, AtlasNode> = { ...get().inactiveRoots, [galaxy.activeSpaceId]: useAtlasStore.getState().atlasRoot };
      const { activeSpaceId: _active, ...rest } = galaxy;
      return { kind: GALAXY_FILE_KIND, version: GALAXY_SCHEMA_VERSION, exportedAt: new Date().toISOString(), galaxy: rest, roots };
    },

    importFile: async (file) => {
      const galaxy = get().galaxy;
      if (!galaxy) throw new Error("Galaxy is not ready.");
      if (file?.kind !== GALAXY_FILE_KIND || !file.galaxy || !Array.isArray(file.galaxy.spaces)) {
        throw new Error("This is not a Mind Atlas galaxy file.");
      }
      // Merge, never replace: imported spaces are added beside existing ones.
      const idMap = new Map<string, string>();
      const existingSpaceIds = new Set(galaxy.spaces.map((space) => space.id));
      const addedSpaces: GalaxySpace[] = [];
      const nextRoots = { ...get().inactiveRoots };
      for (const [index, space] of file.galaxy.spaces.entries()) {
        const root = file.roots?.[space.id];
        if (!root) continue;
        const id = existingSpaceIds.has(space.id) ? newId("space") : space.id;
        idMap.set(space.id, id);
        await saveSpaceRoot(id, root);
        nextRoots[id] = root;
        addedSpaces.push({
          ...space,
          id,
          color: space.color || colorForIndex(galaxy.spaces.length + index),
          dependsOn: space.dependsOn ?? [],
          decision: space.decision ?? "undecided",
        });
      }
      const remap = (spaceId: string) => idMap.get(spaceId) ?? spaceId;
      const existingEntryIds = new Set(galaxy.ledger.map((entry) => entry.id));
      const existingResourceIds = new Set(galaxy.resources.map((resource) => resource.id));
      const addedEntries = (file.galaxy.ledger ?? [])
        .filter((entry) => !existingEntryIds.has(entry.id))
        .map((entry) => ({ ...entry, allocations: entry.allocations.map((allocation) => ({ ...allocation, spaceId: remap(allocation.spaceId) })) }));
      const addedResources = (file.galaxy.resources ?? []).filter((resource) => !existingResourceIds.has(resource.id));
      set({ inactiveRoots: nextRoots });
      mutate((current) => ({
        ...current,
        philosophy: current.philosophy.trim() ? current.philosophy : file.galaxy.philosophy ?? "",
        resources: [...current.resources, ...addedResources],
        spaces: [
          ...current.spaces,
          ...addedSpaces.map((space) => ({ ...space, dependsOn: space.dependsOn.map(remap) })),
        ],
        ledger: [...current.ledger, ...addedEntries],
      }));
      return { spaces: addedSpaces.length, entries: addedEntries.length };
    },
  };
});

/** Keep the active space's galaxy title in step with the notebook title. */
useAtlasStore.subscribe((state, previous) => {
  if (state.atlasRoot.title === previous.atlasRoot.title) return;
  const galaxy = useGalaxyStore.getState().galaxy;
  if (!galaxy) return;
  const active = galaxy.spaces.find((space) => space.id === galaxy.activeSpaceId);
  if (!active || active.title === state.atlasRoot.title) return;
  useGalaxyStore.setState({
    galaxy: {
      ...galaxy,
      spaces: galaxy.spaces.map((space) => (space.id === active.id ? { ...space, title: state.atlasRoot.title } : space)),
    },
  });
  scheduleSave();
});
