import { useCallback, useEffect, useMemo, useState } from "react";
import { isAboutDemoMode } from "../aboutDemo";
import { ONBOARDING_EVENT } from "../events";
import { useMessage, useMindAtlasLocale } from "../i18n/I18nProvider";
import type { AppLocale } from "../i18n/locales";
import { ONBOARDING_MESSAGE_IDS, type OnboardingMessageId } from "./localization";

export type OnboardingEventType =
  | "tutorial-practice-ready"
  | "tutorial-node-selected"
  | "tutorial-node-edited"
  | "child-node-created"
  // Kept for older callers. These gestures no longer gate tutorial completion.
  | "root-birth-start"
  | "root-node-created"
  | "root-birth-blocked-zoom"
  | "pan"
  | "home-logo-clicked"
  | "all-nodes-offscreen"
  | "nodes-onscreen"
  | "zoom"
  | "node-drag";

export type SpaceStepId = "pan" | "zoom" | "nodeDrag" | "childNodeCreated";
export type TutorialStepId = "selectNode" | "editNode" | "childNodeCreated";

type OnboardingProgress = {
  version: 2;
  firstRun: boolean;
  practiceAtlasReady: boolean;
  practiceNodeSelected: boolean;
  practiceNodeEdited: boolean;
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
  tutorialStep: TutorialStepId | null;
  titlePrompt: string;
  showLogoOnly: boolean;
  showMainChrome: boolean;
  showRootPulse: boolean;
  showChildCreationFallback: boolean;
  showAiFeatures: boolean;
  shouldInitializePracticeAtlas: boolean;
  shouldApplyUniverseTitlePrompt: boolean;
  startTutorialMode: () => void;
  completeTutorial: () => void;
  markPracticeAtlasReady: () => void;
  markPracticeNodeSelected: () => void;
  markPracticeNodeEdited: () => void;
  markUniverseTitlePromptApplied: () => void;
};

const ONBOARDING_STORAGE_KEY = "mind-atlas-onboarding-v1";
const NOTEBOOK_STORAGE_KEY = "mind-atlas-notebook-v2";

export function useOnboarding(): OnboardingState {
  const { locale } = useMindAtlasLocale();
  const message = useMessage();
  const text = useCallback((id: OnboardingMessageId) => message(ONBOARDING_MESSAGE_IDS[id]), [message]);
  const [progress, setProgress] = useState<OnboardingProgress>(() => loadProgress());

  const persistProgress = useCallback((updater: (current: OnboardingProgress) => OnboardingProgress) => {
    setProgress((current) => {
      const next = updater(current);
      saveProgress(next);
      return next;
    });
  }, []);

  const markProgress = useCallback(
    (key: "practiceAtlasReady" | "practiceNodeSelected" | "practiceNodeEdited") => {
      persistProgress((current) => (current[key] ? current : { ...current, [key]: true }));
    },
    [persistProgress],
  );

  const markPracticeAtlasReady = useCallback(() => markProgress("practiceAtlasReady"), [markProgress]);
  const markPracticeNodeSelected = useCallback(() => markProgress("practiceNodeSelected"), [markProgress]);
  const markPracticeNodeEdited = useCallback(() => markProgress("practiceNodeEdited"), [markProgress]);
  const markUniverseTitlePromptApplied = useCallback(() => {
    persistProgress((current) => (current.titlePromptApplied ? current : { ...current, titlePromptApplied: true }));
  }, [persistProgress]);

  const startTutorialMode = useCallback(() => {
    const next = newUserProgress();
    saveProgress(next);
    setProgress(next);
  }, []);

  const completeTutorial = useCallback(() => {
    const completedAt = new Date().toISOString();
    persistProgress((current) => ({
      ...current,
      practiceAtlasReady: true,
      practiceNodeSelected: true,
      practiceNodeEdited: true,
      childNodeCreated: true,
      spaceBasicsCompleted: true,
      basicCompleted: true,
      completedAt: current.completedAt ?? completedAt,
    }));
  }, [persistProgress]);

  const tutorialStep = useMemo(() => getTutorialStep(progress), [progress]);

  const handleTutorialChildCreated = useCallback(() => {
    const completedAt = new Date().toISOString();
    persistProgress((current) => {
      if (!current.firstRun || current.spaceBasicsCompleted || !current.practiceNodeEdited) return current;
      return {
        ...current,
        childNodeCreated: true,
        spaceBasicsCompleted: true,
        basicCompleted: true,
        completedAt: current.completedAt ?? completedAt,
      };
    });
  }, [persistProgress]);

  useTutorialEvents({
    markPracticeAtlasReady,
    markPracticeNodeSelected,
    markPracticeNodeEdited,
    handleTutorialChildCreated,
  });

  const activeMessageId = tutorialMessageId(tutorialStep);
  const showMainChrome = !progress.firstRun || progress.spaceBasicsCompleted;

  return {
    locale,
    message: activeMessageId ? text(activeMessageId) : "",
    messageId: activeMessageId,
    tutorialStep,
    titlePrompt: text("title.nameUniverse"),
    showLogoOnly: progress.firstRun && !progress.spaceBasicsCompleted,
    showMainChrome,
    showRootPulse: false,
    showChildCreationFallback: tutorialStep === "childNodeCreated",
    showAiFeatures: progress.aiUnlocked,
    shouldInitializePracticeAtlas: progress.firstRun && !progress.practiceAtlasReady,
    shouldApplyUniverseTitlePrompt: progress.firstRun && progress.spaceBasicsCompleted && !progress.titlePromptApplied,
    startTutorialMode,
    completeTutorial,
    markPracticeAtlasReady,
    markPracticeNodeSelected,
    markPracticeNodeEdited,
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
    return getTutorialStep(progress) === "childNodeCreated" ? "childNodeCreated" : null;
  } catch {
    return null;
  }
}

function useTutorialEvents({
  markPracticeAtlasReady,
  markPracticeNodeSelected,
  markPracticeNodeEdited,
  handleTutorialChildCreated,
}: {
  markPracticeAtlasReady: () => void;
  markPracticeNodeSelected: () => void;
  markPracticeNodeEdited: () => void;
  handleTutorialChildCreated: () => void;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnboardingEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: unknown; childDepth?: unknown }>).detail;
      if (!isOnboardingEventType(detail?.type)) return;
      if (detail.type === "tutorial-practice-ready") markPracticeAtlasReady();
      if (detail.type === "tutorial-node-selected") markPracticeNodeSelected();
      if (detail.type === "tutorial-node-edited") markPracticeNodeEdited();
      if (detail.type === "child-node-created" && typeof detail.childDepth === "number" && detail.childDepth >= 2) {
        handleTutorialChildCreated();
      }
    };
    window.addEventListener(ONBOARDING_EVENT, handleOnboardingEvent);
    return () => window.removeEventListener(ONBOARDING_EVENT, handleOnboardingEvent);
  }, [handleTutorialChildCreated, markPracticeAtlasReady, markPracticeNodeEdited, markPracticeNodeSelected]);
}

function loadProgress(): OnboardingProgress {
  if (isAboutDemoMode()) return completedProgress(false);
  if (typeof window === "undefined") return completedProgress(false);
  const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (raw) {
    try {
      const normalized = normalizeProgress(JSON.parse(raw));
      saveProgress(normalized);
      return normalized;
    } catch {
      // Fall through to a browser-derived initial state.
    }
  }
  const returningUser = Boolean(window.localStorage.getItem(NOTEBOOK_STORAGE_KEY));
  const progress = returningUser ? completedProgress(false) : newUserProgress();
  saveProgress(progress);
  return progress;
}

function newUserProgress(): OnboardingProgress {
  return {
    version: 2,
    firstRun: true,
    practiceAtlasReady: false,
    practiceNodeSelected: false,
    practiceNodeEdited: false,
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
    version: 2,
    firstRun,
    practiceAtlasReady: true,
    practiceNodeSelected: true,
    practiceNodeEdited: true,
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
  if (!value || typeof value !== "object") return newUserProgress();
  const partial = value as Record<string, unknown>;
  const firstRun = partial.firstRun === true;
  const legacyCompleted = partial.spaceBasicsCompleted === true || partial.basicCompleted === true || !firstRun;
  const fallback = legacyCompleted ? completedProgress(firstRun) : newUserProgress();
  if (partial.version !== 2) {
    return {
      ...fallback,
      aiUnlocked: partial.aiUnlocked === true || fallback.aiUnlocked,
      titlePromptApplied: partial.titlePromptApplied === true || fallback.titlePromptApplied,
      startedAt: typeof partial.startedAt === "string" ? partial.startedAt : fallback.startedAt,
      completedAt: typeof partial.completedAt === "string" ? partial.completedAt : fallback.completedAt,
    };
  }
  return {
    ...fallback,
    firstRun,
    practiceAtlasReady: partial.practiceAtlasReady === true,
    practiceNodeSelected: partial.practiceNodeSelected === true,
    practiceNodeEdited: partial.practiceNodeEdited === true,
    childNodeCreated: partial.childNodeCreated === true,
    spaceBasicsCompleted: partial.spaceBasicsCompleted === true,
    basicCompleted: partial.basicCompleted === true,
    aiUnlocked: partial.aiUnlocked === true,
    titlePromptApplied: partial.titlePromptApplied === true,
    startedAt: typeof partial.startedAt === "string" ? partial.startedAt : fallback.startedAt,
    completedAt: typeof partial.completedAt === "string" ? partial.completedAt : undefined,
    version: 2,
  };
}

function saveProgress(progress: OnboardingProgress) {
  if (isAboutDemoMode() || typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
}

function getTutorialStep(progress: OnboardingProgress): TutorialStepId | null {
  if (!progress.firstRun || progress.spaceBasicsCompleted) return null;
  if (!progress.practiceNodeSelected) return "selectNode";
  if (!progress.practiceNodeEdited) return "editNode";
  if (!progress.childNodeCreated) return "childNodeCreated";
  return null;
}

function tutorialMessageId(step: TutorialStepId | null): OnboardingMessageId | null {
  if (step === "selectNode") return "practice.selectNode";
  if (step === "editNode") return "practice.editNode";
  if (step === "childNodeCreated") return "practice.addChild";
  return null;
}

function isOnboardingEventType(value: unknown): value is OnboardingEventType {
  return (
    value === "tutorial-practice-ready" ||
    value === "tutorial-node-selected" ||
    value === "tutorial-node-edited" ||
    value === "child-node-created" ||
    value === "root-birth-start" ||
    value === "root-node-created" ||
    value === "root-birth-blocked-zoom" ||
    value === "pan" ||
    value === "home-logo-clicked" ||
    value === "all-nodes-offscreen" ||
    value === "nodes-onscreen" ||
    value === "zoom" ||
    value === "node-drag"
  );
}
