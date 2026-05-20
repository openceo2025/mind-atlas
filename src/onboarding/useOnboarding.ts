import { useCallback, useEffect, useMemo, useState } from "react";
import { ONBOARDING_EVENT } from "../events";
import { ONBOARDING_TEXT, detectOnboardingLocale, type OnboardingLocale, type OnboardingMessageId } from "./localization";

export type OnboardingEventType =
  | "root-birth-start"
  | "root-node-created"
  | "pan"
  | "home-logo-clicked"
  | "zoom"
  | "fast-zoom-out"
  | "fast-zoom-in"
  | "node-drag"
  | "child-node-created";

export type SpaceStepId = "pan" | "cameraReset" | "zoom" | "fastZoomOut" | "fastZoomIn" | "nodeDrag" | "childNodeCreated";

type OnboardingProgress = {
  version: 1;
  firstRun: boolean;
  rootNodeCreated: boolean;
  pan: boolean;
  cameraReset: boolean;
  zoom: boolean;
  fastZoomOut: boolean;
  fastZoomIn: boolean;
  nodeDrag: boolean;
  childNodeCreated: boolean;
  grandchildNodeCreated: boolean;
  spaceBasicsCompleted: boolean;
  basicCompleted: boolean;
  aiUnlocked: boolean;
  titlePromptApplied: boolean;
  startedAt: string;
  completedAt?: string;
};

export type OnboardingState = {
  locale: OnboardingLocale;
  message: string;
  messageId: OnboardingMessageId | null;
  titlePrompt: string;
  showLogoOnly: boolean;
  showMainChrome: boolean;
  showRootPulse: boolean;
  showAiFeatures: boolean;
  shouldApplyUniverseTitlePrompt: boolean;
  markUniverseTitlePromptApplied: () => void;
};

const ONBOARDING_STORAGE_KEY = "mind-atlas-onboarding-v1";
const NOTEBOOK_STORAGE_KEY = "mind-atlas-notebook-v2";
const ROOT_DISCOVERY_WAIT_MS = 5000;
const ROOT_WHITE_HOLE_WAIT_MS = 2000;
const SPACE_STEP_GRACE_MS = 10000;
const CAMERA_RESET_GRACE_MS = 5000;
const NOTICE_MS = 5000;

type SpacePromptDeadline = {
  stepId: SpaceStepId;
  deadlineAt: number;
};

const SPACE_STEPS: Array<{ id: SpaceStepId; event: OnboardingEventType; messageId: OnboardingMessageId }> = [
  { id: "pan", event: "pan", messageId: "space.pan" },
  { id: "cameraReset", event: "home-logo-clicked", messageId: "space.cameraReset" },
  { id: "zoom", event: "zoom", messageId: "space.zoom" },
  { id: "nodeDrag", event: "node-drag", messageId: "space.nodeDrag" },
  { id: "childNodeCreated", event: "child-node-created", messageId: "space.childNode" },
  { id: "fastZoomOut", event: "fast-zoom-out", messageId: "space.fastZoomOut" },
  { id: "fastZoomIn", event: "fast-zoom-in", messageId: "space.fastZoomIn" },
];

const KONAMI_SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function useOnboarding(): OnboardingState {
  const locale = useMemo(() => detectOnboardingLocale(), []);
  const text = ONBOARDING_TEXT[locale];
  const [progress, setProgress] = useState<OnboardingProgress>(() => loadProgress());
  const [rootHelpLevel, setRootHelpLevel] = useState<0 | 1 | 2>(0);
  const [rootDeadlineAt, setRootDeadlineAt] = useState(() => Date.now() + ROOT_DISCOVERY_WAIT_MS);
  const [spacePromptDeadline, setSpacePromptDeadline] = useState<SpacePromptDeadline | null>(null);
  const [spacePromptStep, setSpacePromptStep] = useState<SpaceStepId | null>(null);
  const [noticeMessageId, setNoticeMessageId] = useState<OnboardingMessageId | null>(null);

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

  const markSpaceStep = useCallback(
    (stepId: SpaceStepId) => {
      persistProgress((current) => (current[stepId] ? current : { ...current, [stepId]: true }));
    },
    [persistProgress],
  );

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

      if (type === "child-node-created") {
        if (typeof detail.childDepth !== "number" || detail.childDepth < 2) return;
        persistProgress((current) =>
          current.childNodeCreated && current.grandchildNodeCreated
            ? current
            : { ...current, childNodeCreated: true, grandchildNodeCreated: true },
        );
        return;
      }

      const matchedStep = SPACE_STEPS.find((step) => step.event === type);
      if (matchedStep) markSpaceStep(matchedStep.id);
    };

    window.addEventListener(ONBOARDING_EVENT, handleOnboardingEvent);
    return () => window.removeEventListener(ONBOARDING_EVENT, handleOnboardingEvent);
  }, [markSpaceStep, persistProgress, progress.firstRun, progress.rootNodeCreated, rootHelpLevel]);

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

  const firstMissingSpaceStep = useMemo(() => getFirstMissingSpaceStep(progress), [progress]);

  useEffect(() => {
    if (!progress.firstRun || !progress.rootNodeCreated || progress.spaceBasicsCompleted) return;
    if (!firstMissingSpaceStep) {
      const completedAt = new Date().toISOString();
      persistProgress((current) => ({
        ...current,
        spaceBasicsCompleted: true,
        basicCompleted: true,
        completedAt: current.completedAt ?? completedAt,
      }));
      setSpacePromptStep(null);
      setSpacePromptDeadline(null);
      setNoticeMessageId("space.complete");
      const basicNotice = window.setTimeout(() => setNoticeMessageId("basic.complete"), NOTICE_MS);
      const clearNotice = window.setTimeout(() => setNoticeMessageId(null), NOTICE_MS * 2);
      return () => {
        window.clearTimeout(basicNotice);
        window.clearTimeout(clearNotice);
      };
    }

    setSpacePromptStep(null);
    setSpacePromptDeadline({
      stepId: firstMissingSpaceStep.id,
      deadlineAt: Date.now() + getSpaceStepGraceMs(firstMissingSpaceStep.id),
    });
  }, [firstMissingSpaceStep, persistProgress, progress.firstRun, progress.rootNodeCreated, progress.spaceBasicsCompleted]);

  useEffect(() => {
    if (!spacePromptDeadline || !firstMissingSpaceStep || progress.spaceBasicsCompleted) return;
    if (spacePromptDeadline.stepId !== firstMissingSpaceStep.id) return;
    const timeout = window.setTimeout(() => {
      setSpacePromptStep((current) => current ?? firstMissingSpaceStep.id);
    }, Math.max(0, spacePromptDeadline.deadlineAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [firstMissingSpaceStep, progress.spaceBasicsCompleted, spacePromptDeadline]);

  useEffect(() => {
    let matched = 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      const expected = KONAMI_SEQUENCE[matched];
      const actual = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (actual === expected) {
        matched += 1;
        if (matched === KONAMI_SEQUENCE.length) {
          matched = 0;
          if (progress.aiUnlocked) return;
          const confirmed = window.confirm(text["ai.unlockConfirm"]);
          if (!confirmed) return;
          persistProgress((current) => ({ ...current, aiUnlocked: true }));
          setNoticeMessageId("ai.unlocked");
          window.setTimeout(() => setNoticeMessageId(null), NOTICE_MS);
        }
        return;
      }
      matched = actual === KONAMI_SEQUENCE[0] ? 1 : 0;
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [persistProgress, progress.aiUnlocked, text]);

  const activeMessageId = noticeMessageId ?? rootMessageId(progress, rootHelpLevel) ?? spaceMessageId(firstMissingSpaceStep, spacePromptStep);
  const showMainChrome = !progress.firstRun || progress.spaceBasicsCompleted;

  return {
    locale,
    message: activeMessageId ? text[activeMessageId] : "",
    messageId: activeMessageId,
    titlePrompt: text["title.nameUniverse"],
    showLogoOnly: progress.firstRun && !progress.spaceBasicsCompleted,
    showMainChrome,
    showRootPulse: progress.firstRun && !progress.rootNodeCreated,
    showAiFeatures: progress.aiUnlocked,
    shouldApplyUniverseTitlePrompt: progress.firstRun && progress.spaceBasicsCompleted && !progress.titlePromptApplied,
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
    const progress = JSON.parse(raw) as Partial<OnboardingProgress>;
    if (!progress.firstRun || !progress.rootNodeCreated || progress.spaceBasicsCompleted) return null;
    return SPACE_STEPS.find((step) => !progress[step.id])?.id ?? null;
  } catch {
    return null;
  }
}

function loadProgress(): OnboardingProgress {
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
    pan: false,
    cameraReset: false,
    zoom: false,
    fastZoomOut: false,
    fastZoomIn: false,
    nodeDrag: false,
    childNodeCreated: false,
    grandchildNodeCreated: false,
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
    pan: true,
    cameraReset: true,
    zoom: true,
    fastZoomOut: true,
    fastZoomIn: true,
    nodeDrag: true,
    childNodeCreated: true,
    grandchildNodeCreated: true,
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
  const partial = value as Partial<OnboardingProgress>;
  const fallback = partial.firstRun ? newUserProgress() : completedProgress(false);
  return {
    ...fallback,
    ...partial,
    version: 1,
    startedAt: typeof partial.startedAt === "string" ? partial.startedAt : fallback.startedAt,
    completedAt: typeof partial.completedAt === "string" ? partial.completedAt : fallback.completedAt,
  };
}

function saveProgress(progress: OnboardingProgress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
}

function getFirstMissingSpaceStep(progress: OnboardingProgress) {
  for (const step of SPACE_STEPS) {
    if ((step.id === "fastZoomOut" || step.id === "fastZoomIn") && !progress.grandchildNodeCreated) {
      return SPACE_STEPS.find((candidate) => candidate.id === "childNodeCreated") ?? step;
    }
    if (!progress[step.id]) return step;
  }
  return null;
}

function getSpaceStepGraceMs(stepId: SpaceStepId) {
  return stepId === "cameraReset" ? CAMERA_RESET_GRACE_MS : SPACE_STEP_GRACE_MS;
}

function rootMessageId(progress: OnboardingProgress, helpLevel: 0 | 1 | 2): OnboardingMessageId | null {
  if (!progress.firstRun || progress.rootNodeCreated) return null;
  if (helpLevel === 1) return "root.hint";
  if (helpLevel === 2) return "root.answer";
  return null;
}

function spaceMessageId(
  firstMissingStep: ReturnType<typeof getFirstMissingSpaceStep>,
  promptStep: SpaceStepId | null,
): OnboardingMessageId | null {
  if (!firstMissingStep || firstMissingStep.id !== promptStep) return null;
  return firstMissingStep.messageId;
}

function isOnboardingEventType(value: unknown): value is OnboardingEventType {
  return (
    value === "root-birth-start" ||
    value === "root-node-created" ||
    value === "pan" ||
    value === "home-logo-clicked" ||
    value === "zoom" ||
    value === "fast-zoom-out" ||
    value === "fast-zoom-in" ||
    value === "node-drag" ||
    value === "child-node-created"
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
