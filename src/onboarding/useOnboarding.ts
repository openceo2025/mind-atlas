import { useCallback, useEffect, useMemo, useState } from "react";
import { isAboutDemoMode } from "../aboutDemo";
import { ONBOARDING_EVENT } from "../events";
import { useMessage, useMindAtlasLocale } from "../i18n/I18nProvider";
import type { AppLocale } from "../i18n/locales";
import { useAtlasStore } from "../store/atlasStore";
import type { AtlasNode } from "../types";
import { ONBOARDING_MESSAGE_IDS, type OnboardingMessageId } from "./localization";

export type OnboardingEventType =
  | "root-birth-start"
  | "root-node-created"
  | "root-birth-blocked-zoom"
  | "node-editor-opened"
  | "node-text-edited"
  | "node-editor-closed"
  | "pan"
  | "home-logo-clicked"
  | "all-nodes-offscreen"
  | "nodes-onscreen"
  | "zoom"
  | "node-drag"
  | "child-node-created";

export type SpaceStepId = "nodeEdit" | "nodeCount";

type OnboardingProgress = {
  version: 1;
  firstRun: boolean;
  rootNodeCreated: boolean;
  nodeEditorOpened: boolean;
  nodeEditCompleted: boolean;
  nodeCountReached: boolean;
  pan: boolean;
  zoom: boolean;
  nodeDrag: boolean;
  childNodeCreated: boolean;
  spaceBasicsCompleted: boolean;
  basicCompleted: boolean;
  aiUnlocked: boolean;
  titlePromptApplied: boolean;
  startedAt: string;
  completedAt?: string;
};

export type OnboardingState = {
  locale: AppLocale;
  message: string;
  messageId: OnboardingMessageId | null;
  titlePrompt: string;
  showLogoOnly: boolean;
  showMainChrome: boolean;
  showRootPulse: boolean;
  showNodeCreationControls: boolean;
  showEditorDuringTutorial: boolean;
  readyForCompletion: boolean;
  showAiFeatures: boolean;
  shouldApplyUniverseTitlePrompt: boolean;
  startTutorialMode: () => void;
  completeTutorial: () => void;
  acknowledgeTutorialCompletion: () => void;
  markUniverseTitlePromptApplied: () => void;
};

const ONBOARDING_STORAGE_KEY = "mind-atlas-onboarding-v1";
const NOTEBOOK_STORAGE_KEY = "mind-atlas-notebook-v2";
const ROOT_DISCOVERY_WAIT_MS = 5000;
const ROOT_WHITE_HOLE_WAIT_MS = 2000;
const CAMERA_RESET_HINT_DELAY_MS = 3000;
const NOTICE_MS = 5000;

export function useOnboarding(): OnboardingState {
  const { locale } = useMindAtlasLocale();
  const message = useMessage();
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const tutorialNodeCount = useMemo(() => countUserNodes(atlasRoot), [atlasRoot]);
  const text = useCallback((id: OnboardingMessageId) => message(ONBOARDING_MESSAGE_IDS[id]), [message]);
  const [progress, setProgress] = useState<OnboardingProgress>(() => loadProgress());
  const [rootHelpLevel, setRootHelpLevel] = useState<0 | 1 | 2>(0);
  const [rootDeadlineAt, setRootDeadlineAt] = useState(() => Date.now() + ROOT_DISCOVERY_WAIT_MS);
  const [noticeMessageId, setNoticeMessageId] = useState<OnboardingMessageId | null>(null);
  const [allNodesOffscreen, setAllNodesOffscreen] = useState(false);
  const [cameraResetHintVisible, setCameraResetHintVisible] = useState(false);

  const persistProgress = useCallback((updater: (current: OnboardingProgress) => OnboardingProgress) => {
    setProgress((current) => {
      const next = updater(current);
      saveProgress(next);
      return next;
    });
  }, []);

  const markUniverseTitlePromptApplied = useCallback(() => {
    persistProgress((current) => (current.titlePromptApplied ? current : { ...current, titlePromptApplied: true }));
  }, [persistProgress]);

  const startTutorialMode = useCallback(() => {
    const next = newUserProgress();
    saveProgress(next);
    setProgress(next);
    setRootHelpLevel(0);
    setRootDeadlineAt(Date.now() + ROOT_DISCOVERY_WAIT_MS);
    setNoticeMessageId(null);
    setAllNodesOffscreen(false);
    setCameraResetHintVisible(false);
  }, []);

  const completeTutorial = useCallback(() => {
    const completedAt = new Date().toISOString();
    persistProgress((current) => ({
      ...current,
      rootNodeCreated: true,
      nodeEditorOpened: true,
      nodeEditCompleted: true,
      nodeCountReached: true,
      pan: true,
      zoom: true,
      nodeDrag: true,
      childNodeCreated: true,
      spaceBasicsCompleted: true,
      basicCompleted: true,
      completedAt: current.completedAt ?? completedAt,
    }));
    setRootHelpLevel(0);
    setAllNodesOffscreen(false);
    setCameraResetHintVisible(false);
    setNoticeMessageId(null);
  }, [persistProgress]);

  const acknowledgeTutorialCompletion = useCallback(() => {
    const completedAt = new Date().toISOString();
    persistProgress((current) => ({
      ...current,
      spaceBasicsCompleted: true,
      basicCompleted: true,
      completedAt: current.completedAt ?? completedAt,
    }));
  }, [persistProgress]);

  useEffect(() => {
    const handleOnboardingEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: unknown; childDepth?: unknown }>).detail;
      const type = detail?.type;
      if (!isOnboardingEventType(type)) return;

      if (type === "root-birth-start") {
        if (!progress.firstRun || progress.rootNodeCreated) return;
        if (rootHelpLevel === 0) setRootDeadlineAt(Date.now() + ROOT_WHITE_HOLE_WAIT_MS);
        return;
      }

      if (type === "root-node-created") {
        persistProgress((current) => (current.rootNodeCreated ? current : { ...current, rootNodeCreated: true }));
        setRootHelpLevel(0);
        return;
      }

      if (type === "node-editor-opened") {
        persistProgress((current) => (current.nodeEditorOpened ? current : { ...current, nodeEditorOpened: true }));
        return;
      }

      if (type === "node-text-edited") {
        persistProgress((current) => ({ ...current, nodeEditorOpened: true, nodeEditCompleted: true }));
        return;
      }

      if (type === "node-editor-closed") {
        persistProgress((current) => (
          current.nodeEditorOpened && !current.nodeEditCompleted
            ? { ...current, nodeEditCompleted: true }
            : current
        ));
        return;
      }

      if (type === "root-birth-blocked-zoom") {
        setNoticeMessageId("root.zoomOutForNodeCreate");
        return;
      }

      if (type === "all-nodes-offscreen") {
        setAllNodesOffscreen(true);
        return;
      }

      if (type === "nodes-onscreen" || type === "home-logo-clicked") {
        setAllNodesOffscreen(false);
        setCameraResetHintVisible(false);
        return;
      }

      if (type === "child-node-created") return;

      if (type === "pan" || type === "zoom" || type === "node-drag") return;
    };

    window.addEventListener(ONBOARDING_EVENT, handleOnboardingEvent);
    return () => window.removeEventListener(ONBOARDING_EVENT, handleOnboardingEvent);
  }, [persistProgress, progress.firstRun, progress.rootNodeCreated, rootHelpLevel]);

  useEffect(() => {
    if (!progress.firstRun || progress.rootNodeCreated) return;
    if (rootHelpLevel === 2) return;
    const timeout = window.setTimeout(() => {
      if (rootHelpLevel === 0) {
        setRootHelpLevel(1);
        setRootDeadlineAt(Date.now() + ROOT_DISCOVERY_WAIT_MS);
        return;
      }
      setRootHelpLevel(2);
    }, Math.max(0, rootDeadlineAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [progress.firstRun, progress.rootNodeCreated, rootDeadlineAt, rootHelpLevel]);

  useEffect(() => {
    if (!progress.firstRun || progress.spaceBasicsCompleted || progress.nodeCountReached || tutorialNodeCount < 3) return;
    persistProgress((current) => (current.nodeCountReached ? current : { ...current, nodeCountReached: true }));
  }, [persistProgress, progress.firstRun, progress.nodeCountReached, progress.spaceBasicsCompleted, tutorialNodeCount]);

  useEffect(() => {
    if (!noticeMessageId) return;
    const timeout = window.setTimeout(() => setNoticeMessageId(null), NOTICE_MS);
    return () => window.clearTimeout(timeout);
  }, [noticeMessageId]);

  useEffect(() => {
    if (!allNodesOffscreen) {
      setCameraResetHintVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setCameraResetHintVisible(true), CAMERA_RESET_HINT_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [allNodesOffscreen]);

  const activeMessageId =
    noticeMessageId ??
    rootMessageId(progress, rootHelpLevel) ??
    (cameraResetHintVisible ? cameraResetMessageId() : null) ??
    tutorialMessageId(progress);
  const showMainChrome = !progress.firstRun || progress.spaceBasicsCompleted;
  const readyForCompletion =
    progress.firstRun &&
    progress.rootNodeCreated &&
    progress.nodeEditCompleted &&
    progress.nodeCountReached &&
    !progress.spaceBasicsCompleted;
  const showNodeCreationControls =
    progress.firstRun &&
    progress.rootNodeCreated &&
    progress.nodeEditCompleted &&
    !progress.nodeCountReached &&
    !progress.spaceBasicsCompleted;

  return {
    locale,
    message: activeMessageId ? text(activeMessageId) : "",
    messageId: activeMessageId,
    titlePrompt: text("title.nameUniverse"),
    showLogoOnly: progress.firstRun && !progress.spaceBasicsCompleted,
    showMainChrome,
    showRootPulse: progress.firstRun && !progress.rootNodeCreated,
    showNodeCreationControls,
    showEditorDuringTutorial:
      progress.firstRun && progress.rootNodeCreated && !readyForCompletion && !progress.spaceBasicsCompleted,
    readyForCompletion,
    showAiFeatures: progress.aiUnlocked,
    shouldApplyUniverseTitlePrompt: progress.firstRun && progress.spaceBasicsCompleted && !progress.titlePromptApplied,
    startTutorialMode,
    completeTutorial,
    acknowledgeTutorialCompletion,
    markUniverseTitlePromptApplied,
  };
}

export function emitOnboardingEvent(type: OnboardingEventType, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT, { detail: { ...detail, type } }));
}

export function getOnboardingCurrentSpaceStep(): SpaceStepId | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (!raw) return null;
  try {
    const progress = normalizeProgress(JSON.parse(raw));
    if (!progress.firstRun || !progress.rootNodeCreated || progress.spaceBasicsCompleted) return null;
    if (!progress.nodeEditCompleted) return "nodeEdit";
    if (!progress.nodeCountReached) return "nodeCount";
    return null;
  } catch {
    return null;
  }
}

function loadProgress(): OnboardingProgress {
  if (isAboutDemoMode()) return completedProgress(false);
  if (typeof window === "undefined") return completedProgress(false);
  const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (raw) {
    try {
      return normalizeProgress(JSON.parse(raw));
    } catch {
      return createProgressForCurrentBrowser();
    }
  }
  return createProgressForCurrentBrowser();
}

function createProgressForCurrentBrowser(): OnboardingProgress {
  const returningUser = Boolean(window.localStorage.getItem(NOTEBOOK_STORAGE_KEY));
  const progress = returningUser ? completedProgress(false) : newUserProgress();
  saveProgress(progress);
  return progress;
}

function newUserProgress(): OnboardingProgress {
  return {
    version: 1,
    firstRun: true,
    rootNodeCreated: false,
    nodeEditorOpened: false,
    nodeEditCompleted: false,
    nodeCountReached: false,
    pan: false,
    zoom: false,
    nodeDrag: false,
    childNodeCreated: false,
    spaceBasicsCompleted: false,
    basicCompleted: false,
    aiUnlocked: false,
    titlePromptApplied: false,
    startedAt: new Date().toISOString(),
  };
}

function completedProgress(firstRun: boolean): OnboardingProgress {
  const now = new Date().toISOString();
  return {
    version: 1,
    firstRun,
    rootNodeCreated: true,
    nodeEditorOpened: true,
    nodeEditCompleted: true,
    nodeCountReached: true,
    pan: true,
    zoom: true,
    nodeDrag: true,
    childNodeCreated: true,
    spaceBasicsCompleted: true,
    basicCompleted: true,
    aiUnlocked: true,
    titlePromptApplied: true,
    startedAt: now,
    completedAt: now,
  };
}

function normalizeProgress(value: unknown): OnboardingProgress {
  if (!value || typeof value !== "object") return createProgressForCurrentBrowser();
  const stored = value as Record<string, unknown>;
  if (stored.version === 2) {
    const firstRun = stored.firstRun === true;
    const completed = stored.spaceBasicsCompleted === true || stored.basicCompleted === true || !firstRun;
    const fallback = completed ? completedProgress(firstRun) : newUserProgress();
    return {
      ...fallback,
      rootNodeCreated: completed || stored.practiceAtlasReady === true,
      nodeEditorOpened: completed || stored.practiceNodeSelected === true || stored.practiceNodeEdited === true,
      nodeEditCompleted: completed || stored.practiceNodeEdited === true,
      nodeCountReached: completed,
      childNodeCreated: completed || stored.childNodeCreated === true,
      aiUnlocked: stored.aiUnlocked === true || fallback.aiUnlocked,
      titlePromptApplied: stored.titlePromptApplied === true || fallback.titlePromptApplied,
      startedAt: typeof stored.startedAt === "string" ? stored.startedAt : fallback.startedAt,
      completedAt: typeof stored.completedAt === "string" ? stored.completedAt : fallback.completedAt,
    };
  }
  const partial = value as Partial<OnboardingProgress>;
  const fallback = partial.firstRun ? newUserProgress() : completedProgress(false);
  const normalized: OnboardingProgress = {
    ...fallback,
    ...partial,
    version: 1,
    startedAt: typeof partial.startedAt === "string" ? partial.startedAt : fallback.startedAt,
    completedAt: typeof partial.completedAt === "string" ? partial.completedAt : fallback.completedAt,
  };
  return normalized;
}

function saveProgress(progress: OnboardingProgress) {
  if (isAboutDemoMode()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
}

function rootMessageId(progress: OnboardingProgress, helpLevel: 0 | 1 | 2): OnboardingMessageId | null {
  if (!progress.firstRun || progress.rootNodeCreated) return null;
  if (helpLevel === 1) return "root.hint";
  if (helpLevel === 2) return "root.answer";
  return null;
}

function cameraResetMessageId(): OnboardingMessageId {
  if (typeof window === "undefined" || typeof document === "undefined") return "space.cameraReset";
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return "space.cameraResetMobile";
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowPortrait = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)").matches ?? false;
  return coarsePointer && narrowPortrait ? "space.cameraResetMobile" : "space.cameraReset";
}

function tutorialMessageId(progress: OnboardingProgress): OnboardingMessageId | null {
  if (!progress.firstRun || !progress.rootNodeCreated || progress.spaceBasicsCompleted) return null;
  if (!progress.nodeEditCompleted) return "node.edit";
  if (!progress.nodeCountReached) return "node.createMore";
  return null;
}

function countUserNodes(root: AtlasNode): number {
  let count = 0;
  const visit = (node: AtlasNode) => {
    if (node.id !== root.id) count += 1;
    node.children.forEach(visit);
  };
  visit(root);
  return count;
}

function isOnboardingEventType(value: unknown): value is OnboardingEventType {
  return (
    value === "root-birth-start" ||
    value === "root-node-created" ||
    value === "root-birth-blocked-zoom" ||
    value === "node-editor-opened" ||
    value === "node-text-edited" ||
    value === "node-editor-closed" ||
    value === "pan" ||
    value === "home-logo-clicked" ||
    value === "all-nodes-offscreen" ||
    value === "nodes-onscreen" ||
    value === "zoom" ||
    value === "node-drag" ||
    value === "child-node-created"
  );
}
