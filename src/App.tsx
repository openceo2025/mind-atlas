import { FocusPanel } from "./components/FocusPanel";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, BellOff, CalendarDays, CloudDownload, CloudUpload, CreditCard, Download, FileText, GitBranch, Github, GraduationCap, History, Info, Languages, ListTree, LogIn, LogOut, Maximize2, MessageSquareText, Moon, MoreHorizontal, Network, Orbit, PenLine, Plus, Radio, Redo2, RefreshCw, RotateCcw, Search, Settings2, Share2, Smartphone, Sparkles, Sun, Trash2, Undo2, Upload, UserCircle, Volume2, X } from "lucide-react";
import { ChangeEvent, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadCloudNotebookPackage, listCloudNotebookPackages, saveCloudNotebookPackage } from "./ai/bridgeClient";
import { createAboutDemoNotebook, getAboutDemoAttachmentPreviewUrls, getAboutDemoLayoutMode, getAboutDemoNotification, getAboutDemoOverviewFocusRequest, getAboutDemoSelectedNodeId, readAboutDemoConfig } from "./aboutDemo";
import { replaceStoredAttachmentBlobs } from "./attachmentStorage";
import { CommandDock } from "./components/CommandDock";
import { fetchAnalyticsAvailability, startAnalyticsLifecycle, trackProductEvent } from "./analytics/productAnalytics";
import { copyContextMarkdown, formatContextCopyStats } from "./context/contextCopy";
import { Minimap } from "./components/Minimap";
import { OutlineEditor } from "./components/OutlineEditor";
import { AgentRunWorkspaceHost } from "./components/agentRun/AgentRunWorkspaceHost";
import { UniverseCanvas } from "./components/UniverseCanvas";
import { HOSTED_SERVICE_SESSION_REFRESH_EVENT, REALTIME_VOICE_RESTART_EVENT, UNIVERSE_BACKGROUND_BIRTH_UNAVAILABLE_EVENT, UNIVERSE_BACKGROUND_CLICK_EVENT, UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "./events";
import { detectImportFormat, importExternalNotebookFile, importMarkdownText } from "./notebookImport";
import { createAtlasImageShareData, createAtlasShareImage } from "./notebookImageShare";
import { createNotebookJsonPackage, createNotebookPackage, importNotebookPackage, type NotebookPackageResult } from "./notebookPackage";
import { createSharedNotebookLink, readHostedShareTokenFromUrl, readSharedNotebookFromUrl, removeSharedNotebookHash } from "./notebookShare";
import { searchAtlasNodes } from "./search/nodeSearch";
import { createTextOnlyNotebookRoot, textOnlyNotebookSizeBytes } from "./notebookTextOnly";
import { createNotebookFromTemplate, NOTEBOOK_TEMPLATES, type NotebookTemplateId } from "./notebookTemplates";
import { emitOnboardingEvent, useOnboarding } from "./onboarding/useOnboarding";
import {
  createTutorialPracticeNotebook,
  getTutorialPracticeOverview,
  TUTORIAL_PRACTICE_ROOT_ID,
  TUTORIAL_PRACTICE_TARGET_ID,
} from "./onboarding/tutorialNotebook";
import type { OutlineNodeInput } from "./outline/atlasOutline";
import { findNode, findNodePath, useAtlasStore } from "./store/atlasStore";
import { getAtlasLayoutModeLabel, isAtlasLayoutMode, type AtlasLayoutMode } from "./layout/atlasLayout";
import { I18nText, useMessage, useMindAtlasLocale } from "./i18n/I18nProvider";
import { AVAILABLE_LOCALES, LOCALE_LABELS, currentAppLocale, type LocalePreference } from "./i18n/locales";
import {
  deleteHostedCloudNotebook,
  fetchHostedServiceSession,
  isHostedServiceMode,
  listHostedCloudNotebooks,
  loadHostedCloudNotebook,
  loadHostedSharedNotebook,
  logoutHostedService,
  openHostedBillingPortal,
  renameHostedCloudNotebook,
  saveHostedCloudNotebook,
  shareHostedCloudNotebook,
  startHostedBillingCheckout,
  startHostedGoogleLogin,
  updateHostedCloudNotebook,
} from "./hosted/serviceClient";
import { loadStoredTheme, persistTheme, type AtlasTheme } from "./theme";
import { loadPersistedUiState, persistUiStatePatch, type PersistedUiState } from "./uiPersistence";
import type { AtlasNode, CloudNotebookEntry, CloudNotebookListResult, HostedServiceSession, NotificationPulse, ViewportState, VoiceLogEntry, VoicePartnerSettings } from "./types";
import type { NotebookPersistenceStatus, NotebookSnapshot } from "./notebookPersistence";
import { formatAppMessage } from "./i18n/format";

const VOICE_OPTION_IDS = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const WORKSPACE_PANEL_EXIT_MS = 960;
const LAYOUT_BIRTH_UNAVAILABLE_NOTICE_MS = 3600;
const TUTORIAL_TEMPLATE_DELAY_MS = 5000;
const RENDER_QUALITY_STORAGE_KEY = "mind-atlas-render-quality";
const ROOT_COMMAND_MAX_ZOOM = 1.08;
const DEFAULT_DATASET_TITLE = "Mind Atlas";
const MIND_ATLAS_SOURCE_URL = "https://github.com/openceo2025/mind-atlas";
const IMPORT_ACCEPT_TYPES = ".mindatlas,.mindatlaspkg,.md,.markdown,.opml,.mm,application/mindatlas+json,application/x-mindatlas-package,text/markdown,text/plain,text/xml,application/xml";
const HOSTED_IMPORT_ACCEPT_TYPES = ".mindatlas,.md,.markdown,.opml,.mm,application/mindatlas+json,text/markdown,text/plain,text/xml,application/xml";
const CLOUD_NOTEBOOK_MAX_BYTES = 10 * 1024 * 1024;
const CURRENT_CLOUD_NOTEBOOK_SESSION_KEY = "mind-atlas-current-cloud-notebook-v1";
type StartSpaceSource = "initialize" | "tutorial";
type TutorialCompletionStep = "complete" | "choice" | null;
type CloudLoadCloseOptions = { closeCloudDialog: boolean; closeStartSpace: boolean };
type PendingWorkspaceSwitch = { nextName: string };
const MODE_OPTIONS: Array<{ mode: AtlasLayoutMode; icon: "orbit" | "tree" | "mind" | "calendar" }> = [
  { mode: "phyllotaxis", icon: "orbit" },
  { mode: "tree", icon: "tree" },
  { mode: "mind-map", icon: "mind" },
  { mode: "calendar", icon: "calendar" },
];
const UNIVERSE_TITLE_PLACEHOLDER_ALIASES = [
  "Name this universe.",
  "この宇宙に名前をつけてみましょう",
  "この宇宙に名前を付けてみましょう",
];

function localizedAboutUrl(locale: string) {
  const publicLocale = locale === "en-XA" ? "en" : locale === "ar-XB" ? "ar" : locale;
  return `/${encodeURIComponent(publicLocale)}/about.html`;
}
const KEYBOARD_OVERLAY_INPUT_SELECTOR =
  ".command-dock input, .command-dock textarea, .command-dock select, .node-body-input, .space-title-editor, .space-body-editor";
const SPACE_LABEL_KEYBOARD_SELECTOR = ".space-title-editor, .space-body-editor";
const MOBILE_KEYBOARD_OPEN_THRESHOLD_PX = 150;
const MOBILE_KEYBOARD_PREPARE_MS = 1200;
const MOBILE_KEYBOARD_OPEN_SETTLE_MS = 280;
const MOBILE_KEYBOARD_CLOSING_MS = 320;
const MOBILE_KEYBOARD_PROFILE_EVENT = "mind-atlas-mobile-keyboard-profile";

function notebookAnalyticsMetrics(root: AtlasNode) {
  let nodeCount = 0;
  let maxDepth = 0;
  let textSize = 0;
  const visit = (node: AtlasNode, depth: number) => {
    if (depth > 0) nodeCount += 1;
    maxDepth = Math.max(maxDepth, depth);
    textSize += (node.title?.length ?? 0) + (node.body?.length ?? 0);
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return { rootId: root.id, nodeCount, maxDepth, textSize };
}
type MobilePanelTab = "command" | "editor" | "operation" | "outline";
type MergeChoice = "current" | "incoming";

type OperationAction = {
  id: string;
  label: string;
  shortcut: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

interface MergePreviewBlock {
  key: string;
  path: string;
  currentTitle: string;
  incomingTitle: string;
  currentBody: string;
  incomingBody: string;
  choice: MergeChoice;
  children: MergePreviewBlock[];
}

interface MergePreviewState {
  root: MergePreviewBlock;
}

export default function App() {
  const t = useMessage();
  const { locale, preference: localePreference, setPreference: setLocalePreference } = useMindAtlasLocale();
  const aboutDemoConfig = useMemo(() => readAboutDemoConfig(), []);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const viewport = useAtlasStore((state) => state.viewport);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const selectNodeInPlace = useAtlasStore((state) => state.selectNodeInPlace);
  const showNotificationSnoozePrompt = useAtlasStore((state) => state.showNotificationSnoozePrompt);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const updateNodeLive = useAtlasStore((state) => state.updateNodeLive);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
  const saveNotebookNow = useAtlasStore((state) => state.saveNotebookNow);
  const addSiblingNode = useAtlasStore((state) => state.addSiblingNode);
  const addChildNode = useAtlasStore((state) => state.addChildNode);
  const requestBodyEdit = useAtlasStore((state) => state.requestBodyEdit);
  const applyOutlineSubtree = useAtlasStore((state) => state.applyOutlineSubtree);
  const resetNotebook = useAtlasStore((state) => state.resetNotebook);
  const undo = useAtlasStore((state) => state.undo);
  const redo = useAtlasStore((state) => state.redo);
  const canUndo = useAtlasStore((state) => state.historyPast.length > 0);
  const canRedo = useAtlasStore((state) => state.historyFuture.length > 0);
  const voiceLogEntries = useAtlasStore((state) => state.voiceLogEntries);
  const voiceLogLastSeenAt = useAtlasStore((state) => state.voiceLogLastSeenAt);
  const voiceSessionSummary = useAtlasStore((state) => state.voiceSessionSummary);
  const voicePartnerSettings = useAtlasStore((state) => state.voicePartnerSettings);
  const notebookPersistenceStatus = useAtlasStore((state) => state.notebookPersistenceStatus);
  const notebookPersistenceError = useAtlasStore((state) => state.notebookPersistenceError);
  const notebookSnapshots = useAtlasStore((state) => state.notebookSnapshots);
  const durableNotebookStorage = useAtlasStore((state) => state.durableNotebookStorage);
  const setVoicePartnerSettings = useAtlasStore((state) => state.setVoicePartnerSettings);
  const refreshNotebookSnapshots = useAtlasStore((state) => state.refreshNotebookSnapshots);
  const restoreNotebookFromSnapshot = useAtlasStore((state) => state.restoreNotebookFromSnapshot);
  const clearVoiceLog = useAtlasStore((state) => state.clearVoiceLog);
  const markVoiceLogSeen = useAtlasStore((state) => state.markVoiceLogSeen);
  const appendVoiceLogEntry = useAtlasStore((state) => state.appendVoiceLogEntry);
  const notificationPulses = useAtlasStore((state) => state.notificationPulses);
  const unreadNotifications = useAtlasStore((state) => state.unreadNotifications);
  const acknowledgeNodeNotification = useAtlasStore((state) => state.acknowledgeNodeNotification);
  const restoreAttachmentPreviews = useAtlasStore((state) => state.restoreAttachmentPreviews);
  const recoverCompletedCodexRuns = useAtlasStore((state) => state.recoverCompletedCodexRuns);
  const recoverMissedAgentRuns = useAtlasStore((state) => state.recoverMissedAgentRuns);
  const attachmentPreviewUrls = useAtlasStore((state) => state.attachmentPreviewUrls);
  const layoutMode = useAtlasStore((state) => state.layoutMode);
  const setLayoutMode = useAtlasStore((state) => state.setLayoutMode);
  const [persistedUiState] = useState<PersistedUiState | null>(() => loadPersistedUiState());
  const [pageActive, setPageActive] = useState(() => isPageRuntimeActive());
  const handleCanvasRuntimeResume = useCallback(() => {
    if (isPageRuntimeActive()) setPageActive(true);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const globalMenuRef = useRef<HTMLDivElement | null>(null);
  const universeShareTargetRef = useRef<HTMLElement | null>(null);
  const [voiceLogOpen, setVoiceLogOpen] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [restoreHistoryOpen, setRestoreHistoryOpen] = useState(false);
  const [outlineEditorOpen, setOutlineEditorOpen] = useState(false);
  const [outlineEditorRootId, setOutlineEditorRootId] = useState<string | null>(null);
  const [cloudLoadOpen, setCloudLoadOpen] = useState(false);
  const [startSpaceOpen, setStartSpaceOpen] = useState(false);
  const [startSpaceSource, setStartSpaceSource] = useState<StartSpaceSource>("initialize");
  const [tutorialStartSpaceDueAt, setTutorialStartSpaceDueAt] = useState<number | null>(null);
  const [tutorialCompletionStep, setTutorialCompletionStep] = useState<TutorialCompletionStep>(null);
  const tutorialCompletionRef = useRef({ initialized: false, awaitingCompletion: false });
  const tutorialCompletionDelayMsRef = useRef(TUTORIAL_TEMPLATE_DELAY_MS);
  const analyticsNotebookRef = useRef<{ rootId: string; nodeCount: number; maxDepth: number; textSize: number } | null>(null);
  const analyticsIgnoreNextNotebookRef = useRef(false);
  const analyticsLastMeaningfulAtRef = useRef(0);
  const analyticsLastUserInputAtRef = useRef(0);
  const analyticsTutorialStartedRef = useRef(false);
  const tutorialPracticeAppliedRef = useRef("");
  const tutorialTrackedStepsRef = useRef(new Set<string>());
  const explicitSaveRunningRef = useRef(false);
  const publicServiceMode = isHostedServiceMode();
  useEffect(() => {
    if (!publicServiceMode || aboutDemoConfig) return;
    let active = true;
    let stop = () => {};
    void fetchAnalyticsAvailability().then((enabled) => {
      if (active && enabled) stop = startAnalyticsLifecycle();
    });
    return () => {
      active = false;
      stop();
    };
  }, [aboutDemoConfig, publicServiceMode]);
  const [aiFeatureDialogOpen, setAiFeatureDialogOpen] = useState(false);
  const [hostedSession, setHostedSession] = useState<HostedServiceSession | null>(null);
  const [hostedSessionLoading, setHostedSessionLoading] = useState(false);
  const [hostedSessionError, setHostedSessionError] = useState("");
  const [mobileNotificationsEnabled, setMobileNotificationsEnabled] = useState(() => loadMobileNotificationPreference());
  const [mobileNotificationPermission, setMobileNotificationPermission] = useState<MobileNotificationPermission>(() => getMobileNotificationPermission());
  const [mobileNotificationMessage, setMobileNotificationMessage] = useState("");
  const [vrModeEnabled, setVrModeEnabled] = useState(() => Boolean(persistedUiState?.vrModeEnabled && canRestoreVrModeWithoutGesture()));
  const [vrModeMessage, setVrModeMessage] = useState("");
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(() => loadRenderQualityPreference());
  const [cloudNotebooks, setCloudNotebooks] = useState<CloudNotebookEntry[]>([]);
  const [cloudDirectory, setCloudDirectory] = useState("");
  const [cloudQuota, setCloudQuota] = useState<CloudNotebookListResult["quota"] | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [currentCloudNotebook, setCurrentCloudNotebook] = useState<CloudNotebookEntry | null>(null);
  const [currentCloudBaseline, setCurrentCloudBaseline] = useState("");
  const [pendingWorkspaceSwitch, setPendingWorkspaceSwitch] = useState<PendingWorkspaceSwitch | null>(null);
  const pendingWorkspaceSwitchActionRef = useRef<(() => void) | null>(null);
  const [theme, setTheme] = useState<AtlasTheme>(() => loadStoredTheme());
  const [mobilePanelTab, setMobilePanelTab] = useState<MobilePanelTab>(persistedUiState?.mobilePanelTab ?? "command");
  const [mobileWorkspacePanelRevealed, setMobileWorkspacePanelRevealed] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [contextCopyStatus, setContextCopyStatus] = useState("");
  const [layoutBirthUnavailableMessage, setLayoutBirthUnavailableMessage] = useState("");
  const [textImportOpen, setTextImportOpen] = useState(false);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [textImportValue, setTextImportValue] = useState("");
  const [mergePreview, setMergePreview] = useState<MergePreviewState | null>(null);
  const [sharedNotebookRoot, setSharedNotebookRoot] = useState<AtlasNode | null>(null);
  const [sharedNotebookImporting, setSharedNotebookImporting] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [dragImportActive, setDragImportActive] = useState(false);
  const mobilePortraitBreadcrumb = useMobilePortraitBreadcrumbLayout();
  const mobileOperationSurface = useMobileOperationSurface();
  const mobilePortraitOperationSurface = useMobilePortraitOperationSurface();
  const commandInputEditing = useAtlasStore((state) => state.commandInputEditing);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];
  const selectedNode = selectedPath[selectedPath.length - 1] ?? atlasRoot;
  const outlineEditorRoot = outlineEditorRootId ? findNode(atlasRoot, outlineEditorRootId) ?? selectedNode : selectedNode;
  const onboarding = useOnboarding();
  const hostedAuthenticated = Boolean(publicServiceMode && hostedSession?.authenticated && hostedSession.user);
  const hostedAccountFeatureLabel = hostedAuthenticated ? t("app.aiFeatures") : t("app.cloudAccountFeatures");
  const aiFeaturesUnlocked = publicServiceMode ? Boolean(hostedSession?.entitlement.aiEnabled) : onboarding.showMainChrome;
  const cloudNotebooksAvailable = publicServiceMode ? hostedAuthenticated : aiFeaturesUnlocked && !publicServiceMode;
  const currentCloudFingerprint = useMemo(
    () => (currentCloudNotebook?.id ? cloudNotebookFingerprint(atlasRoot) : ""),
    [atlasRoot, currentCloudNotebook?.id],
  );
  const currentCloudDirty = Boolean(
    publicServiceMode &&
      currentCloudNotebook?.id &&
      currentCloudBaseline &&
      currentCloudFingerprint !== currentCloudBaseline,
  );

  useEffect(() => {
    if (!publicServiceMode || notebookPersistenceStatus !== "ready") return;
    if (!hostedSession) return;
    const userId = hostedSession?.user?.id;
    if (!userId) {
      clearStoredCurrentCloudNotebook();
      if (currentCloudNotebook) {
        setCurrentCloudNotebook(null);
        setCurrentCloudBaseline("");
      }
      return;
    }
    if (currentCloudNotebook) return;
    const stored = readStoredCurrentCloudNotebook(userId);
    if (!stored) return;
    setCurrentCloudNotebook(stored.entry);
    setCurrentCloudBaseline(stored.baseline);
  }, [currentCloudNotebook, hostedSession, notebookPersistenceStatus, publicServiceMode]);
  const attachmentsEnabled = !publicServiceMode;
  const voiceLogReadable = publicServiceMode ? onboarding.showMainChrome : aiFeaturesUnlocked;
  const showCommandDock = aiFeaturesUnlocked && (aboutDemoConfig ? aboutDemoConfig.kind === "app" : publicServiceMode || shouldShowCommandDock(atlasRoot.id, selectedNodeId, viewport));
  const showTutorialOperationFallback = onboarding.showChildCreationFallback;
  const mobileOperationPanelTabAvailable = !mobilePortraitOperationSurface;
  const operationPanelInWorkspace = mobileOperationSurface && mobileOperationPanelTabAvailable;
  const effectiveMobilePanelTab: MobilePanelTab = getEffectiveMobilePanelTab(mobilePanelTab, showCommandDock, outlineEditorOpen, mobileOperationPanelTabAvailable);
  const mobileWorkspaceTabsNeeded = showCommandDock || mobileOperationPanelTabAvailable || outlineEditorOpen;
  const showWorkspacePanel =
    !outlineEditorOpen &&
    (showCommandDock ||
      selectedNodeId !== atlasRoot.id ||
      (showTutorialOperationFallback && operationPanelInWorkspace) ||
      (onboarding.showMainChrome && mobileWorkspacePanelRevealed && mobileOperationPanelTabAvailable));
  const focusPanelOpen = outlineEditorOpen || selectedNodeId !== atlasRoot.id;
  const operationTargets = useMemo(() => getOperationTargets(selectedPath), [selectedPath]);
  const tutorialFallbackChildParentId =
    showTutorialOperationFallback ? TUTORIAL_PRACTICE_TARGET_ID : selectedNodeId;
  const tutorialFallbackChildParentPath = useMemo(
    () => findNodePath(atlasRoot, tutorialFallbackChildParentId) ?? selectedPath,
    [atlasRoot, selectedPath, tutorialFallbackChildParentId],
  );
  const operationActions = useMemo<OperationAction[]>(
    () => [
      {
        id: "add-child",
        label: "Add child",
        shortcut: "Tab",
        icon: <GitBranch size={18} />,
        onClick: () => {
          const tutorialChildStep = onboarding.tutorialStep === "childNodeCreated";
          const childId = addChildNode(tutorialFallbackChildParentId, "", { requestEdit: !tutorialChildStep });
          if (childId) {
            if (!tutorialChildStep) {
              requestBodyEdit(childId);
              setMobilePanelTab("editor");
            } else if (!tutorialTrackedStepsRef.current.has("add_child")) {
              tutorialTrackedStepsRef.current.add("add_child");
              trackProductEvent("tutorial_step_completed", { step: "add_child" });
            }
            emitOnboardingEvent("child-node-created", { childDepth: tutorialFallbackChildParentPath.length });
          }
        },
      },
      {
        id: "add-sibling",
        label: "Add sibling",
        shortcut: "Enter",
        icon: <Plus size={18} />,
        disabled: selectedNodeId === atlasRoot.id,
        onClick: () => {
          const siblingId = addSiblingNode(selectedNodeId);
          if (siblingId) {
            requestBodyEdit(siblingId);
            setMobilePanelTab("editor");
          }
        },
      },
      {
        id: "parent-layer",
        label: "Go to parent layer",
        shortcut: "up",
        icon: <ArrowUp size={18} />,
        disabled: !operationTargets.parentId,
        onClick: () => {
          if (operationTargets.parentId) focusNode(operationTargets.parentId);
        },
      },
      {
        id: "child-layer",
        label: "Go to child layer",
        shortcut: "down",
        icon: <ArrowDown size={18} />,
        disabled: !operationTargets.childId,
        onClick: () => {
          if (operationTargets.childId) focusNode(operationTargets.childId);
        },
      },
      {
        id: "previous-sibling",
        label: "Go to previous sibling",
        shortcut: "left",
        icon: <ArrowLeft size={18} />,
        disabled: !operationTargets.previousSiblingId,
        onClick: () => {
          if (operationTargets.previousSiblingId) focusNode(operationTargets.previousSiblingId);
        },
      },
      {
        id: "next-sibling",
        label: "Go to next sibling",
        shortcut: "right",
        icon: <ArrowRight size={18} />,
        disabled: !operationTargets.nextSiblingId,
        onClick: () => {
          if (operationTargets.nextSiblingId) focusNode(operationTargets.nextSiblingId);
        },
      },
    ],
    [
      addChildNode,
      addSiblingNode,
      atlasRoot.id,
      focusNode,
      operationTargets.childId,
      operationTargets.nextSiblingId,
      operationTargets.parentId,
      operationTargets.previousSiblingId,
      onboarding.tutorialStep,
      requestBodyEdit,
      tutorialFallbackChildParentId,
      tutorialFallbackChildParentPath.length,
      selectedNodeId,
    ],
  );
  const [renderWorkspacePanel, setRenderWorkspacePanel] = useState(showWorkspacePanel);
  const aboutDemoAppliedRef = useRef("");
  useEffect(() => {
    if (!aboutDemoConfig) return;
    const key = `${aboutDemoConfig.kind}:${aboutDemoConfig.view}:${locale}`;
    if (aboutDemoAppliedRef.current === key) return;
    aboutDemoAppliedRef.current = key;

    const demoRoot = createAboutDemoNotebook(aboutDemoConfig.kind, locale);
    const selectedDemoNodeId = getAboutDemoSelectedNodeId(aboutDemoConfig);
    importNotebook(demoRoot, demoRoot.title, getAboutDemoAttachmentPreviewUrls(aboutDemoConfig));
    setLayoutMode(getAboutDemoLayoutMode(aboutDemoConfig));
    setRenderQuality("high");
    setTheme("dark");
    setMenuOpen(false);
    setVoiceLogOpen(false);
    setVoiceSettingsOpen(false);
    setRestoreHistoryOpen(false);
    setCloudLoadOpen(false);
    setNodeSearchOpen(false);
    setTextImportOpen(false);
    setMergePreview(null);
    setSharedNotebookRoot(null);
    setAiFeatureDialogOpen(false);
    setMobilePanelTab(aboutDemoConfig.kind === "app" ? "command" : "editor");
    setMobileWorkspacePanelRevealed(aboutDemoConfig.kind === "app");
    setRenderWorkspacePanel(aboutDemoConfig.kind === "app");

    if (aboutDemoConfig.view === "editor") {
      setOutlineEditorRootId(demoRoot.id);
      setOutlineEditorOpen(true);
    } else {
      setOutlineEditorRootId(null);
      setOutlineEditorOpen(false);
    }

    focusNode(selectedDemoNodeId);
    const overviewFocus = getAboutDemoOverviewFocusRequest(demoRoot, aboutDemoConfig);
    useAtlasStore.setState((state) => ({
      titleEditRequestId: null,
      ...(overviewFocus
        ? {
            focusRequest: {
              ...overviewFocus,
              nonce: (state.focusRequest?.nonce ?? 0) + 1,
            },
          }
        : {}),
    }));

    const notification = getAboutDemoNotification(aboutDemoConfig, locale);
    if (notification) {
      const now = performance.now();
      useAtlasStore.setState((state) => ({
        unreadNotifications: {
          ...state.unreadNotifications,
          [notification.nodeId]: {
            nodeId: notification.nodeId,
            kind: notification.kind,
            title: notification.title,
            signature: `about-demo:${notification.nodeId}`,
            lastPulseAt: now,
          },
        },
        notificationPulses: [
          ...state.notificationPulses,
          {
            id: `about-demo-pulse-${Date.now()}`,
            nodeId: notification.nodeId,
            kind: notification.kind,
            title: notification.title,
            createdAt: now,
          },
        ],
      }));
    }
  }, [aboutDemoConfig, focusNode, importNotebook, locale, setLayoutMode]);
  const appClassName = [
    "app-shell",
    onboarding.showLogoOnly ? "is-onboarding-logo-only" : "",
    !onboarding.showMainChrome ? "is-onboarding-main-hidden" : "",
    showTutorialOperationFallback ? "is-onboarding-child-fallback" : "",
    aiFeaturesUnlocked ? "is-ai-unlocked" : "is-ai-locked",
    publicServiceMode ? "is-public-service" : "",
    aboutDemoConfig ? "is-about-demo" : "",
    aboutDemoConfig ? `is-about-demo-${aboutDemoConfig.kind}` : "",
    aboutDemoConfig ? `is-about-demo-view-${aboutDemoConfig.view}` : "",
  ].filter(Boolean).join(" ");
  const unreadNotificationLinks = useMemo(
    () =>
      Object.values(unreadNotifications)
        .map((notification) => {
          const node = findNode(atlasRoot, notification.nodeId);
          return node ? { notification, node } : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 8),
    [atlasRoot, unreadNotifications],
  );
  useEffect(() => {
    const loggedSignatures = new Set(
      voiceLogEntries
        .map((entry) => entry.metadata?.notificationSignature)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );
    for (const { notification, node } of unreadNotificationLinks) {
      const signature = notification.signature ?? `${notification.nodeId}:${notification.kind}:${notification.title}`;
      if (loggedSignatures.has(signature)) continue;
      loggedSignatures.add(signature);
      appendVoiceLogEntry({
        role: "system",
        title: `Notification: ${notification.title}`,
        text: [
          `${notification.kind} notification for ${node.title || "Untitled node"}.`,
          `Node: ${node.title || "Untitled node"} (${notification.nodeId})`,
          node.summary ? `Summary: ${node.summary}` : "",
        ].filter(Boolean).join("\n"),
        metadata: {
          nodeId: notification.nodeId,
          notificationKind: notification.kind,
          notificationTitle: notification.title,
          notificationSignature: signature,
        },
      });
    }
  }, [appendVoiceLogEntry, unreadNotificationLinks, voiceLogEntries]);
  const unreadPartnerEntries = useMemo(
    () => voiceLogEntries.filter((entry) => isUnreadPartnerEntry(entry, voiceLogLastSeenAt)),
    [voiceLogEntries, voiceLogLastSeenAt],
  );
  const latestPartnerEntry = unreadPartnerEntries.at(-1);
  const uiPersistenceReadyRef = useRef(false);
  const uiRestoreAppliedRef = useRef(false);
  const latestUiStateRef = useRef<Omit<Partial<PersistedUiState>, "version" | "savedAt">>({});

  const closeMobileBackOverlays = useCallback(() => {
    setMenuOpen(false);
    setVoiceLogOpen(false);
    setVoiceSettingsOpen(false);
    setRestoreHistoryOpen(false);
    setCloudLoadOpen(false);
    setTextImportOpen(false);
    setMergePreview(null);
    removeSharedNotebookHash();
    setSharedNotebookRoot(null);
    setOutlineEditorOpen(false);
    setOutlineEditorRootId(null);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, []);

  const refreshHostedSession = useCallback(async () => {
    if (!publicServiceMode) return;
    try {
      setHostedSessionLoading(true);
      setHostedSessionError("");
      setHostedSession(await fetchHostedServiceSession());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mind Atlas service session could not be loaded.";
      setHostedSessionError(message);
    } finally {
      setHostedSessionLoading(false);
    }
  }, [publicServiceMode, t]);

  useVisualViewportHeight(commandInputEditing);
  useMobileBackButtonGuard({ closeOverlays: closeMobileBackOverlays });

  useEffect(() => {
    void refreshHostedSession();
  }, [refreshHostedSession]);

  useEffect(() => {
    if (!publicServiceMode) return;
    let refreshTimer: number | null = null;
    const handleRefreshRequest = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshHostedSession();
      }, 180);
    };
    window.addEventListener(HOSTED_SERVICE_SESSION_REFRESH_EVENT, handleRefreshRequest);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener(HOSTED_SERVICE_SESSION_REFRESH_EVENT, handleRefreshRequest);
    };
  }, [publicServiceMode, refreshHostedSession]);

  useEffect(() => {
    let cancelled = false;
    if (publicServiceMode) {
      const hostedShareToken = readHostedShareTokenFromUrl();
      if (hostedShareToken) {
        void loadHostedSharedNotebook(hostedShareToken)
          .then((result) => {
            if (cancelled) return;
            setSharedNotebookRoot(createTextOnlyNotebookRoot(result.root));
          })
          .catch((error) => {
            if (cancelled) return;
            console.error("Failed to read hosted Mind Atlas share URL", error);
            window.alert(importErrorMessage(t("error.sharedLinkRead"), error));
            removeSharedNotebookHash();
          });
        return () => {
          cancelled = true;
        };
      }
    }

    try {
      const sharedRoot = readSharedNotebookFromUrl();
      if (sharedRoot) setSharedNotebookRoot(publicServiceMode ? createTextOnlyNotebookRoot(sharedRoot) : sharedRoot);
    } catch (error) {
      console.error("Failed to read shared Mind Atlas URL", error);
      window.alert(importErrorMessage(t("error.sharedLinkRead"), error));
      removeSharedNotebookHash();
    }
    return () => {
      cancelled = true;
    };
  }, [publicServiceMode]);

  useEffect(() => {
    if (uiRestoreAppliedRef.current) return;
    if (notebookPersistenceStatus !== "ready") return;
    uiRestoreAppliedRef.current = true;
    if (!persistedUiState?.selectedNodeId) return;
    if (!findNode(atlasRoot, persistedUiState.selectedNodeId)) return;
    selectNodeInPlace(persistedUiState.selectedNodeId);
  }, [atlasRoot, notebookPersistenceStatus, persistedUiState, selectNodeInPlace]);

  useEffect(() => {
    latestUiStateRef.current = {
      selectedNodeId,
      renderQuality,
      layoutMode,
      vrModeEnabled,
      mobilePanelTab,
    };
  }, [layoutMode, mobilePanelTab, renderQuality, selectedNodeId, vrModeEnabled]);

  useEffect(() => {
    if (!uiPersistenceReadyRef.current) {
      uiPersistenceReadyRef.current = true;
      return;
    }
    persistUiStatePatch(latestUiStateRef.current);
  }, [layoutMode, mobilePanelTab, renderQuality, selectedNodeId, vrModeEnabled]);

  useEffect(() => {
    if (!persistedUiState?.layoutMode) return;
    setLayoutMode(persistedUiState.layoutMode);
  }, [persistedUiState, setLayoutMode]);

  useEffect(() => {
    if (aboutDemoConfig || notebookPersistenceStatus !== "ready" || !onboarding.shouldInitializePracticeAtlas) return;
    const applicationKey = `${locale}:${TUTORIAL_PRACTICE_ROOT_ID}`;
    if (tutorialPracticeAppliedRef.current === applicationKey) return;
    tutorialPracticeAppliedRef.current = applicationKey;

    const tutorialRoot = createTutorialPracticeNotebook(t);
    const overview = getTutorialPracticeOverview(tutorialRoot);
    analyticsIgnoreNextNotebookRef.current = true;
    importNotebook(tutorialRoot, tutorialRoot.title, {}, {
      selectedNodeId: TUTORIAL_PRACTICE_ROOT_ID,
      requestTitleEdit: false,
    });
    setLayoutMode("phyllotaxis");
    setMobilePanelTab("editor");
    setMobileWorkspacePanelRevealed(false);
    useAtlasStore.setState((state) => ({
      titleEditRequestId: null,
      bodyEditRequestId: null,
      focusRequest: {
        ...overview,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
    onboarding.markPracticeAtlasReady();
  }, [
    aboutDemoConfig,
    importNotebook,
    locale,
    notebookPersistenceStatus,
    onboarding.markPracticeAtlasReady,
    onboarding.shouldInitializePracticeAtlas,
    setLayoutMode,
    t,
  ]);

  useEffect(() => {
    if (onboarding.tutorialStep !== "selectNode" || selectedNodeId !== TUTORIAL_PRACTICE_TARGET_ID) return;
    onboarding.markPracticeNodeSelected();
    setMobilePanelTab("editor");
    if (!tutorialTrackedStepsRef.current.has("select_node")) {
      tutorialTrackedStepsRef.current.add("select_node");
      trackProductEvent("tutorial_step_completed", { step: "select_node" });
    }
  }, [onboarding.markPracticeNodeSelected, onboarding.tutorialStep, selectedNodeId]);

  const handleTutorialNodeTextEdited = useCallback(
    (nodeId: string) => {
      if (onboarding.tutorialStep !== "editNode" || nodeId !== TUTORIAL_PRACTICE_TARGET_ID) return;
      onboarding.markPracticeNodeEdited();
      if (!tutorialTrackedStepsRef.current.has("edit_node")) {
        tutorialTrackedStepsRef.current.add("edit_node");
        trackProductEvent("tutorial_step_completed", { step: "edit_node" });
      }
    },
    [onboarding.markPracticeNodeEdited, onboarding.tutorialStep],
  );

  useEffect(() => {
    if (!onboarding.showRootPulse || layoutMode === "phyllotaxis") return;
    const nextUiState = { ...latestUiStateRef.current, layoutMode: "phyllotaxis" as const };
    latestUiStateRef.current = nextUiState;
    setLayoutMode("phyllotaxis");
    persistUiStatePatch(nextUiState);
  }, [layoutMode, onboarding.showRootPulse, setLayoutMode]);

  useEffect(() => {
    let timeout: number | null = null;
    const handleBirthUnavailable = (event: Event) => {
      const mode = (event as CustomEvent<{ layoutMode?: unknown }>).detail?.layoutMode;
      const label = isAtlasLayoutMode(mode) ? getAtlasLayoutModeLabel(mode) : t("label.layout.this");
      setLayoutBirthUnavailableMessage(t("status.layoutBirthUnavailable", { mode: label }));
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        timeout = null;
        setLayoutBirthUnavailableMessage("");
      }, LAYOUT_BIRTH_UNAVAILABLE_NOTICE_MS);
    };
    window.addEventListener(UNIVERSE_BACKGROUND_BIRTH_UNAVAILABLE_EVENT, handleBirthUnavailable);
    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      window.removeEventListener(UNIVERSE_BACKGROUND_BIRTH_UNAVAILABLE_EVENT, handleBirthUnavailable);
    };
  }, [t]);

  useEffect(() => {
    const saveUiState = () => persistUiStatePatch(latestUiStateRef.current);
    const syncPageActive = () => {
      const active = isPageRuntimeActive();
      if (!active) saveUiState();
      setPageActive(active);
    };
    const handlePageShow = () => setPageActive(isPageRuntimeActive());
    const handleHiddenLifecycle = () => {
      saveUiState();
      setPageActive(false);
    };

    document.addEventListener("visibilitychange", syncPageActive);
    document.addEventListener("freeze", handleHiddenLifecycle);
    document.addEventListener("resume", syncPageActive);
    window.addEventListener("pagehide", handleHiddenLifecycle);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("beforeunload", saveUiState);
    return () => {
      document.removeEventListener("visibilitychange", syncPageActive);
      document.removeEventListener("freeze", handleHiddenLifecycle);
      document.removeEventListener("resume", syncPageActive);
      window.removeEventListener("pagehide", handleHiddenLifecycle);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("beforeunload", saveUiState);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && globalMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [menuOpen]);

  useEffect(() => {
    const revealMobileWorkspacePanel = () => {
      if (!isMobileWorkspacePanelRevealTarget()) return;
      if (!onboarding.showMainChrome) return;
      const state = useAtlasStore.getState();
      if (!publicServiceMode && aiFeaturesUnlocked && !shouldShowCommandDock(state.atlasRoot.id, state.selectedNodeId, state.viewport)) {
        setMobileWorkspacePanelRevealed(false);
        return;
      }
      setMobileWorkspacePanelRevealed(true);
      setMobilePanelTab(aiFeaturesUnlocked ? "command" : "operation");
      setRenderWorkspacePanel(true);
    };
    window.addEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, revealMobileWorkspacePanel);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_CLICK_EVENT, revealMobileWorkspacePanel);
  }, [aiFeaturesUnlocked, onboarding.showMainChrome, publicServiceMode]);

  useEffect(() => {
    if (selectedNodeId !== atlasRoot.id) {
      setMobileWorkspacePanelRevealed(false);
    }
  }, [atlasRoot.id, selectedNodeId]);

  useEffect(() => {
    if (!publicServiceMode && aiFeaturesUnlocked && !showCommandDock) setMobileWorkspacePanelRevealed(false);
  }, [aiFeaturesUnlocked, publicServiceMode, showCommandDock]);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistRenderQualityPreference(renderQuality);
  }, [renderQuality]);

  usePreventBrowserViewportGestures(Boolean(aboutDemoConfig));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RENDER_QUALITY_STORAGE_KEY) return;
      if (!isRenderQuality(event.newValue)) return;
      setRenderQuality(event.newValue);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!voiceLogOpen) return;
    markVoiceLogSeen();
  }, [voiceLogOpen, voiceLogEntries.length, markVoiceLogSeen]);

  useEffect(() => {
    if (aiFeaturesUnlocked || mobilePanelTab !== "command") return;
    setMobilePanelTab("operation");
  }, [aiFeaturesUnlocked, mobilePanelTab]);

  useEffect(() => {
    if (!showTutorialOperationFallback) return;
    setMobilePanelTab("operation");
  }, [showTutorialOperationFallback]);

  useEffect(() => {
    if (showWorkspacePanel) {
      setRenderWorkspacePanel(true);
      return;
    }
    if (!pageActive) return;
    const timeout = window.setTimeout(() => setRenderWorkspacePanel(false), WORKSPACE_PANEL_EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [pageActive, showWorkspacePanel]);

  useEffect(() => {
    if (onboarding.showMainChrome) return;
    setMenuOpen(false);
  }, [onboarding.showMainChrome]);

  useEffect(() => {
    if (!voiceLogReadable) setVoiceLogOpen(false);
    if (!cloudNotebooksAvailable) setCloudLoadOpen(false);
    if (aiFeaturesUnlocked) return;
    setVoiceSettingsOpen(false);
  }, [aiFeaturesUnlocked, cloudNotebooksAvailable, voiceLogReadable]);

  useEffect(() => {
    if (!onboarding.shouldApplyUniverseTitlePrompt) return;
    onboarding.markUniverseTitlePromptApplied();
  }, [
    onboarding.markUniverseTitlePromptApplied,
    onboarding.shouldApplyUniverseTitlePrompt,
  ]);

  useEffect(() => {
    setFullscreenSupported(Boolean(document.documentElement.requestFullscreen));
  }, []);

  useMobileNotificationPulses(notificationPulses, atlasRoot, mobileNotificationsEnabled, mobileNotificationPermission);

  useEffect(() => {
    void restoreAttachmentPreviews().catch((error) => {
      console.error("Attachment preview restore failed", error);
    });
  }, [restoreAttachmentPreviews]);

  useEffect(() => {
    if (publicServiceMode || aboutDemoConfig) return;
    let recoveryRunning = false;
    const recover = () => {
      if (recoveryRunning) return;
      recoveryRunning = true;
      void recoverCompletedCodexRuns()
        .then(() => recoverMissedAgentRuns())
        .catch((error) => console.error("Local agent run recovery failed", error))
        .finally(() => {
          recoveryRunning = false;
        });
    };
    const handleVisibility = () => {
      if (!document.hidden) recover();
    };
    recover();
    const interval = window.setInterval(recover, 60_000);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", recover);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", recover);
    };
  }, [aboutDemoConfig, publicServiceMode, recoverCompletedCodexRuns, recoverMissedAgentRuns]);

  const handleExportLight = async () => {
    try {
      await saveNotebookNow();
      const blob = new Blob([exportNotebook()], { type: "application/mindatlas+json" });
      downloadBlob(blob, `${datasetFileName(atlasRoot.title)}.mindatlas`);
      setMenuOpen(false);
    } catch (error) {
      const message = exportErrorMessage(t("error.lightExport"), error);
      console.error(message, error);
      window.alert(message);
    }
  };

  const handleExportPackage = async () => {
    let result: NotebookPackageResult;
    try {
      await saveNotebookNow();
      result = await createNotebookPackage(atlasRoot, attachmentPreviewUrls);
    } catch (error) {
      const fallback = confirmJsonOnlyPackageFallback(atlasRoot, t("error.packageExport"), error);
      if (!fallback) return;
      result = fallback;
    }
    downloadBlob(result.blob, `${datasetFileName(atlasRoot.title)}.mindatlaspkg`);
    showPackageResultNotice(result);
    setMenuOpen(false);
  };

  const prepareHostedCloudNotebook = () => {
    const root = createTextOnlyNotebookRoot(atlasRoot);
    const sizeBytes = textOnlyNotebookSizeBytes(root);
    if (sizeBytes > CLOUD_NOTEBOOK_MAX_BYTES) {
      throw new Error(t("dialog.cloud.tooLarge"));
    }
    return { root, sizeBytes };
  };

  const rememberCurrentCloudNotebook = (entry: CloudNotebookEntry, root: AtlasNode = useAtlasStore.getState().atlasRoot) => {
    const baseline = cloudNotebookFingerprint(root);
    setCurrentCloudNotebook(entry);
    setCurrentCloudBaseline(baseline);
    if (hostedSession?.user?.id) storeCurrentCloudNotebook(hostedSession.user.id, entry, baseline);
  };

  const forgetCurrentCloudNotebook = () => {
    setCurrentCloudNotebook(null);
    setCurrentCloudBaseline("");
    clearStoredCurrentCloudNotebook();
  };

  const handleSaveToCloud = async () => {
    try {
      setCloudError("");
      setCloudStatus(t("status.cloud.saving"));
      await saveNotebookNow();
      if (publicServiceMode) {
        if (!hostedAuthenticated) {
          setCloudStatus("");
          trackProductEvent("google_login_started", { trigger: "cloud_save" }, { immediate: true });
          startHostedGoogleLogin("cloud_save");
          return;
        }
        const { root } = prepareHostedCloudNotebook();
        const saved = await saveHostedCloudNotebook(root, root.title || atlasRoot.title || "Mind Atlas");
        rememberCurrentCloudNotebook(saved, root);
        const prunedText = saved.prunedCount ? t("dialog.cloud.oldSavesDeleted", { count: saved.prunedCount }) : "";
        setCloudStatus(t("status.cloud.savedPruned", { name: saved.title || saved.name, detail: prunedText }));
        window.alert(t("dialog.cloud.saved", { name: saved.title || saved.name, detail: prunedText ? `\n${prunedText}` : "" }));
        setMenuOpen(false);
        return;
      }
      let result: NotebookPackageResult;
      try {
        result = await createNotebookPackage(atlasRoot, attachmentPreviewUrls);
      } catch (packageError) {
        const fallback = confirmJsonOnlyPackageFallback(atlasRoot, t("error.cloudPackageCreation"), packageError);
        if (!fallback) {
          setCloudError(exportErrorMessage(t("error.cloudBeforeUpload"), packageError));
          setCloudStatus("");
          return;
        }
        result = fallback;
      }
      const saved = await saveCloudNotebookPackage(result.blob, `${datasetFileName(atlasRoot.title)}.mindatlaspkg`);
      setCloudStatus(result.packageKind === "json"
        ? t("status.cloud.savedJsonOnly", { name: saved.name })
        : t("status.cloud.saved", { name: saved.name }));
      window.alert(t("dialog.cloud.localSaved", { name: saved.name }));
      showPackageResultNotice(result);
      setMenuOpen(false);
    } catch (error) {
      const message = exportErrorMessage(t("error.cloudSave"), error);
      setCloudError(message);
      setCloudStatus("");
      window.alert(message);
    }
  };

  const refreshCloudNotebooks = async () => {
    try {
      setCloudLoading(true);
      setCloudError("");
      if (publicServiceMode) {
        if (!hostedAuthenticated) {
          setCloudNotebooks([]);
      setCloudDirectory(t("menu.googleLoginRequired"));
          return;
        }
        const result = await listHostedCloudNotebooks();
        setCloudNotebooks(result.notebooks);
        setCloudDirectory(result.directory || "Mind Atlas cloud text storage");
        setCloudQuota(result.quota ?? null);
        return;
      }
      const result = await listCloudNotebookPackages();
      setCloudNotebooks(result.notebooks);
      setCloudDirectory(result.directory);
      setCloudQuota(result.quota ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud notebook list failed.";
      setCloudError(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleOpenCloudLoad = () => {
    if (publicServiceMode && !hostedAuthenticated) {
      trackProductEvent("google_login_started", { trigger: "account" }, { immediate: true });
      startHostedGoogleLogin("account");
      return;
    }
    setCloudLoadOpen(true);
    setMenuOpen(false);
    void refreshCloudNotebooks();
  };

  const handleOpenRestoreHistory = () => {
    setRestoreHistoryOpen(true);
    setMenuOpen(false);
    void refreshNotebookSnapshots();
  };

  const handleShareNotebookImage = async () => {
    if (shareBusy) return;
    try {
      setShareBusy(true);
      if (publicServiceMode) {
        if (!hostedAuthenticated) {
      setContextCopyStatus(t("status.cloud.loginRequired"));
          trackProductEvent("google_login_started", { trigger: "share" }, { immediate: true });
          startHostedGoogleLogin("share");
          return;
        }
        setCloudLoadOpen(true);
        setMenuOpen(false);
        void refreshCloudNotebooks();
        setCloudStatus(t("status.cloud.selectToShare"));
        setContextCopyStatus(t("status.cloud.selectFile"));
        return;
      }
      setContextCopyStatus(t("status.share.preparingImage"));
      const target = universeShareTargetRef.current;
      if (!target) throw new Error("The universe view is not ready.");
      const shareTitle = atlasRoot.title || "Mind Atlas";
      const image = await createAtlasShareImage(target, shareTitle, theme);
      const shareData = createAtlasImageShareData(image, shareTitle);
      if (navigator.share && navigator.canShare?.({ files: [image] })) {
        try {
          await navigator.share(shareData);
          setContextCopyStatus(t("status.share.sheetOpened"));
          window.setTimeout(() => {
            setContextCopyStatus((current) => (current === "Share sheet opened." ? "" : current));
          }, 5000);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setContextCopyStatus("");
            return;
          }
          console.warn("Native image share failed. Downloading the image instead.", error);
        }
      }
      downloadBlob(image, image.name);
      setContextCopyStatus(t("status.share.imageDownloaded"));
    } catch (error) {
      const message = exportErrorMessage(t("error.imageShare"), error);
      console.error(message, error);
      setContextCopyStatus("");
      window.alert(message);
    } finally {
      setShareBusy(false);
    }
  };

  const handleCreateSharedNotebookLink = async () => {
    if (shareBusy) return;
    setMenuOpen(false);
    try {
      setShareBusy(true);
      setContextCopyStatus(t("status.share.creatingEmbeddedUrl"));
      await saveNotebookNow();
      const share = await createSharedNotebookLink(atlasRoot);
      await copyTextToClipboard(share.url);
      setContextCopyStatus(t("status.share.embeddedUrlCopied", {
        characters: share.encodedLength.toLocaleString(locale),
        nodes: share.nodeCount,
      }));
    } catch (error) {
      const message = exportErrorMessage(t("error.embeddedUrl"), error);
      console.error(message, error);
      setContextCopyStatus("");
      window.alert(message);
    } finally {
      setShareBusy(false);
    }
  };

  const importSharedNotebook = async () => {
    if (!sharedNotebookRoot || sharedNotebookImporting) return;
    try {
      setSharedNotebookImporting(true);
      const root = publicServiceMode ? createTextOnlyNotebookRoot(sharedNotebookRoot) : sharedNotebookRoot;
      analyticsIgnoreNextNotebookRef.current = true;
      importNotebook(root, root.title || "Shared Mind Atlas", {});
      forgetCurrentCloudNotebook();
      trackProductEvent("shared_atlas_imported", {}, { immediate: true });
      removeSharedNotebookHash();
      setSharedNotebookRoot(null);
    } catch (error) {
      console.error("Shared Mind Atlas import failed", error);
      window.alert(importErrorMessage(t("error.sharedImport"), error));
    } finally {
      setSharedNotebookImporting(false);
    }
  };

  const handleImportSharedNotebook = () => {
    if (!sharedNotebookRoot || sharedNotebookImporting) return;
    requestWorkspaceSwitch(sharedNotebookRoot.title || "Shared Mind Atlas", () => {
      void importSharedNotebook();
    });
  };

  const handleDismissSharedNotebook = () => {
    removeSharedNotebookHash();
    setSharedNotebookRoot(null);
  };

  const loadCloudNotebook = async (entry: CloudNotebookEntry) => {
    try {
      setCloudLoading(true);
      setCloudError("");
      if (publicServiceMode) {
        if (!entry.id) throw new Error("Cloud notebook id is missing.");
        const result = await loadHostedCloudNotebook(entry.id);
        const root = createTextOnlyNotebookRoot(result.root);
        analyticsIgnoreNextNotebookRef.current = true;
        importNotebook(root, undefined, {});
        rememberCurrentCloudNotebook(result.entry, useAtlasStore.getState().atlasRoot);
        return true;
      }
      const blob = await downloadCloudNotebookPackage(entry.name);
      const file = new File([blob], entry.name, { type: "application/x-mindatlas-package" });
      const { root, attachmentPreviewUrls, attachmentBlobs } = await importNotebookPackage(file);
      await replaceStoredAttachmentBlobs(root, attachmentBlobs);
      importNotebook(root, undefined, attachmentPreviewUrls);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud notebook load failed.";
      setCloudError(message);
      return false;
    } finally {
      setCloudLoading(false);
    }
  };

  const completeCloudLoad = (entry: CloudNotebookEntry, options: CloudLoadCloseOptions) => {
    void loadCloudNotebook(entry).then((loaded) => {
      if (!loaded) return;
      if (options.closeCloudDialog) setCloudLoadOpen(false);
      if (options.closeStartSpace) {
        setStartSpaceOpen(false);
        setOutlineEditorOpen(false);
        setOutlineEditorRootId(null);
        setMobileWorkspacePanelRevealed(false);
      }
    });
  };

  const requestWorkspaceSwitch = (nextName: string, action: () => void) => {
    if (publicServiceMode && currentCloudDirty && currentCloudNotebook?.id) {
      pendingWorkspaceSwitchActionRef.current = action;
      setPendingWorkspaceSwitch({ nextName });
      return;
    }
    action();
  };

  const requestCloudLoad = (entry: CloudNotebookEntry, options: CloudLoadCloseOptions) => {
    requestWorkspaceSwitch(entry.title || entry.name, () => completeCloudLoad(entry, options));
  };

  const handleLoadCloudNotebook = (entry: CloudNotebookEntry) => {
    requestCloudLoad(entry, { closeCloudDialog: true, closeStartSpace: false });
  };

  const handleHostedSaveCloudAs = async (): Promise<CloudNotebookEntry | null> => {
    if (!publicServiceMode) return null;
    const title = window.prompt(formatAppMessage("ui.app.saveCurrentAtlasAs.999bb1c"), atlasRoot.title || "Mind Atlas");
    if (!title?.trim()) return null;
    try {
      setCloudLoading(true);
      setCloudError("");
      setCloudStatus(t("status.cloud.savingShort"));
      await saveNotebookNow();
      const { root } = prepareHostedCloudNotebook();
      const saved = await saveHostedCloudNotebook(root, title.trim());
      rememberCurrentCloudNotebook(saved, root);
      setCloudStatus(t("status.cloud.saved", { name: saved.title || saved.name }));
      await refreshCloudNotebooks();
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud save failed.";
      setCloudError(message);
      setCloudStatus("");
      window.alert(message);
      return null;
    } finally {
      setCloudLoading(false);
    }
  };

  const overwriteCloudNotebook = async (entry: CloudNotebookEntry, confirmOverwrite: boolean) => {
    if (!publicServiceMode || !entry.id) return false;
    if (confirmOverwrite) {
      const confirmed = window.confirm(t("dialog.cloud.overwriteConfirm", { name: entry.title || entry.name }));
      if (!confirmed) return false;
    }
    try {
      setCloudLoading(true);
      setCloudError("");
      setCloudStatus(t("status.cloud.overwriting"));
      await saveNotebookNow();
      const { root } = prepareHostedCloudNotebook();
      const saved = await updateHostedCloudNotebook(entry.id, root, entry.title || root.title || atlasRoot.title || "Mind Atlas");
      rememberCurrentCloudNotebook(saved, root);
      setCloudStatus(t("status.cloud.overwritten", { name: saved.title || saved.name }));
      await refreshCloudNotebooks();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud overwrite failed.";
      setCloudError(message);
      setCloudStatus("");
      window.alert(message);
      return false;
    } finally {
      setCloudLoading(false);
    }
  };

  const handleHostedOverwriteCloudNotebook = async (entry: CloudNotebookEntry) => {
    await overwriteCloudNotebook(entry, true);
  };

  const handleHostedRenameCloudNotebook = async (entry: CloudNotebookEntry) => {
    if (!publicServiceMode || !entry.id) return;
    const title = window.prompt(formatAppMessage("ui.app.renameCloudFile.88036dc"), entry.title || entry.name.replace(/\.mindatlas$/i, ""));
    if (!title?.trim()) return;
    try {
      setCloudLoading(true);
      setCloudError("");
      const renamed = await renameHostedCloudNotebook(entry.id, title.trim());
      if (entry.id === currentCloudNotebook?.id) rememberCurrentCloudNotebook(renamed);
      setCloudStatus(t("status.cloud.renamed", { name: renamed.title || renamed.name }));
      await refreshCloudNotebooks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud rename failed.";
      setCloudError(message);
      window.alert(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleHostedDeleteCloudNotebook = async (entry: CloudNotebookEntry) => {
    if (!publicServiceMode || !entry.id) return;
    const confirmed = window.confirm(t("dialog.cloud.deleteConfirm", { name: entry.title || entry.name }));
    if (!confirmed) return;
    try {
      setCloudLoading(true);
      setCloudError("");
      await deleteHostedCloudNotebook(entry.id);
      if (entry.id === currentCloudNotebook?.id) {
        forgetCurrentCloudNotebook();
      }
      setCloudStatus(t("status.cloud.deleted", { name: entry.title || entry.name }));
      await refreshCloudNotebooks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud delete failed.";
      setCloudError(message);
      window.alert(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleHostedShareCloudNotebook = async (entry: CloudNotebookEntry) => {
    if (!publicServiceMode || !entry.id) return;
    try {
      setCloudLoading(true);
      setCloudError("");
      const share = await shareHostedCloudNotebook(entry.id);
      if (entry.id === currentCloudNotebook?.id) rememberCurrentCloudNotebook(share.entry);
      await copyTextToClipboard(share.url);
      setCloudStatus(t("status.cloud.shareCopied", { name: share.entry.title || share.entry.name }));
      setContextCopyStatus(t("status.cloud.publicCopied"));
      window.setTimeout(() => {
        setContextCopyStatus((current) => (current === "Public Mind Atlas link copied." ? "" : current));
      }, 7000);
      await refreshCloudNotebooks();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud share failed.";
      setCloudError(message);
      setContextCopyStatus("");
      window.alert(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleSaveAndOpenPendingCloudNotebook = async () => {
    const pending = pendingWorkspaceSwitch;
    const current = currentCloudNotebook;
    if (!pending || !current) return;
    const saved = await overwriteCloudNotebook(current, false);
    if (!saved) return;
    const action = pendingWorkspaceSwitchActionRef.current;
    pendingWorkspaceSwitchActionRef.current = null;
    setPendingWorkspaceSwitch(null);
    action?.();
  };

  const handleDiscardAndOpenPendingCloudNotebook = () => {
    const pending = pendingWorkspaceSwitch;
    if (!pending) return;
    const action = pendingWorkspaceSwitchActionRef.current;
    pendingWorkspaceSwitchActionRef.current = null;
    setPendingWorkspaceSwitch(null);
    action?.();
  };

  const importNotebookFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".mindatlaspkg")) {
      if (publicServiceMode) {
        window.alert(formatAppMessage("ui.app.theHostedServiceCannotImport.a105a9c"));
        return;
      }
      try {
        const { root, attachmentPreviewUrls, attachmentBlobs } = await importNotebookPackage(file);
        await replaceStoredAttachmentBlobs(root, attachmentBlobs);
        importNotebook(root, datasetNameFromFile(file.name), attachmentPreviewUrls);
        forgetCurrentCloudNotebook();
        setMenuOpen(false);
      } catch (error) {
        console.error("Notebook package import failed", error);
        window.alert(importErrorMessage(t("error.packageImport"), error));
      }
      return;
    }

    const externalFormat = detectImportFormat(file.name);
    if (externalFormat) {
      try {
        const result = await importExternalNotebookFile(file);
        const root = publicServiceMode ? createTextOnlyNotebookRoot(result.root) : result.root;
        await replaceStoredAttachmentBlobs(root, {});
        importNotebook(root, result.datasetName);
        forgetCurrentCloudNotebook();
        setMenuOpen(false);
      } catch (error) {
        console.error(`${externalFormat} import failed`, error);
        window.alert(importErrorMessage(t("error.externalImport", { format: externalFormatLabel(externalFormat) }), error));
      }
      return;
    }

    try {
      const parsedRoot = JSON.parse(await file.text()) as AtlasNode;
      const root = publicServiceMode ? createTextOnlyNotebookRoot(parsedRoot) : parsedRoot;
      await replaceStoredAttachmentBlobs(root, {});
      importNotebook(root, datasetNameFromFile(file.name));
      forgetCurrentCloudNotebook();
      setMenuOpen(false);
    } catch (error) {
      console.error("Notebook import failed", error);
      window.alert(importErrorMessage(t("error.notebookImport"), error));
    }
  };

  const handleImportFile = (file: File) => {
    requestWorkspaceSwitch(file.name, () => {
      void importNotebookFile(file);
    });
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    handleImportFile(file);
    event.target.value = "";
  };

  const parseTextImportMarkdown = () => importMarkdownText(textImportValue, selectedNode.title || "Imported text outline").root;

  const handleReplaceActiveNodeBody = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      const body = markdownBodyForActiveNodeReplacement(importedRoot);
      updateNode(selectedNodeId, { body, summary: firstMarkdownLine(body) || selectedNode.summary });
      setTextImportValue("");
      setTextImportOpen(false);
      setMenuOpen(false);
    } catch (error) {
      console.error("Replace active node body failed", error);
      window.alert(importErrorMessage(t("error.replaceBody"), error));
    }
  };

  const handleReplaceActiveSubtree = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      applyOutlineSubtree(selectedNodeId, atlasNodeToOutlineInput(importedRoot, selectedNodeId), { focusKey: selectedNodeId });
      setTextImportValue("");
      setTextImportOpen(false);
      setMenuOpen(false);
    } catch (error) {
      console.error("Replace active subtree failed", error);
      window.alert(importErrorMessage(t("error.replaceSubtree"), error));
    }
  };

  const handleAppendAsChildren = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      const appended = importedRoot.children.length ? importedRoot.children : [importedRoot];
      applyOutlineSubtree(
        selectedNodeId,
        {
          id: selectedNode.id,
          clientKey: selectedNode.id,
          title: selectedNode.title,
          body: selectedNode.body,
          children: [
            ...selectedNode.children.map((child) => atlasNodeToOutlineInput(child)),
            ...appended.map((child) => atlasNodeToOutlineInput(child)),
          ],
        },
        { focusKey: appended[0]?.id },
      );
      setTextImportValue("");
      setTextImportOpen(false);
      setMenuOpen(false);
    } catch (error) {
      console.error("Append as children failed", error);
      window.alert(importErrorMessage(t("error.appendChildren"), error));
    }
  };

  const handleOpenPreviewMerge = () => {
    try {
      const importedRoot = parseTextImportMarkdown();
      setMergePreview(createMergePreviewState(selectedNode, importedRoot));
    } catch (error) {
      console.error("Preview merge failed", error);
      window.alert(importErrorMessage(t("error.previewMerge"), error));
    }
  };

  const handleApplyPreviewMerge = () => {
    if (!mergePreview) return;
    applyOutlineSubtree(selectedNodeId, mergePreviewToOutline(selectedNode, mergePreview), { focusKey: selectedNodeId });
    setTextImportValue("");
    setTextImportOpen(false);
    setMergePreview(null);
    setMenuOpen(false);
  };

  const handleImportDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragImportActive(true);
  };

  const handleImportDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragImportActive(true);
  };

  const handleImportDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragImportActive(false);
  };

  const handleImportDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragImportActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleImportFile(file);
  };

  const openStartSpaceDialog = (source: StartSpaceSource) => {
    setTutorialCompletionStep(null);
    setTutorialStartSpaceDueAt(null);
    setStartSpaceSource(source);
    setStartSpaceOpen(true);
    setMenuOpen(false);
    if (cloudNotebooksAvailable) void refreshCloudNotebooks();
  };

  const startWithTemplate = async (templateId: NotebookTemplateId) => {
    try {
      setCloudLoading(true);
      setCloudError("");
      const root = createNotebookFromTemplate(templateId, locale === "ja" ? "ja" : "en");
      await replaceStoredAttachmentBlobs(root, {});
      analyticsIgnoreNextNotebookRef.current = true;
      importNotebook(root, root.title, {});
      forgetCurrentCloudNotebook();
      trackProductEvent("template_selected", { template_id: templateId }, { immediate: true });
      setStartSpaceOpen(false);
      setOutlineEditorOpen(false);
      setOutlineEditorRootId(null);
      setMobileWorkspacePanelRevealed(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start this template.";
      setCloudError(message);
      window.alert(message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleStartWithTemplate = (templateId: NotebookTemplateId) => {
    const template = NOTEBOOK_TEMPLATES.find((item) => item.id === templateId);
    requestWorkspaceSwitch(template ? t(template.titleMessageId) : t("startSpace.newTitle"), () => {
      void startWithTemplate(templateId);
    });
  };

  const handleStartWithCloudNotebook = async (entry: CloudNotebookEntry) => {
    requestCloudLoad(entry, { closeCloudDialog: false, closeStartSpace: true });
  };

  useEffect(() => {
    const tutorialState = tutorialCompletionRef.current;
    if (!tutorialState.initialized) {
      tutorialState.initialized = true;
      tutorialState.awaitingCompletion = !onboarding.showMainChrome;
      return;
    }
    if (!onboarding.showMainChrome) {
      tutorialState.awaitingCompletion = true;
      setTutorialStartSpaceDueAt(null);
      return;
    }
    if (!tutorialState.awaitingCompletion) return;
    tutorialState.awaitingCompletion = false;
    trackProductEvent("tutorial_completed", {}, { immediate: true });
    const delayMs = tutorialCompletionDelayMsRef.current;
    tutorialCompletionDelayMsRef.current = TUTORIAL_TEMPLATE_DELAY_MS;
    if (delayMs <= 0) {
      openStartSpaceDialog("tutorial");
      return;
    }
    setTutorialStartSpaceDueAt(Date.now() + delayMs);
  }, [onboarding.showMainChrome]);

  useEffect(() => {
    if (tutorialStartSpaceDueAt === null) return;
    const timeout = window.setTimeout(() => {
      setTutorialStartSpaceDueAt(null);
      setTutorialCompletionStep("complete");
    }, Math.max(0, tutorialStartSpaceDueAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [tutorialStartSpaceDueAt]);

  useEffect(() => {
    const mark = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".command-dock, .ai-feature-dialog, .voice-log-dialog")) return;
      if (event.isTrusted) analyticsLastUserInputAtRef.current = Date.now();
    };
    window.addEventListener("pointerdown", mark, true);
    window.addEventListener("keydown", mark, true);
    window.addEventListener("input", mark, true);
    return () => {
      window.removeEventListener("pointerdown", mark, true);
      window.removeEventListener("keydown", mark, true);
      window.removeEventListener("input", mark, true);
    };
  }, []);

  useEffect(() => {
    const metrics = notebookAnalyticsMetrics(atlasRoot);
    const previous = analyticsNotebookRef.current;
    analyticsNotebookRef.current = metrics;
    if (!previous || previous.rootId !== metrics.rootId) {
      analyticsIgnoreNextNotebookRef.current = false;
      return;
    }
    if (analyticsIgnoreNextNotebookRef.current) {
      analyticsIgnoreNextNotebookRef.current = false;
      return;
    }
    const nodeCreated = metrics.nodeCount > previous.nodeCount;
    const textChanged = Math.abs(metrics.textSize - previous.textSize) >= 3;
    if (!nodeCreated && !textChanged) return;
    const now = Date.now();
    if (now - analyticsLastUserInputAtRef.current > 5_000) return;
    if (nodeCreated && previous.nodeCount === 0) {
      trackProductEvent("first_node_created", { method: "canvas", node_count: metrics.nodeCount, max_depth: metrics.maxDepth });
    }
    if (now - analyticsLastMeaningfulAtRef.current >= 30_000) {
      analyticsLastMeaningfulAtRef.current = now;
      trackProductEvent("meaningful_edit", {
        kind: nodeCreated ? "node_created" : "text_edited",
        node_count: metrics.nodeCount,
        max_depth: metrics.maxDepth,
      });
    }
    const activationKey = `mind-atlas-analytics-activation:${metrics.rootId}`;
    if (metrics.nodeCount >= 5 && metrics.maxDepth >= 2 && window.localStorage.getItem(activationKey) !== "1") {
      window.localStorage.setItem(activationKey, "1");
      trackProductEvent("activation_reached", { node_count: metrics.nodeCount, max_depth: metrics.maxDepth }, { immediate: true });
    }
  }, [atlasRoot]);

  const handleInitialize = () => {
    openStartSpaceDialog("initialize");
  };

  const handleTutorialModeClick = () => {
    const confirmed = window.confirm(formatAppMessage("ui.app.tutorialModeWillEraseThe.4f40f19"));
    if (!confirmed) return;
    resetNotebook();
    const nextUiState = { ...latestUiStateRef.current, layoutMode: "phyllotaxis" as const };
    latestUiStateRef.current = nextUiState;
    setLayoutMode("phyllotaxis");
    persistUiStatePatch(nextUiState);
    tutorialCompletionDelayMsRef.current = TUTORIAL_TEMPLATE_DELAY_MS;
    setTutorialStartSpaceDueAt(null);
    setTutorialCompletionStep(null);
    setStartSpaceOpen(false);
    tutorialPracticeAppliedRef.current = "";
    tutorialTrackedStepsRef.current.clear();
    analyticsTutorialStartedRef.current = false;
    onboarding.startTutorialMode();
    setOutlineEditorOpen(false);
    setOutlineEditorRootId(null);
    setMobileWorkspacePanelRevealed(false);
    setMenuOpen(false);
  };

  const handleSkipTutorial = () => {
    trackProductEvent("tutorial_skipped", {}, { immediate: true });
    tutorialCompletionDelayMsRef.current = 0;
    onboarding.completeTutorial();
  };

  useEffect(() => {
    if (onboarding.showMainChrome || analyticsTutorialStartedRef.current) return;
    analyticsTutorialStartedRef.current = true;
    trackProductEvent("tutorial_started");
  }, [onboarding.showMainChrome]);

  const handleUndo = () => {
    undo();
    setMenuOpen(false);
  };

  const handleRedo = () => {
    redo();
    setMenuOpen(false);
  };

  useEffect(() => {
    const handleExplicitSaveShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (event.repeat || explicitSaveRunningRef.current || aboutDemoConfig) return;

      explicitSaveRunningRef.current = true;
      void (async () => {
        try {
          if (publicServiceMode && hostedAuthenticated) {
            if (currentCloudNotebook?.id) {
              const overwritten = await overwriteCloudNotebook(currentCloudNotebook, false);
              if (overwritten) {
                const message = t("status.cloud.overwritten", { name: currentCloudNotebook.title || currentCloudNotebook.name });
                setContextCopyStatus(message);
                window.setTimeout(() => setContextCopyStatus((current) => (current === message ? "" : current)), 2400);
              }
              return;
            }

            const saved = await handleHostedSaveCloudAs();
            if (saved) {
              const message = t("status.cloud.saved", { name: saved.title || saved.name });
              setContextCopyStatus(message);
              window.setTimeout(() => setContextCopyStatus((current) => (current === message ? "" : current)), 2400);
            }
            return;
          }

          await saveNotebookNow();
          const persistence = useAtlasStore.getState();
          if (persistence.notebookPersistenceStatus === "error") {
            throw new Error(persistence.notebookPersistenceError || "Notebook could not be saved locally.");
          }
          const message = t("status.notebook.savedLocally");
          setContextCopyStatus(message);
          window.setTimeout(() => setContextCopyStatus((current) => (current === message ? "" : current)), 2400);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Notebook save failed.";
          window.alert(message);
        } finally {
          explicitSaveRunningRef.current = false;
        }
      })();
    };

    window.addEventListener("keydown", handleExplicitSaveShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleExplicitSaveShortcut, { capture: true });
  }, [aboutDemoConfig, atlasRoot, currentCloudNotebook, hostedAuthenticated, publicServiceMode, saveNotebookNow, t]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLowerCase() !== "f" ||
        aboutDemoConfig ||
        !onboarding.showMainChrome
      ) {
        return;
      }
      event.preventDefault();
      setNodeSearchOpen(true);
      setMenuOpen(false);
    };

    window.addEventListener("keydown", handleSearchShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleSearchShortcut, { capture: true });
  }, [aboutDemoConfig, onboarding.showMainChrome]);

  useEffect(() => {
    if (!nodeSearchOpen) return;
    const handleSearchEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setNodeSearchOpen(false);
    };
    document.addEventListener("keydown", handleSearchEscape, true);
    return () => document.removeEventListener("keydown", handleSearchEscape, true);
  }, [nodeSearchOpen]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || !event.ctrlKey) return;
      if (isEditableShortcutTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "c") {
        event.preventDefault();
        void copyContextMarkdown(atlasRoot, selectedNodeId, "ancestors")
          .then((result) => {
            setContextCopyStatus(t("status.copy.copied", { stats: formatContextCopyStats(result) }));
            window.setTimeout(() => setContextCopyStatus(""), 2400);
          })
          .catch((error) => {
            setContextCopyStatus(error instanceof Error ? error.message : "Copy failed.");
            window.setTimeout(() => setContextCopyStatus(""), 2400);
          });
        return;
      }

      if (event.shiftKey) return;
      if (key === "z") {
        if (!canUndo) return;
        event.preventDefault();
        undo();
        setMenuOpen(false);
        return;
      }

      if (key === "y") {
        if (!canRedo) return;
        event.preventDefault();
        redo();
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleHistoryShortcut, { capture: true });
  }, [atlasRoot, canRedo, canUndo, redo, selectedNodeId, undo]);

  const handleOpenVoiceLog = () => {
    setVoiceLogOpen(true);
    markVoiceLogSeen();
    setMenuOpen(false);
  };

  const handleOpenVoiceSettings = () => {
    setVoiceSettingsOpen(true);
    setMenuOpen(false);
  };

  const handleFocusNotification = (id: string) => {
    focusNode(id);
    acknowledgeNodeNotification(id);
    showNotificationSnoozePrompt(id);
  };

  const handleRestartRealtime = () => {
    window.dispatchEvent(new Event(REALTIME_VOICE_RESTART_EVENT));
    setMenuOpen(false);
  };

  const handleToggleMobileNotifications = async () => {
    setMobileNotificationMessage("");
    if (!isMobileNotificationTarget()) {
      setMobileNotificationMessage(t("status.mobile.only"));
      setMobileNotificationPermission(getMobileNotificationPermission());
      return;
    }
    if (!isNotificationSupported()) {
      setMobileNotificationMessage(t("status.mobile.notificationsUnsupported"));
      setMobileNotificationPermission("unsupported");
      return;
    }
    if (mobileNotificationsEnabled) {
      persistMobileNotificationPreference(false);
      setMobileNotificationsEnabled(false);
      setMobileNotificationMessage(t("common.off"));
      return;
    }
    const permission =
      Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setMobileNotificationPermission(permission);
    const enabled = permission === "granted";
    persistMobileNotificationPreference(enabled);
    setMobileNotificationsEnabled(enabled);
    setMobileNotificationMessage(enabled ? "On" : permission === "denied" ? "Blocked in browser settings" : "Off");
  };

  const handleEnterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    } catch {
      // Android Chrome can refuse fullscreen outside direct user gestures or on unsupported surfaces.
    } finally {
      setMenuOpen(false);
    }
  };

  const handleToggleVrMode = async () => {
    setVrModeMessage("");
    if (vrModeEnabled) {
      setVrModeEnabled(false);
      setVrModeMessage(t("common.off"));
      return;
    }
    if (!isDeviceOrientationSupported()) {
      setVrModeMessage(t("status.device.unsupported"));
      return;
    }
    const permission = await requestDeviceOrientationAccess();
    if (permission !== "granted") {
      setVrModeEnabled(false);
      setVrModeMessage(permission === "denied" ? "Blocked in browser settings" : "Permission required");
      return;
    }
    setVrModeEnabled(true);
      setVrModeMessage(t("common.on"));
  };

  const handleRenderQualityChange = (quality: RenderQuality) => {
    setRenderQuality(quality);
    persistRenderQualityPreference(quality);
  };

  const handleLayoutModeChange = (mode: AtlasLayoutMode) => {
    setLayoutMode(mode);
    persistUiStatePatch({ ...latestUiStateRef.current, layoutMode: mode });
    setMenuOpen(false);
  };

  const handleOpenOutlineEditor = () => {
    setOutlineEditorRootId(selectedNodeId);
    setOutlineEditorOpen(true);
    setMobileWorkspacePanelRevealed(false);
    setRenderWorkspacePanel(false);
    setMenuOpen(false);
  };

  const handleCloseOutlineEditor = () => {
    setOutlineEditorOpen(false);
    setOutlineEditorRootId(null);
    setMobilePanelTab(aiFeaturesUnlocked ? "command" : "editor");
  };

  return (
    <main
      className={appClassName}
      data-theme={theme}
      data-focus-panel={focusPanelOpen ? "open" : "closed"}
      data-about-demo={aboutDemoConfig?.kind}
      onDragEnter={handleImportDragEnter}
      onDragOver={handleImportDragOver}
      onDragLeave={handleImportDragLeave}
      onDrop={handleImportDrop}
    >
      <UniverseCanvas
        theme={theme}
        vrPanEnabled={vrModeEnabled}
        renderQuality={renderQuality}
        layoutMode={layoutMode}
        pageActive={pageActive}
        initialCameraPose={persistedUiState?.cameraPose ?? null}
        shareTargetRef={universeShareTargetRef}
        tutorialRootBirthUnlocked={onboarding.showRootPulse}
        embedInteractionLocked={Boolean(aboutDemoConfig)}
        attachmentsEnabled={attachmentsEnabled}
        onRuntimeResume={handleCanvasRuntimeResume}
      />
      {onboarding.showRootPulse ? <div className="onboarding-center-pulse" aria-hidden="true" /> : null}
      {onboarding.message ? (
        <div
          className="onboarding-message tutorial-step-message"
          data-tutorial-step={onboarding.tutorialStep ?? undefined}
          role="status"
          aria-live="polite"
        >
          {onboarding.message}
        </div>
      ) : null}
      {contextCopyStatus ? (
        <div className="onboarding-message context-copy-toast" role="status" aria-live="polite">
          {contextCopyStatus}
        </div>
      ) : null}
      {layoutBirthUnavailableMessage ? (
        <div className="onboarding-message layout-birth-unavailable-toast" role="status" aria-live="polite">
          {layoutBirthUnavailableMessage}
        </div>
      ) : null}
      {dragImportActive ? (
        <div className="import-drop-overlay" role="status" aria-live="polite">
          <Upload size={28} />
          <span>{<I18nText id="ui.app.dropMarkdownOpmlFreemindOr.6670d93" />}</span>
        </div>
      ) : null}

      <header className="top-bar" aria-label={formatAppMessage("ui.app.mindAtlasStatus.36acaea")}>
        <div className="top-title-stack">
          <AtlasBreadcrumb path={onboarding.showLogoOnly ? [atlasRoot] : selectedPath} mobilePortrait={mobilePortraitBreadcrumb} onFocus={focusNode} />
          {onboarding.showLogoOnly ? (
            <button className="tutorial-skip-button" type="button" onClick={handleSkipTutorial}>
              <ArrowRight size={14} />
              {t("app.tutorial.skip")}
            </button>
          ) : null}
          {onboarding.showMainChrome ? (
            <>
              <DatasetTitleInput
                title={atlasRoot.title}
                placeholderTitle={onboarding.titlePrompt}
                onChange={(title) => updateNode(atlasRoot.id, { title })}
              />
              <UnreadNotificationLinks
                items={unreadNotificationLinks}
                voiceLogEntry={latestPartnerEntry}
                voiceLogUnreadCount={unreadPartnerEntries.length}
                onFocus={handleFocusNotification}
                onOpenVoiceLog={handleOpenVoiceLog}
              />
            </>
          ) : null}
        </div>
      </header>

      {onboarding.showMainChrome ? (
      <div ref={globalMenuRef} className="global-menu" aria-label={formatAppMessage("ui.app.atlasActions.8babf3a")}>
        {publicServiceMode ? (
          <button
            className={`ai-feature-button top-account-feature-button ${aiFeaturesUnlocked ? "is-active" : ""}`}
            type="button"
            onClick={() => setAiFeatureDialogOpen(true)}
            aria-label={hostedAccountFeatureLabel}
            title={hostedAccountFeatureLabel}
          >
            <Sparkles size={16} />
            <span>{hostedAccountFeatureLabel}</span>
            <small>{aiFeatureButtonBadge(hostedSession, hostedSessionLoading, hostedSessionError)}</small>
          </button>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={handleShareNotebookImage}
          disabled={shareBusy}
          aria-label={publicServiceMode ? t("app.shareCloud") : t("app.shareImage")}
          title={publicServiceMode ? t("app.shareCloud") : t("app.shareImage")}
        >
          <Share2 size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={t("app.openMenu")}>
          <MoreHorizontal size={19} />
        </button>
        {menuOpen ? (
          <div className="context-menu global-context-menu">
            {publicServiceMode ? (
              <button
                className={`mobile-menu-account-feature ${aiFeaturesUnlocked ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  setAiFeatureDialogOpen(true);
                  setMenuOpen(false);
                }}
                aria-label={hostedAccountFeatureLabel}
              >
                <Sparkles size={15} />
                <span>
                  {hostedAccountFeatureLabel}
                  <small>{aiFeatureButtonBadge(hostedSession, hostedSessionLoading, hostedSessionError)}</small>
                </span>
              </button>
            ) : null}
            <div className="context-menu-section" aria-label={t("menu.files.label")}>
              <span className="context-menu-section-title">{t("menu.files")}</span>
              <button type="button" onClick={handleInitialize}>
                <RotateCcw size={15} /> {t("menu.newSpace")}
              </button>
              <button type="button" onClick={() => { setNodeSearchOpen(true); setMenuOpen(false); }}>
                <Search size={15} />
                <span>
                  {t("menu.searchNodes")}
                  <small>{t("menu.searchNodes.detail")}</small>
                </span>
              </button>
              <button type="button" onClick={handleExportLight}>
                <Download size={15} />
                <span>
                  {t("menu.exportText")}
                  <small>{t("menu.exportText.detail")}</small>
                </span>
              </button>
              {!publicServiceMode ? (
                <button type="button" onClick={handleExportPackage}>
                  <Download size={15} />
                  <span>
                    {t("menu.exportFiles")}
                    <small>{t("menu.exportFiles.detail")}</small>
                  </span>
                </button>
              ) : null}
              {!publicServiceMode ? (
                <button type="button" onClick={handleCreateSharedNotebookLink} disabled={shareBusy}>
                  <Share2 size={15} />
                  <span>
                    {t("menu.embeddedUrl")}
                    <small>{t("menu.embeddedUrl.detail")}</small>
                  </span>
                </button>
              ) : null}
              <button type="button" onClick={handleOpenRestoreHistory}>
                <History size={15} />
                <span>
                  {t("menu.restore")}
                  <small>{notebookHistoryStatusLabel(notebookPersistenceStatus, notebookSnapshots.length, durableNotebookStorage, notebookPersistenceError)}</small>
                </span>
              </button>
              {publicServiceMode ? (
                <>
                  <button type="button" onClick={handleOpenCloudLoad}>
                    <CloudUpload size={15} />
                    <span>
                      {t("menu.cloudSave")}
                      <small>{cloudStatus || (hostedAuthenticated ? t("menu.cloudSave.detail") : t("menu.googleLoginRequired"))}</small>
                    </span>
                  </button>
                  <button type="button" onClick={handleOpenCloudLoad}>
                    <CloudDownload size={15} />
                    <span>
                      {t("menu.cloudLoad")}
                      <small>{cloudError || (hostedAuthenticated ? t("menu.cloudLoad.detail") : t("menu.googleLoginRequired"))}</small>
                    </span>
                  </button>
                </>
              ) : null}
              {aiFeaturesUnlocked && !publicServiceMode ? (
                <>
                  <button type="button" onClick={handleSaveToCloud}>
                    <CloudUpload size={15} />
                    <span>
                      {t("menu.cloudSave")}
                      <small>{cloudStatus || formatAppMessage("ui.app.mindatlaspkgServerFolder.fd2c869")}</small>
                    </span>
                  </button>
                  <button type="button" onClick={handleOpenCloudLoad}>
                    <CloudDownload size={15} />
                    <span>
                      {t("menu.cloudLoad")}
                      <small>{cloudError || formatAppMessage("ui.app.chooseAServerPackage.23147b3")}</small>
                    </span>
                  </button>
                </>
              ) : null}
              <label>
                <Upload size={15} /> {t("menu.import")}
                <input type="file" accept={publicServiceMode ? HOSTED_IMPORT_ACCEPT_TYPES : IMPORT_ACCEPT_TYPES} onChange={handleImport} />
              </label>
              <button type="button" onClick={() => { setTextImportOpen(true); setMenuOpen(false); }}>
                <FileText size={15} />
                <span>
                  {t("menu.importOutline")}
                  <small>{t("menu.importOutline.detail")}</small>
                </span>
              </button>
            </div>
            <div className="context-menu-section" aria-label={t("menu.background")}>
              <span className="context-menu-section-title">{t("menu.background")}</span>
              <div className="theme-choice-row">
                <button
                  className={theme === "dark" ? "is-active" : ""}
                  type="button"
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                >
                  <Moon size={15} /> {t("menu.background.black")}
                </button>
                <button
                  className={theme === "light" ? "is-active" : ""}
                  type="button"
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                >
                  <Sun size={15} /> {t("menu.background.white")}
                </button>
              </div>
            </div>
            <div className="context-menu-section" aria-label={t("menu.mode")}>
              <span className="context-menu-section-title">{t("menu.mode")}</span>
              <div className="theme-choice-row mode-choice-row">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    className={layoutMode === option.mode ? "is-active" : ""}
                    type="button"
                    onClick={() => handleLayoutModeChange(option.mode)}
                    aria-pressed={layoutMode === option.mode}
                    title={getAtlasLayoutModeLabel(option.mode)}
                  >
                    <LayoutModeIcon icon={option.icon} />
                    {getAtlasLayoutModeLabel(option.mode)}
                  </button>
                ))}
                <button
                  className={outlineEditorOpen ? "is-active" : ""}
                  type="button"
                  onClick={handleOpenOutlineEditor}
                  aria-pressed={outlineEditorOpen}
                  title={t("menu.textEditor")}
                >
                  <PenLine size={15} />
                  {t("menu.textEditor")}
                </button>
              </div>
            </div>
            <div className="undo-redo-row" aria-label={t("menu.history")}>
              <button type="button" onClick={handleUndo} disabled={!canUndo} aria-keyshortcuts="Control+Z" title={`${t("menu.undo")} (Ctrl+Z)`}>
                <Undo2 size={15} /> {t("menu.undo")}
              </button>
              <button type="button" onClick={handleRedo} disabled={!canRedo} aria-keyshortcuts="Control+Y" title={formatAppMessage("ui.app.redoCtrlY.d812f8d")}>
                <Redo2 size={15} /> {t("menu.redo")}
              </button>
            </div>
            {voiceLogReadable ? (
              <button type="button" onClick={handleOpenVoiceLog}>
                <MessageSquareText size={15} />
                <span>
                  {t("menu.aiLog")}
                  <small>{voiceLogUnreadLabel(unreadPartnerEntries.length, voiceLogEntries.length)}</small>
                </span>
              </button>
            ) : null}
            {aiFeaturesUnlocked ? (
              <>
                <button type="button" onClick={handleRestartRealtime}>
                  <Radio size={15} />
                  <span>
                    {t("menu.realtime.restart")}
                    <small>{t("menu.realtime.restart.detail")}</small>
                  </span>
                </button>
                <button type="button" onClick={handleOpenVoiceSettings}>
                  <Settings2 size={15} />
                  <span>
                    {t("menu.voiceSettings")}
                    <small>{voicePartnerSettings.realtimeVoice} / {voicePartnerSettings.realtimeModel}</small>
                  </span>
                </button>
              </>
            ) : null}
            <button
              className="tutorial-mode-button"
              type="button"
              onClick={handleTutorialModeClick}
            >
              <GraduationCap size={15} />
              <span>
                {t("menu.tutorial")}
                <small>{t("menu.tutorial.detail")}</small>
              </span>
            </button>
            <div className="context-menu-section language-menu-section" aria-label={t("language.section")}>
              <span className="context-menu-section-title"><Languages size={14} /> {t("language.section")}</span>
              <label className="language-select-label">
                <span>{t("language.current")}</span>
                <select
                  value={localePreference}
                  onChange={(event) => setLocalePreference(event.target.value as LocalePreference)}
                  aria-label={t("language.current")}
                >
                  <option value="auto">{t("common.auto")}</option>
                  {AVAILABLE_LOCALES.map((availableLocale) => (
                    <option key={availableLocale} value={availableLocale}>{LOCALE_LABELS[availableLocale]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="context-menu-section" aria-label={t("menu.renderQuality")}>
              <span className="context-menu-section-title">{t("menu.renderQuality")}</span>
              <div className="theme-choice-row">
                <button
                  className={renderQuality === "high" ? "is-active" : ""}
                  type="button"
                  onClick={() => handleRenderQualityChange("high")}
                  aria-pressed={renderQuality === "high"}
                >
                  {t("menu.renderQuality.high")}
                </button>
                <button
                  className={renderQuality === "low" ? "is-active" : ""}
                  type="button"
                  onClick={() => handleRenderQualityChange("low")}
                  aria-pressed={renderQuality === "low"}
                >
                  {t("menu.renderQuality.low")}
                </button>
              </div>
            </div>
            <div className="context-menu-section" aria-label={t("menu.mobileSettings")}>
              <span className="context-menu-section-title">{t("menu.mobileSettings")}</span>
              <button type="button" onClick={handleToggleMobileNotifications}>
                {mobileNotificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />}
                <span>
                  {t("menu.mobileNotifications")}
                  <small>{mobileNotificationStatusLabel(mobileNotificationsEnabled, mobileNotificationPermission, mobileNotificationMessage)}</small>
                </span>
              </button>
              <button type="button" onClick={handleEnterFullscreen} disabled={!fullscreenSupported}>
                <Maximize2 size={15} />
                <span>
                  {t("menu.fullscreen")}
                  <small>{t("menu.fullscreen.detail")}</small>
                </span>
              </button>
              <button
                className={vrModeEnabled ? "is-active" : ""}
                type="button"
                onClick={handleToggleVrMode}
                aria-pressed={vrModeEnabled}
                disabled={!vrModeEnabled && !isDeviceOrientationSupported()}
              >
                <Smartphone size={15} />
                <span>
                  {t("menu.vrMode")}
                  <small>{vrModeStatusLabel(vrModeEnabled, vrModeMessage)}</small>
                </span>
              </button>
            </div>
            <a className="context-menu-link" href={localizedAboutUrl(locale)} aria-label={formatAppMessage("ui.app.mindAtlasOverviewAndAi.b1eb8a4")}>
              <Info size={15} />
              <span>
                {t("menu.about")}
                <small>{t("menu.about.detail")}</small>
              </span>
            </a>
            <a
              className="context-menu-link legal-notice-link"
              href={MIND_ATLAS_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={formatAppMessage("ui.app.sourceCodeAndLicense.ba82518")}
            >
              <Github size={15} />
              <span>
                {t("menu.source")}
                <small>{t("menu.source.detail")}</small>
              </span>
            </a>
          </div>
        ) : null}
      </div>
      ) : null}

      {onboarding.showMainChrome ? <Minimap /> : null}
      {(onboarding.showMainChrome || showTutorialOperationFallback) && !operationPanelInWorkspace ? <OperationPanel actions={operationActions} variant="desktop" /> : null}
      {renderWorkspacePanel ? (
        <section
          className={`mobile-workspace-panel ${showWorkspacePanel ? "is-open" : "is-closing"} ${mobileWorkspaceTabsNeeded ? "" : "is-single-editor"}`}
          data-active-tab={effectiveMobilePanelTab}
          aria-label={formatAppMessage("ui.app.mobileWorkspace.35daa52")}
        >
          {mobileWorkspaceTabsNeeded ? (
          <div className="mobile-workspace-tabs" role="tablist" aria-label={formatAppMessage("ui.app.workspacePanel.8b247f7")}>
            {showCommandDock ? (
              <button
                className={effectiveMobilePanelTab === "command" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={effectiveMobilePanelTab === "command"}
                onClick={() => setMobilePanelTab("command")}
              >
                <MessageSquareText size={15} />
                <span>{<I18nText id="ui.app.ai.c7cd197" />}</span>
              </button>
            ) : null}
            <button
              className={effectiveMobilePanelTab === "editor" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={effectiveMobilePanelTab === "editor"}
              onClick={() => setMobilePanelTab("editor")}
            >
              <PenLine size={15} />
              <span>{<I18nText id="ui.app.editor.127052c" />}</span>
            </button>
            {mobileOperationPanelTabAvailable ? (
              <button
                className={effectiveMobilePanelTab === "operation" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={effectiveMobilePanelTab === "operation"}
                onClick={() => setMobilePanelTab("operation")}
              >
                <Settings2 size={15} />
                <span>{<I18nText id="ui.app.operation.c7a1622" />}</span>
              </button>
            ) : null}
            {outlineEditorOpen ? (
              <button
                className={effectiveMobilePanelTab === "outline" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={effectiveMobilePanelTab === "outline"}
                onClick={() => setMobilePanelTab("outline")}
              >
                <ListTree size={15} />
                <span>{<I18nText id="ui.app.texteditor.0e3c5aa" />}</span>
              </button>
            ) : null}
          </div>
          ) : null}
          {showCommandDock ? (
            <div className="mobile-panel-slot mobile-command-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "command"}>
              <CommandDock />
            </div>
          ) : null}
          <div className="mobile-panel-slot mobile-editor-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "editor"}>
            <FocusPanel
              theme={theme}
              attachmentsEnabled={attachmentsEnabled}
              onNodeTextEdited={handleTutorialNodeTextEdited}
            />
          </div>
          {mobileOperationPanelTabAvailable ? (
            <div className="mobile-panel-slot mobile-operation-slot" role="tabpanel" aria-hidden={effectiveMobilePanelTab !== "operation"}>
              <OperationPanel actions={operationActions} variant="mobile" />
            </div>
          ) : null}
        </section>
      ) : null}
      {/* Local-only Agent Run Workspace. Hosted public mode never renders it. */}
      {publicServiceMode ? null : <AgentRunWorkspaceHost />}
      {outlineEditorOpen ? (
        <OutlineEditor
          root={outlineEditorRoot}
          selectedNodeId={findNode(outlineEditorRoot, selectedNodeId) ? selectedNodeId : outlineEditorRoot.id}
          onClose={handleCloseOutlineEditor}
          onFocusNode={selectNodeInPlace}
          onApplyOutline={applyOutlineSubtree}
          onUpdateNodeLive={updateNodeLive}
        />
      ) : null}
      {textImportOpen ? (
        <TextImportModal
          value={textImportValue}
          onChange={setTextImportValue}
          onReplaceBody={handleReplaceActiveNodeBody}
          onReplaceSubtree={handleReplaceActiveSubtree}
          onAppendChildren={handleAppendAsChildren}
          onPreviewMerge={handleOpenPreviewMerge}
          onClose={() => setTextImportOpen(false)}
        />
      ) : null}
      {nodeSearchOpen ? (
        <NodeSearchDialog
          root={atlasRoot}
          onFocus={(nodeId) => {
            focusNode(nodeId);
            setNodeSearchOpen(false);
          }}
          onClose={() => setNodeSearchOpen(false)}
        />
      ) : null}
      {mergePreview ? (
        <MergePreviewDialog
          state={mergePreview}
          onChange={setMergePreview}
          onApply={handleApplyPreviewMerge}
          onClose={() => setMergePreview(null)}
        />
      ) : null}
      {voiceLogReadable && voiceLogOpen ? (
        <VoiceLogDialog
          entries={voiceLogEntries}
          summary={voiceSessionSummary}
          onClose={() => setVoiceLogOpen(false)}
          onClear={clearVoiceLog}
          readOnly={!aiFeaturesUnlocked}
        />
      ) : null}
      {aiFeaturesUnlocked && voiceSettingsOpen ? (
        <VoiceSettingsDialog
          settings={voicePartnerSettings}
          onClose={() => setVoiceSettingsOpen(false)}
          onSave={setVoicePartnerSettings}
          onRestart={handleRestartRealtime}
        />
      ) : null}
      {restoreHistoryOpen ? (
        <NotebookHistoryDialog
          snapshots={notebookSnapshots}
          status={notebookPersistenceStatus}
          error={notebookPersistenceError}
          onClose={() => setRestoreHistoryOpen(false)}
          onRefresh={refreshNotebookSnapshots}
          onRestore={restoreNotebookFromSnapshot}
        />
      ) : null}
      {cloudNotebooksAvailable && cloudLoadOpen ? (
        <CloudLoadDialog
          notebooks={cloudNotebooks}
          directory={cloudDirectory}
          quota={cloudQuota}
          hosted={publicServiceMode}
          currentNotebook={currentCloudNotebook}
          currentDirty={currentCloudDirty}
          loading={cloudLoading}
          error={cloudError}
          status={cloudStatus}
          onClose={() => setCloudLoadOpen(false)}
          onRefresh={refreshCloudNotebooks}
          onLoad={handleLoadCloudNotebook}
          onSaveAs={handleHostedSaveCloudAs}
          onOverwrite={handleHostedOverwriteCloudNotebook}
          onRename={handleHostedRenameCloudNotebook}
          onShare={handleHostedShareCloudNotebook}
          onDelete={handleHostedDeleteCloudNotebook}
        />
      ) : null}
      {pendingWorkspaceSwitch && currentCloudNotebook ? (
        <UnsavedCloudSwitchDialog
          currentName={currentCloudNotebook.title || currentCloudNotebook.name}
          nextName={pendingWorkspaceSwitch.nextName}
          loading={cloudLoading}
          onSaveAndOpen={handleSaveAndOpenPendingCloudNotebook}
          onDiscardAndOpen={handleDiscardAndOpenPendingCloudNotebook}
          onCancel={() => {
            pendingWorkspaceSwitchActionRef.current = null;
            setPendingWorkspaceSwitch(null);
          }}
        />
      ) : null}
      {startSpaceOpen ? (
        <StartSpaceDialog
          source={startSpaceSource}
          notebooks={cloudNotebooks}
          cloudAvailable={cloudNotebooksAvailable}
          hosted={publicServiceMode}
          loading={cloudLoading}
          error={cloudError}
          onClose={() => setStartSpaceOpen(false)}
          onRefresh={refreshCloudNotebooks}
          onStartTemplate={handleStartWithTemplate}
          onStartFromCloud={handleStartWithCloudNotebook}
          onContinueWithoutTemplate={() => setStartSpaceOpen(false)}
          onLogin={() => {
            trackProductEvent("google_login_started", { trigger: "account" }, { immediate: true });
            startHostedGoogleLogin("account");
          }}
        />
      ) : null}
      {tutorialCompletionStep ? (
        <TutorialCompletionDialog
          step={tutorialCompletionStep}
          onAcknowledge={() => setTutorialCompletionStep("choice")}
          onContinue={() => setTutorialCompletionStep(null)}
          onUseTemplate={() => {
            setTutorialCompletionStep(null);
            openStartSpaceDialog("initialize");
          }}
        />
      ) : null}
      {publicServiceMode && aiFeatureDialogOpen ? (
        <AiFeatureDialog
          session={hostedSession}
          loading={hostedSessionLoading}
          error={hostedSessionError}
          onClose={() => setAiFeatureDialogOpen(false)}
          onRefresh={refreshHostedSession}
        />
      ) : null}
      {sharedNotebookRoot ? (
        <SharedNotebookDialog
          importing={sharedNotebookImporting}
          onImport={handleImportSharedNotebook}
          onClose={handleDismissSharedNotebook}
        />
      ) : null}
    </main>
  );
}

function AiFeatureDialog({
  session,
  loading,
  error,
  onClose,
  onRefresh,
}: {
  session: HostedServiceSession | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const t = useMessage();
  const [actionBusy, setActionBusy] = useState<"login" | "checkout" | "portal" | "logout" | "refresh" | null>(null);
  const creditPercent = session?.credit ? Math.max(0, Math.min(100, session.credit.remainingPercent)) : 0;
  const roundedCreditPercent = Math.round(creditPercent);
  const nextCreditRenewalLabel = formatHostedDate(session?.subscription?.currentPeriodEnd);
  const authenticated = Boolean(session?.authenticated && session.user);
  const aiEnabled = Boolean(session?.entitlement.aiEnabled);
  const reason = session?.entitlement.reason;
  const checkoutAvailable = authenticated
    && reason === "subscription_required"
    && (!session?.subscription || session.subscription.status === "canceled" || session.subscription.status === "incomplete");
  const portalAvailable = authenticated && Boolean(session?.subscription) && session?.subscription?.status !== "canceled";
  const showCredit = authenticated && Boolean(session?.credit && session.subscription && session.subscription.status !== "canceled");
  const dialogTitle = authenticated ? t("app.aiFeatures") : t("app.cloudAccountFeatures");
  const creditCardClass = [
    "ai-credit-card",
    aiEnabled ? "is-active" : "",
    session?.credit && creditPercent > 0 && creditPercent <= 20 ? "is-warning" : "",
    reason === "credit_exhausted" ? "is-exhausted" : "",
  ].filter(Boolean).join(" ");

  const runAction = async (action: NonNullable<typeof actionBusy>, run: () => Promise<void> | void) => {
    if (actionBusy) return;
    try {
      setActionBusy(action);
      await run();
    } finally {
      if (action !== "login" && action !== "checkout" && action !== "portal") setActionBusy(null);
    }
  };

  const handleLogout = () => runAction("logout", async () => {
    await logoutHostedService();
    await onRefresh();
  });

  const handleRefresh = () => runAction("refresh", onRefresh);

  return (
    <section className="ai-feature-dialog" role="dialog" aria-modal="true" aria-label={dialogTitle} onMouseDown={(event) => event.stopPropagation()}>
      <header className="voice-log-header">
        <div>
          <h2>{dialogTitle}</h2>
          <p>{authenticated ? aiFeatureStatusLabel(session, loading, error) : t("app.cloudAccountStatus")}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeAiSettings.2147ae4")}>
          <X size={16} />
        </button>
      </header>
      <div className="ai-feature-body">
        {error ? <p className="ai-feature-error">{error}</p> : null}
        {!authenticated ? (
          <div className="ai-plan-card ai-account-benefits-card">
            <p>{t("app.cloudAccountDescription")}</p>
            <dl>
              <div>
                <dt>{t("app.cloudSaveFeature")}</dt>
                <dd>{t("app.cloudSaveFeatureDetail")}</dd>
              </div>
              <div>
                <dt>{t("app.shareLinkFeature")}</dt>
                <dd>{t("app.shareLinkFeatureDetail")}</dd>
              </div>
            </dl>
          </div>
        ) : aiEnabled ? (
          <div className="ai-plan-card ai-usage-guide-card">
            <div className="ai-plan-card-header">
              <span>{<I18nText id="ui.app.aiRequest.752b5a1" />}</span>
              <strong>{<I18nText id="ui.app.usageGuide.1809d14" />}</strong>
            </div>
            <p>
              {<I18nText id="ui.app.theArrowShapedSendButton.74bf26f" />}</p>
            <p>
              {<I18nText id="ui.app.pressTheMicrophoneOnceAnd.980ef6c" />}</p>
          </div>
        ) : (
          <div className="ai-plan-card">
            <div className="ai-plan-card-header">
              <span>{<I18nText id="ui.app.mindAtlasPro.cd0a834" />}</span>
              <strong>{<I18nText id="ui.app.us10Month.25ec82a" />}</strong>
            </div>
            <p>{<I18nText id="ui.app.askAiServicesSuchAs.a8a8a7f" />}</p>
            <dl>
              <div>
                <dt>{<I18nText id="ui.app.aiTokenBalance.016ef19" />}</dt>
                <dd>{<I18nText id="ui.app.100GrantedEachBillingPeriod.753b157" />}</dd>
              </div>
              <div>
                <dt>{<I18nText id="ui.app.refresh.ca09751" />}</dt>
                <dd>{nextCreditRenewalLabel ? formatAppMessage("dynamic.nextRenewal", { date: nextCreditRenewalLabel }) : formatAppMessage("ui.app.automaticallyRenewsOnTheStripe.0be8f92")}</dd>
              </div>
            </dl>
          </div>
        )}
        {authenticated ? (
          <div className="ai-feature-user">
            {session?.user?.pictureUrl ? <img src={session.user.pictureUrl} alt="" /> : <UserCircle size={34} />}
            <span>
              <strong>{session?.user?.name || session?.user?.email}</strong>
              <small>{session?.user?.email}</small>
            </span>
          </div>
        ) : null}
        {showCredit ? (
          <div className={creditCardClass}>
            <div>
              <span>{<I18nText id="ui.app.aiTokenBalance.016ef19" />}</span>
              <strong>{roundedCreditPercent}%</strong>
            </div>
            <div className="ai-credit-track" aria-hidden="true">
              <span style={{ width: `${creditPercent}%` }} />
            </div>
            {nextCreditRenewalLabel ? <small className="ai-credit-renewal">{<I18nText id="ui.app.nextRenewal.04e732d" />}{nextCreditRenewalLabel}</small> : null}
          </div>
        ) : null}
        <div className="ai-feature-actions">
          {!authenticated ? (
            <button className="secondary-button" type="button" onClick={() => void runAction("login", () => {
              trackProductEvent("google_login_started", { trigger: "account" }, { immediate: true });
              startHostedGoogleLogin("account");
            })} disabled={loading || Boolean(actionBusy)}>
              <LogIn size={15} />
              {<I18nText id="ui.app.signInWithGoogle.adee61b" />}</button>
          ) : null}
          {checkoutAvailable ? (
            <button className="secondary-button is-wide" type="button" onClick={() => void runAction("checkout", () => {
              trackProductEvent("checkout_started", {}, { immediate: true });
              return startHostedBillingCheckout();
            })} disabled={loading || Boolean(actionBusy)}>
              <CreditCard size={15} />
              {<I18nText id="ui.app.subscribeForUs10Per.ec14079" />}</button>
          ) : null}
          {portalAvailable ? (
            <button className="secondary-button" type="button" onClick={() => void runAction("portal", openHostedBillingPortal)} disabled={loading || Boolean(actionBusy)}>
              <CreditCard size={15} />
              {session?.subscription?.status === "past_due" ? formatAppMessage("ui.app.reviewPayment.03db055") : formatAppMessage("ui.app.managePayment.7caea5a")}
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={() => void handleRefresh()} disabled={loading || Boolean(actionBusy)}>
            <RefreshCw size={15} />
            {<I18nText id="ui.app.refresh.ca09751" />}</button>
          {authenticated ? (
            <button className="secondary-button" type="button" onClick={() => void handleLogout()} disabled={loading || Boolean(actionBusy)}>
              <LogOut size={15} />
              {<I18nText id="ui.app.logOut.b7f5cb2" />}</button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function aiFeatureButtonBadge(session: HostedServiceSession | null, loading: boolean, error: string) {
  if (loading) return formatAppMessage("label.ai.checkingShort");
  if (error) return formatAppMessage("label.ai.attentionShort");
  if (!session?.authenticated) return formatAppMessage("label.ai.signedOutShort");
  if (session.credit) return `${Math.round(Math.max(0, Math.min(100, session.credit.remainingPercent)))}%`;
  if (session.entitlement.reason === "billing_period_unavailable") return formatAppMessage("label.ai.syncingShort");
  return formatAppMessage("label.ai.notSubscribedShort");
}

function aiFeatureStatusLabel(session: HostedServiceSession | null, loading: boolean, error: string) {
  if (loading) return formatAppMessage("label.ai.checking");
  if (error) return formatAppMessage("label.ai.unavailable");
  if (!session?.authenticated) return formatAppMessage("label.ai.freeNotebook");
  if (session.entitlement.aiEnabled) return formatAppMessage("label.ai.available");
  if (session.entitlement.reason === "billing_period_unavailable") return formatAppMessage("label.ai.renewalSync");
  if (session.entitlement.reason === "credit_exhausted") return formatAppMessage("label.ai.exhausted");
  if (session.subscription?.status === "past_due") return formatAppMessage("label.ai.paymentRequired");
  if (session.subscription?.status === "canceled") return formatAppMessage("label.ai.subscriptionStopped");
  return formatAppMessage("label.ai.notSubscribed");
}

function formatHostedDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function NodeSearchDialog({
  root,
  onFocus,
  onClose,
}: {
  root: AtlasNode;
  onFocus: (nodeId: string) => void;
  onClose: () => void;
}) {
  const t = useMessage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const result = useMemo(
    () => searchAtlasNodes(root, { query, regex, caseSensitive, limit: 200 }),
    [caseSensitive, query, regex, root],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const focusFirst = () => {
    const first = result.matches[0];
    if (first) onFocus(first.nodeId);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="node-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="node-search-header">
          <div>
            <h2>{t("search.title")}</h2>
            <p>{t("search.description")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={17} />
          </button>
        </header>
        <form
          className="node-search-controls"
          onSubmit={(event) => {
            event.preventDefault();
            focusFirst();
          }}
        >
          <label className="node-search-input">
            <Search size={17} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              spellCheck={false}
            />
          </label>
          <div className="node-search-options">
            <label>
              <input type="checkbox" checked={regex} onChange={(event) => setRegex(event.target.checked)} />
              <span>{t("search.regex")}</span>
            </label>
            <label>
              <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
              <span>{t("search.caseSensitive")}</span>
            </label>
            {query.trim() && !result.error ? <strong>{t("search.resultCount", { count: result.total })}</strong> : null}
          </div>
        </form>
        <div className="node-search-results" role="list">
          {result.error ? <p className="node-search-status is-error">{result.error}</p> : null}
          {query.trim() && !result.error && !result.matches.length ? (
            <p className="node-search-status">{t("search.noResults")}</p>
          ) : null}
          {result.matches.map((match) => (
            <button
              key={match.nodeId}
              className="node-search-result"
              type="button"
              role="listitem"
              onClick={() => onFocus(match.nodeId)}
            >
              <span className="node-search-result-main">
                <strong>{match.title || t("node.untitled")}</strong>
                <small>{match.path.join(" / ")}</small>
              </span>
              <span className="node-search-result-snippet">
                <em>{match.field === "title" ? t("search.field.title") : t("search.field.body")}</em>
                {match.snippet}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function TextImportModal({
  value,
  onChange,
  onReplaceBody,
  onReplaceSubtree,
  onAppendChildren,
  onPreviewMerge,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onReplaceBody: () => void;
  onReplaceSubtree: () => void;
  onAppendChildren: () => void;
  onPreviewMerge: () => void;
  onClose: () => void;
}) {
  const canImport = value.trim().length > 0;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog text-import-dialog" role="dialog" aria-modal="true" aria-label={formatAppMessage("ui.app.importTextOutline.c78f631")} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{<I18nText id="ui.app.importTextOutline.a5e5e7e" />}</strong>
            <span>{<I18nText id="ui.app.pasteMarkdownFromChatgptThen.e85c67c" />}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeTextImport.6ba6ae0")}>
            <X size={16} />
          </button>
        </header>
        <textarea
          aria-label={formatAppMessage("ui.app.markdownOutlineText.4f4c059")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={formatAppMessage("ui.app.bookChapter1Scene1.c445ab3")}
        />
        <footer>
          <button type="button" onClick={onClose}>{<I18nText id="ui.app.cancel.6a25e9e" />}</button>
          <button type="button" onClick={onReplaceBody} disabled={!canImport}>{<I18nText id="ui.app.replaceActiveNodeBody.33d9b7d" />}</button>
          <button type="button" onClick={onReplaceSubtree} disabled={!canImport}>{<I18nText id="ui.app.replaceActiveSubtree.7e1046b" />}</button>
          <button type="button" onClick={onAppendChildren} disabled={!canImport}>{<I18nText id="ui.app.appendAsChildren.a7c96eb" />}</button>
          <button type="button" onClick={onPreviewMerge} disabled={!canImport}>{<I18nText id="ui.app.previewMerge.23e68fc" />}</button>
        </footer>
      </section>
    </div>
  );
}

function SharedNotebookDialog({
  importing,
  onImport,
  onClose,
}: {
  importing: boolean;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog shared-notebook-dialog" role="dialog" aria-modal="true" aria-label={formatAppMessage("ui.app.sharedMindAtlas.5a0a271")} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{<I18nText id="ui.app.sharedMindAtlas.feaf518" />}</strong>
            <span>{<I18nText id="ui.app.thisLinkContainsTitlesBody.c73dc1e" />}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeSharedAtlasImport.dc949d9")}>
            <X size={16} />
          </button>
        </header>
        <p>
          {<I18nText id="ui.app.importingWillReplaceTheCurrent.4aa2bfe" />}</p>
        <div className="shared-notebook-actions">
          <button type="button" onClick={onClose}>
            {<I18nText id="ui.app.cancel.6a25e9e" />}</button>
          <button className="primary-button" type="button" onClick={onImport} disabled={importing}>
            {importing ? formatAppMessage("ui.app.importing.59067a7") : formatAppMessage("ui.app.importSharedAtlas.82f80a3")}
          </button>
        </div>
      </section>
    </div>
  );
}

function MergePreviewDialog({
  state,
  onChange,
  onApply,
  onClose,
}: {
  state: MergePreviewState;
  onChange: (state: MergePreviewState) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const updateChoice = (key: string, choice: MergeChoice) => onChange({ root: updateMergeChoice(state.root, key, choice) });
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog merge-preview-dialog" role="dialog" aria-modal="true" aria-label={formatAppMessage("ui.app.previewMerge.113d7f4")} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{<I18nText id="ui.app.previewMerge.23e68fc" />}</strong>
            <span>{<I18nText id="ui.app.chooseCurrentOrIncomingText.42a85bc" />}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeMergePreview.3c2fdef")}>
            <X size={16} />
          </button>
        </header>
        <div className="merge-preview-list">
          <MergePreviewBlockView block={state.root} onChoice={updateChoice} />
        </div>
        <footer>
          <button type="button" onClick={onClose}>{<I18nText id="ui.app.cancel.6a25e9e" />}</button>
          <button type="button" onClick={onApply}>{<I18nText id="ui.app.applyMerge.6308788" />}</button>
        </footer>
      </section>
    </div>
  );
}

function MergePreviewBlockView({ block, onChoice }: { block: MergePreviewBlock; onChoice: (key: string, choice: MergeChoice) => void }) {
  const changed = block.currentTitle !== block.incomingTitle || block.currentBody !== block.incomingBody;
  return (
    <section className={`merge-preview-block ${changed ? "is-changed" : ""}`}>
      <header>
        <div>
          <strong>{block.path}</strong>
          <span>{changed ? formatAppMessage("ui.app.changed.77cca84") : formatAppMessage("ui.app.unchanged.646983b")}</span>
        </div>
        <div className="merge-choice-buttons" role="group" aria-label={formatAppMessage("dynamic.mergeChoice", { path: block.path })}>
          <button type="button" className={block.choice === "current" ? "is-active" : ""} onClick={() => onChoice(block.key, "current")}>{<I18nText id="ui.app.keepCurrent.bcc3ff7" />}</button>
          <button type="button" className={block.choice === "incoming" ? "is-active" : ""} onClick={() => onChoice(block.key, "incoming")}>{<I18nText id="ui.app.acceptIncoming.b506f76" />}</button>
        </div>
      </header>
      <div className="merge-columns">
        <article>
          <span>{<I18nText id="ui.app.current.51d469d" />}</span>
          <strong>{block.currentTitle || formatAppMessage("ui.app.untitled.39af82f")}</strong>
          <pre>{block.currentBody || "(empty)"}</pre>
        </article>
        <article>
          <span>{<I18nText id="ui.app.incoming.7d163fb" />}</span>
          <strong>{block.incomingTitle || formatAppMessage("ui.app.untitled.39af82f")}</strong>
          <pre>{block.incomingBody || "(empty)"}</pre>
        </article>
      </div>
      {block.children.length ? (
        <div className="merge-preview-children">
          {block.children.map((child) => <MergePreviewBlockView key={child.key} block={child} onChoice={onChoice} />)}
        </div>
      ) : null}
    </section>
  );
}

function CloudLoadDialog({
  notebooks,
  directory,
  quota,
  hosted,
  currentNotebook,
  currentDirty,
  loading,
  error,
  status,
  onClose,
  onRefresh,
  onLoad,
  onSaveAs,
  onOverwrite,
  onRename,
  onShare,
  onDelete,
}: {
  notebooks: CloudNotebookEntry[];
  directory: string;
  quota?: CloudNotebookListResult["quota"] | null;
  hosted?: boolean;
  currentNotebook?: CloudNotebookEntry | null;
  currentDirty?: boolean;
  loading: boolean;
  error: string;
  status?: string;
  onClose: () => void;
  onRefresh: () => void;
  onLoad: (entry: CloudNotebookEntry) => void;
  onSaveAs?: () => void;
  onOverwrite?: (entry: CloudNotebookEntry) => void;
  onRename?: (entry: CloudNotebookEntry) => void;
  onShare?: (entry: CloudNotebookEntry) => void;
  onDelete?: (entry: CloudNotebookEntry) => void;
}) {
  const t = useMessage();
  const [selectedKey, setSelectedKey] = useState("");
  const selectedEntry = notebooks.find((entry) => cloudNotebookKey(entry) === selectedKey) ?? notebooks[0] ?? null;
  const currentKey = currentNotebook ? cloudNotebookKey(currentNotebook) : "";

  useEffect(() => {
    if (!hosted) return;
    if (!notebooks.length) {
      setSelectedKey("");
      return;
    }
    if (!selectedKey || !notebooks.some((entry) => cloudNotebookKey(entry) === selectedKey)) {
      const preferred = notebooks.find((entry) => cloudNotebookKey(entry) === currentKey) ?? notebooks[0];
      setSelectedKey(cloudNotebookKey(preferred));
    }
  }, [currentKey, hosted, notebooks, selectedKey]);

  const dialogTitle = hosted ? t("cloud.files") : t("menu.cloudLoad");
  const selectedDisabled = loading || !selectedEntry;
  const quotaText = quota ? `${formatBytes(quota.usedBytes)} / ${formatBytes(quota.limitBytes)}` : "";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cloud-load-dialog" role="dialog" aria-modal="true" aria-label={dialogTitle} onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>{dialogTitle}</h2>
            <p>{directory || formatAppMessage("ui.app.serverNotebookFolder.b9a7320")}</p>
            {quotaText ? <p className="cloud-quota">{<I18nText id="ui.app.cloudStorage.94e0556" />}{quotaText}</p> : null}
            {hosted && currentNotebook ? (
              <p className={`cloud-current-summary${currentDirty ? " is-dirty" : ""}`}>
                {t("cloud.currentSummary", { name: currentNotebook.title || currentNotebook.name })}
                {currentDirty ? ` / ${t("cloud.unsaved")}` : ""}
              </p>
            ) : null}
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={onRefresh} aria-label={formatAppMessage("ui.app.refreshCloudNotebooks.28e31e2")} disabled={loading}>
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeCloudLoader.e2381d8")}>
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="cloud-package-list">
          {error ? <p className="cloud-dialog-status is-error">{error}</p> : null}
          {status ? <p className="cloud-dialog-status is-ok">{status}</p> : null}
          {hosted ? (
            <div className="cloud-manager-actions" aria-label={formatAppMessage("ui.app.cloudFileActions.72433a6")}>
              <button type="button" onClick={onSaveAs} disabled={loading || !onSaveAs}>
                <CloudUpload size={15} />
                <span>{<I18nText id="ui.app.saveCurrentAs.18cbd57" />}</span>
              </button>
              <button type="button" onClick={() => selectedEntry && onLoad(selectedEntry)} disabled={selectedDisabled}>
                <CloudDownload size={15} />
                <span>{<I18nText id="ui.app.load.872c7f9" />}</span>
              </button>
              <button
                type="button"
                onClick={() => selectedEntry && onOverwrite?.(selectedEntry)}
                disabled={selectedDisabled || !onOverwrite}
              >
                <FileText size={15} />
                <span>{<I18nText id="ui.app.overwrite.d7bec6b" />}</span>
              </button>
              <button type="button" onClick={() => selectedEntry && onRename?.(selectedEntry)} disabled={selectedDisabled || !onRename}>
                <PenLine size={15} />
                <span>{<I18nText id="ui.app.rename.974d17f" />}</span>
              </button>
              <button type="button" onClick={() => selectedEntry && onShare?.(selectedEntry)} disabled={selectedDisabled || !onShare}>
                <Share2 size={15} />
                <span>{<I18nText id="ui.app.copyShareLink.d2e2a6f" />}</span>
              </button>
              <button className="danger-button" type="button" onClick={() => selectedEntry && onDelete?.(selectedEntry)} disabled={selectedDisabled || !onDelete}>
                <Trash2 size={15} />
                <span>{<I18nText id="ui.app.delete.c859ed3" />}</span>
              </button>
            </div>
          ) : null}
          {loading ? <p className="cloud-dialog-status">{<I18nText id="ui.app.loading.f82b023" />}</p> : null}
          {!loading && !notebooks.length ? <p className="cloud-dialog-status">{hosted ? formatAppMessage("ui.app.noCloudFilesYet.17dff2f") : formatAppMessage("ui.app.noCloudPackagesFound.85d460d")}</p> : null}
          {notebooks.map((entry) => {
            const entryKey = cloudNotebookKey(entry);
            const selected = hosted && selectedEntry ? cloudNotebookKey(selectedEntry) === entryKey : false;
            const current = hosted && currentKey === entryKey;
            return (
              <button
                key={entryKey}
                className={`cloud-package-button${selected ? " is-selected" : ""}${current ? " is-current" : ""}`}
                type="button"
                onClick={() => (hosted ? setSelectedKey(entryKey) : onLoad(entry))}
                disabled={loading}
                aria-pressed={hosted ? selected : undefined}
              >
                <span>
                  <strong>
                    {entry.title || entry.name}
                    {current ? <em className={`cloud-current-badge${currentDirty ? " is-dirty" : ""}`}>{currentDirty ? t("cloud.unsaved") : t("cloud.openNow")}</em> : null}
                  </strong>
                  <small>
                    {formatBytes(entry.size)} / {formatVoiceLogTime(entry.updatedAt)}
                    {entry.visibility === "public" ? formatAppMessage("ui.app.shared.f6ca971") : ""}
                  </small>
                </span>
                {hosted ? <FileText size={16} /> : <CloudDownload size={16} />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function UnsavedCloudSwitchDialog({
  currentName,
  nextName,
  loading,
  onSaveAndOpen,
  onDiscardAndOpen,
  onCancel,
}: {
  currentName: string;
  nextName: string;
  loading: boolean;
  onSaveAndOpen: () => void;
  onDiscardAndOpen: () => void;
  onCancel: () => void;
}) {
  const t = useMessage();
  return (
    <div className="modal-backdrop cloud-switch-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="cloud-switch-dialog" role="alertdialog" aria-modal="true" aria-label={t("cloud.unsavedSwitchTitle")} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{t("cloud.unsavedSwitchTitle")}</h2>
          <p>{t("cloud.unsavedSwitchBody", { current: currentName, next: nextName })}</p>
        </header>
        <footer>
          <button type="button" onClick={onCancel} disabled={loading}>{t("common.cancel")}</button>
          <button className="danger-button" type="button" onClick={onDiscardAndOpen} disabled={loading}>{t("cloud.discardAndOpen")}</button>
          <button className="primary-button" type="button" onClick={onSaveAndOpen} disabled={loading}>{t("cloud.saveAndOpen")}</button>
        </footer>
      </section>
    </div>
  );
}

function TutorialCompletionDialog({
  step,
  onAcknowledge,
  onContinue,
  onUseTemplate,
}: {
  step: Exclude<TutorialCompletionStep, null>;
  onAcknowledge: () => void;
  onContinue: () => void;
  onUseTemplate: () => void;
}) {
  const t = useMessage();
  const complete = step === "complete";

  return (
    <div className="modal-backdrop tutorial-completion-backdrop" role="presentation">
      <section
        className={`cloud-switch-dialog tutorial-completion-dialog${complete ? " is-complete" : " is-choice"}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={complete ? t("tutorial.complete.title") : t("tutorial.next.title")}
      >
        <header>
          <h2>{complete ? t("tutorial.complete.title") : t("tutorial.next.title")}</h2>
          <p>{complete ? t("tutorial.complete.detail") : t("tutorial.next.detail")}</p>
        </header>
        <footer>
          {complete ? (
            <button className="primary-button" type="button" onClick={onAcknowledge} autoFocus>
              {t("common.ok")}
            </button>
          ) : (
            <>
              <button className="primary-button" type="button" onClick={onContinue} autoFocus>
                {t("tutorial.next.continue")}
              </button>
              <button type="button" onClick={onUseTemplate}>
                {t("tutorial.next.template")}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function StartSpaceDialog({
  source,
  notebooks,
  cloudAvailable,
  hosted,
  loading,
  error,
  onClose,
  onRefresh,
  onStartTemplate,
  onStartFromCloud,
  onContinueWithoutTemplate,
  onLogin,
}: {
  source: StartSpaceSource;
  notebooks: CloudNotebookEntry[];
  cloudAvailable: boolean;
  hosted: boolean;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onStartTemplate: (templateId: NotebookTemplateId) => void;
  onStartFromCloud: (entry: CloudNotebookEntry) => void;
  onContinueWithoutTemplate: () => void;
  onLogin: () => void;
}) {
  const t = useMessage();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cloud-load-dialog start-space-dialog" role="dialog" aria-modal="true" aria-label={t("startSpace.title")} onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>{source === "tutorial" ? t("startSpace.nextTitle") : t("startSpace.newTitle")}</h2>
            <p>{source === "tutorial" ? t("startSpace.tutorialDetail") : t("startSpace.newDetail")}</p>
          </div>
          <div className="voice-log-actions">
            {cloudAvailable ? (
              <button className="icon-button" type="button" onClick={onRefresh} aria-label={t("startSpace.refresh")} disabled={loading}>
                <RefreshCw size={16} />
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={onClose} aria-label={t("startSpace.close")}>
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="cloud-package-list start-space-list">
          {error ? <p className="cloud-dialog-status is-error">{hosted ? error : t("startSpace.cloudBridgeRequired")}</p> : null}
          {source === "tutorial" ? (
            <button className="cloud-package-button start-space-continue-button" type="button" onClick={onContinueWithoutTemplate} disabled={loading}>
              <span>
                <strong>{t("startSpace.keepTutorial")}</strong>
                <small>{t("startSpace.keepTutorial.detail")}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ) : null}
          <section className="start-space-section" aria-label={formatAppMessage("ui.app.notebookTemplates.b6a2c8e")}>
            <h3>{t("startSpace.templates")}</h3>
            {NOTEBOOK_TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="cloud-package-button start-space-choice"
                type="button"
                onClick={() => onStartTemplate(template.id)}
                disabled={loading}
              >
                <span>
                  <strong>{t(template.titleMessageId)}</strong>
                  <small>{t(template.descriptionMessageId)}</small>
                </span>
                <FileText size={16} />
              </button>
            ))}
          </section>
          {cloudAvailable ? (
            <section className="start-space-section" aria-label={formatAppMessage("ui.app.cloudNotebookCopies.1f91ff1")}>
              <h3>{t("startSpace.cloudCopies")}</h3>
              {loading ? <p className="cloud-dialog-status">{<I18nText id="ui.app.loading.f82b023" />}</p> : null}
              {!loading && !notebooks.length ? <p className="cloud-dialog-status">{t("startSpace.cloudEmpty")}</p> : null}
              {notebooks.map((entry) => {
                return (
                  <button
                    key={cloudNotebookKey(entry)}
                    className="cloud-package-button start-space-choice"
                    type="button"
                    onClick={() => onStartFromCloud(entry)}
                    disabled={loading}
                  >
                    <span>
                      <strong>{entry.title || entry.name}</strong>
                      <small>
                        {formatBytes(entry.size)} / {formatVoiceLogTime(entry.updatedAt)}
                        {entry.visibility === "public" ? formatAppMessage("ui.app.shared.f6ca971") : ""}
                      </small>
                    </span>
                    <CloudDownload size={16} />
                  </button>
                );
              })}
            </section>
          ) : hosted ? (
            <section className="start-space-section start-space-cloud-login" aria-label={formatAppMessage("ui.app.cloudNotebookCopies.1f91ff1")}>
              <h3>{t("startSpace.cloudCopies")}</h3>
              <p className="cloud-dialog-status">{t("startSpace.cloudLoginDetail")}</p>
              <button className="secondary-button" type="button" onClick={onLogin}>
                <LogIn size={15} /> {t("startSpace.googleLogin")}
              </button>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function cloudNotebookKey(entry: CloudNotebookEntry) {
  return entry.id || entry.name;
}

function cloudNotebookFingerprint(root: AtlasNode) {
  const value = JSON.stringify(createTextOnlyNotebookRoot(root));
  let left = 2166136261;
  let right = 2246822507;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ code, 3266489909);
  }
  return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}:${value.length}`;
}

function storeCurrentCloudNotebook(userId: string, entry: CloudNotebookEntry, baseline: string) {
  try {
    window.sessionStorage.setItem(CURRENT_CLOUD_NOTEBOOK_SESSION_KEY, JSON.stringify({ userId, entry, baseline }));
  } catch {
    // Current-file identity still works for this render session when storage is unavailable.
  }
}

function readStoredCurrentCloudNotebook(userId: string): { entry: CloudNotebookEntry; baseline: string } | null {
  try {
    const raw = window.sessionStorage.getItem(CURRENT_CLOUD_NOTEBOOK_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: unknown; entry?: Partial<CloudNotebookEntry>; baseline?: unknown };
    if (parsed.userId !== userId || typeof parsed.baseline !== "string" || !parsed.entry || typeof parsed.entry.name !== "string") return null;
    return { entry: parsed.entry as CloudNotebookEntry, baseline: parsed.baseline };
  } catch {
    return null;
  }
}

function clearStoredCurrentCloudNotebook() {
  try {
    window.sessionStorage.removeItem(CURRENT_CLOUD_NOTEBOOK_SESSION_KEY);
  } catch {
    // Ignore unavailable session storage.
  }
}

function VoiceSettingsDialog({
  settings,
  onClose,
  onSave,
  onRestart,
}: {
  settings: VoicePartnerSettings;
  onClose: () => void;
  onSave: (settings: Partial<VoicePartnerSettings>) => void;
  onRestart: () => void;
}) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft({
      ...settings,
      realtimeVoice: VOICE_OPTION_IDS.includes(settings.realtimeVoice) ? settings.realtimeVoice : VOICE_OPTION_IDS[0],
    });
  }, [settings]);

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  const handleRestart = () => {
    onSave(draft);
    onRestart();
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="voice-settings-dialog" role="dialog" aria-modal="true" aria-label={formatAppMessage("ui.app.voiceSettings.2b60c84")} onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>{<I18nText id="ui.app.voiceSettings.ca676ab" />}</h2>
            <p>{draft.realtimeVoice} / {draft.realtimeModel}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeVoiceSettings.7277b7c")}>
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="voice-settings-form">
          <label className="voice-settings-field">
            <span>{<I18nText id="ui.app.realtimeModel.dc77751" />}</span>
            <input
              value={draft.realtimeModel}
              onChange={(event) => setDraft((current) => ({ ...current, realtimeModel: event.target.value }))}
              placeholder={formatAppMessage("ui.app.gptRealtime2.d780270")}
            />
          </label>
          <label className="voice-settings-field">
            <span>{<I18nText id="ui.app.voice.2d88d66" />}</span>
            <select
              value={VOICE_OPTION_IDS.includes(draft.realtimeVoice) ? draft.realtimeVoice : VOICE_OPTION_IDS[0]}
              onChange={(event) => setDraft((current) => ({ ...current, realtimeVoice: event.target.value }))}
            >
              {VOICE_OPTION_IDS.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer className="voice-settings-actions">
          <button className="secondary-button" type="button" onClick={handleSave}>
            <Volume2 size={15} /> {<I18nText id="ui.app.save.d5d1067" />}</button>
          <button className="secondary-button" type="button" onClick={handleRestart}>
            <RefreshCw size={15} /> {<I18nText id="ui.app.saveAndRestart.76f0768" />}</button>
        </footer>
      </section>
    </div>
  );
}

function LayoutModeIcon({ icon }: { icon: "orbit" | "tree" | "mind" | "calendar" }) {
  switch (icon) {
    case "orbit":
      return <Orbit size={15} />;
    case "tree":
      return <GitBranch size={15} />;
    case "mind":
      return <Network size={15} />;
    case "calendar":
      return <CalendarDays size={15} />;
  }
}

function OperationPanel({ actions, variant }: { actions: OperationAction[]; variant: "desktop" | "mobile" }) {
  return (
    <nav className={`operation-panel operation-panel-${variant}`} aria-label={formatAppMessage("ui.app.nodeOperations.563b68e")}>
      {actions.map((action) => (
        <button
          key={action.id}
          className="operation-button"
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          title={`${action.label} (${action.shortcut})`}
          aria-label={action.label}
        >
          {action.icon}
          <small>{action.shortcut}</small>
        </button>
      ))}
    </nav>
  );
}

function getEffectiveMobilePanelTab(tab: MobilePanelTab, showCommandDock: boolean, outlineEditorOpen: boolean, operationTabAvailable: boolean): MobilePanelTab {
  const fallbackTab: MobilePanelTab = showCommandDock ? "command" : operationTabAvailable ? "operation" : "editor";
  if (tab === "outline") return outlineEditorOpen ? "outline" : fallbackTab;
  if (tab === "command") return showCommandDock ? "command" : operationTabAvailable ? "operation" : "editor";
  if (tab === "operation") return operationTabAvailable ? "operation" : fallbackTab;
  return tab;
}

function getOperationTargets(path: AtlasNode[]) {
  const node = path.at(-1);
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const siblings = parent?.children ?? [];
  const siblingIndex = node ? siblings.findIndex((sibling) => sibling.id === node.id) : -1;
  return {
    parentId: parent?.id ?? null,
    childId: node?.children[0]?.id ?? null,
    previousSiblingId: siblingIndex > 0 ? siblings[siblingIndex - 1]?.id ?? null : null,
    nextSiblingId: siblingIndex >= 0 ? siblings[siblingIndex + 1]?.id ?? null : null,
  };
}

function VoiceLogDialog({
  entries,
  summary,
  onClose,
  onClear,
  readOnly = false,
}: {
  entries: ReturnType<typeof useAtlasStore.getState>["voiceLogEntries"];
  summary: ReturnType<typeof useAtlasStore.getState>["voiceSessionSummary"];
  onClose: () => void;
  onClear: () => void;
  readOnly?: boolean;
}) {
  const displayedEntries = [...entries].reverse();
  const approvalCount = entries.filter((entry) => entry.status === "approval_required").length;

  const handleClear = () => {
    const confirmed = window.confirm(formatAppMessage("ui.app.clearTheLocalAiPartner.74ecd9c"));
    if (!confirmed) return;
    onClear();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="voice-log-dialog" role="dialog" aria-modal="true" aria-label={formatAppMessage("ui.app.aiPartnerLog.c126089")} onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header voice-log-header-with-clear">
          {readOnly ? (
            <span className="voice-log-header-spacer" aria-hidden="true" />
          ) : (
            <button className="icon-button" type="button" onClick={handleClear} aria-label={formatAppMessage("ui.app.clearAiPartnerLog.566017c")} disabled={entries.length === 0}>
              <Trash2 size={16} />
            </button>
          )}
          <div>
            <h2>{<I18nText id="ui.app.aiPartnerLog.593b3bf" />}</h2>
            <p>{formatAppMessage("dynamic.logSummary", { entries: entries.length, approvals: approvalCount, readOnly: readOnly ? "yes" : "no" })}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeAiPartnerLog.889d998")}>
              <X size={17} />
            </button>
          </div>
        </header>
        {summary ? (
          <article className="voice-log-summary">
            <strong>{<I18nText id="ui.app.latestSummary.9f2db38" />}</strong>
            <time>{formatVoiceLogTime(summary.createdAt)}</time>
            <p>{summary.text}</p>
          </article>
        ) : null}
        <div className="voice-log-list">
          {displayedEntries.length ? (
            displayedEntries.map((entry) => (
              <article key={entry.id} className={`voice-log-entry is-${entry.role}`}>
                <header>
                  <strong>{entry.title || voiceRoleLabel(entry.role)}</strong>
                  <span>{entry.status ? `${entry.status} / ` : ""}{formatVoiceLogTime(entry.createdAt)}</span>
                </header>
                <p>{entry.text}</p>
                {entry.status === "approval_required" ? (
                  <div className="voice-log-approval" role="status">
                    {<I18nText id="ui.app.humanApprovalRequiredThisTool.bb2ed5d" />}</div>
                ) : null}
                {entry.toolName ? <small>{<I18nText id="ui.app.tool.0042dcc" />}{entry.toolName}</small> : null}
                {entry.metadata ? <small>{formatVoiceLogMetadata(entry.metadata)}</small> : null}
              </article>
            ))
          ) : (
            <p className="voice-log-empty">{<I18nText id="ui.app.noAiPartnerLogEntries.6435b46" />}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function NotebookHistoryDialog({
  snapshots,
  status,
  error,
  onClose,
  onRefresh,
  onRestore,
}: {
  snapshots: NotebookSnapshot[];
  status: NotebookPersistenceStatus;
  error: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [restoringId, setRestoringId] = useState("");

  const handleRestore = async (snapshot: NotebookSnapshot) => {
    const confirmed = window.confirm(formatAppMessage("dialog.history.restoreConfirm", { title: snapshot.title, date: formatFullDateTime(snapshot.createdAt) }));
    if (!confirmed) return;
    try {
      setRestoringId(snapshot.id);
      await onRestore(snapshot.id);
      onClose();
    } catch (restoreError) {
      const message = restoreError instanceof Error ? restoreError.message : "Notebook restore failed.";
      window.alert(message);
    } finally {
      setRestoringId("");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="notebook-history-dialog" role="dialog" aria-modal="true" aria-label={formatAppMessage("ui.app.restoreFromHistory.6e67ff4")} onMouseDown={(event) => event.stopPropagation()}>
        <header className="voice-log-header">
          <div>
            <h2>{<I18nText id="ui.app.restoreFromHistory.8ed4723" />}</h2>
            <p>{notebookHistoryDialogStatus(status, snapshots.length, error)}</p>
          </div>
          <div className="voice-log-actions">
            <button className="icon-button" type="button" onClick={() => void onRefresh()} aria-label={formatAppMessage("ui.app.refreshNotebookHistory.f80e50c")}>
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label={formatAppMessage("ui.app.closeNotebookHistory.84b445f")}>
              <X size={17} />
            </button>
          </div>
        </header>
        {error ? <p className="notebook-history-error">{error}</p> : null}
        <div className="notebook-history-list">
          {snapshots.length ? (
            snapshots.map((snapshot) => (
              <article key={snapshot.id} className="notebook-history-entry">
                <div>
                  <strong>{snapshot.title}</strong>
                  <span>
                    {<I18nText id="ui.app.generation.4d2e8b5" />}{snapshot.generation} / {formatFullDateTime(snapshot.createdAt)}
                  </span>
                  <small>
                    {snapshot.nodeCount} {<I18nText id="ui.app.nodes.af90a82" />}{formatBytes(snapshot.sizeBytes)}
                  </small>
                </div>
                <button className="secondary-button" type="button" disabled={Boolean(restoringId)} onClick={() => void handleRestore(snapshot)}>
                  {restoringId === snapshot.id ? formatAppMessage("ui.app.restoring.f27168d") : formatAppMessage("ui.app.restore.eb5d724")}
                </button>
              </article>
            ))
          ) : (
            <p className="voice-log-empty">{<I18nText id="ui.app.noNotebookSnapshotsYetMake.790ea77" />}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function notebookHistoryStatusLabel(
  status: NotebookPersistenceStatus,
  snapshotCount: number,
  durable: boolean,
  error: string,
) {
  if (error) return formatAppMessage("label.history.saveError");
  if (status === "loading") return formatAppMessage("label.history.loading");
  return formatAppMessage("label.history.snapshotSummary", { count: snapshotCount, durable: durable ? "yes" : "no" });
}

function notebookHistoryDialogStatus(status: NotebookPersistenceStatus, snapshotCount: number, error: string) {
  if (error) return formatAppMessage("label.history.needsAttention");
  if (status === "loading") return formatAppMessage("label.history.loadingLocal");
  return formatAppMessage("label.history.retainedSnapshots", { count: snapshotCount });
}

function voiceRoleLabel(role: string) {
  switch (role) {
    case "user":
      return formatAppMessage("label.role.user");
    case "assistant":
      return formatAppMessage("label.role.voicePartner");
    case "tool":
      return formatAppMessage("label.role.tool");
    case "summary":
      return formatAppMessage("label.role.summary");
    case "error":
      return formatAppMessage("label.role.error");
    default:
      return formatAppMessage("label.role.system");
  }
}

function formatVoiceLogMetadata(metadata: Record<string, unknown>) {
  const sources = Array.isArray(metadata.sources) ? metadata.sources.length : undefined;
  const citations = Array.isArray(metadata.citations) ? metadata.citations.length : undefined;
  const usage = metadata.usage && typeof metadata.usage === "object" && !Array.isArray(metadata.usage)
    ? (metadata.usage as Record<string, unknown>)
    : undefined;
  const items = [
    ["approval", metadata.approvalId],
    ["tool", metadata.toolName],
    ["status", metadata.status],
    ["executed", typeof metadata.executed === "boolean" ? String(metadata.executed) : undefined],
    ["model", metadata.model],
    ["provider", metadata.provider],
    ["duration", typeof metadata.durationMs === "number" ? `${metadata.durationMs}ms` : usageNumber(usage?.durationMs, "ms")],
    ["tokens", usageNumber(usage?.totalTokens)],
    ["audio", typeof metadata.audioSizeBytes === "number" ? formatBytes(metadata.audioSizeBytes) : undefined],
    ["mime", metadata.audioMimeType ?? metadata.mimeType],
    ["chunks", metadata.chunks],
    ["sources", sources],
    ["citations", citations],
    ["node", metadata.nodeId],
    ["nodes", Array.isArray(metadata.nodeIds) ? metadata.nodeIds.length : undefined],
    ["args", summarizeMetadataArgs(metadata.args)],
  ]
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  return items.join(" / ");
}

function usageNumber(value: unknown, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : undefined;
}

function summarizeMetadataArgs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, 4)
    .map(([key, item]) => `${key}=${summarizeMetadataArgValue(item)}`);
  return entries.length ? entries.join(", ") : undefined;
}

function summarizeMetadataArgValue(value: unknown) {
  if (typeof value === "string") return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (value && typeof value === "object") return "object";
  return "";
}

function formatVoiceLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(currentAppLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFullDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(currentAppLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

type MobileNotificationPermission = NotificationPermission | "unsupported";
type RenderQuality = "high" | "low";
type DeviceOrientationPermissionState = "granted" | "denied" | "prompt";
type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<DeviceOrientationPermissionState>;
};

const MOBILE_NOTIFICATION_STORAGE_KEY = "mind-atlas-mobile-notifications-v1";

function useMobileNotificationPulses(
  pulses: NotificationPulse[],
  atlasRoot: AtlasNode,
  enabled: boolean,
  permission: MobileNotificationPermission,
) {
  const seenPulseIdsRef = useRef<Set<string>>(new Set());
  const lastNotificationByTagRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      pulses.forEach((pulse) => seenPulseIdsRef.current.add(pulse.id));
      return;
    }

    for (const pulse of pulses) {
      if (seenPulseIdsRef.current.has(pulse.id)) continue;
      seenPulseIdsRef.current.add(pulse.id);
      if (enabled && permission === "granted" && isMobileNotificationTarget()) {
        const tag = `${pulse.nodeId}:${pulse.kind}:${pulse.title}`;
        const now = Date.now();
        const lastSentAt = lastNotificationByTagRef.current.get(tag) ?? 0;
        if (now - lastSentAt > 5 * 60 * 1000) {
          lastNotificationByTagRef.current.set(tag, now);
          sendMobilePulseNotification(pulse, atlasRoot);
        }
      }
    }

    if (seenPulseIdsRef.current.size > 500) {
      seenPulseIdsRef.current = new Set(pulses.slice(-120).map((pulse) => pulse.id));
    }
  }, [atlasRoot, enabled, permission, pulses]);
}

function sendMobilePulseNotification(pulse: NotificationPulse, atlasRoot: AtlasNode) {
  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  const message = buildMobileNotificationMessage(pulse, atlasRoot);
  const options: NotificationOptions & { badge?: string; timestamp?: number; renotify?: boolean } = {
    body: message.body,
    tag: `mind-atlas-${pulse.nodeId}-${pulse.kind}`,
    renotify: false,
    badge: "/favicon.svg",
    icon: "/favicon.svg",
    timestamp: Date.now(),
    data: {
      nodeId: pulse.nodeId,
      kind: pulse.kind,
    },
  };
  showMobileNotification(message.title, options);
}

async function showMobileNotification(
  title: string,
  options: NotificationOptions & { badge?: string; timestamp?: number; renotify?: boolean },
) {
  if ("serviceWorker" in navigator) {
    try {
      const registration =
        (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
      await registration.showNotification(title, options);
      return;
    } catch {
      // Fall through to the page Notification API for desktop browsers.
    }
  }
  try {
    const notification = new Notification(title, options);
    window.setTimeout(() => notification.close(), 8000);
  } catch {
    // Some mobile browsers only expose notifications through Service Worker.
  }
}

function buildMobileNotificationMessage(pulse: NotificationPulse, atlasRoot: AtlasNode) {
  const node = findNode(atlasRoot, pulse.nodeId);
  const isReplyNode = node?.nodeType === "ai_reply" || node?.nodeType === "tool_result";
  const title = "Mind Atlas";
  const nodeTitle = node?.title?.trim() || pulse.title;
  const bodySource = isReplyNode
    ? `${nodeTitle}: ${node.summary || node.body || notificationKindLabel(pulse.kind)}`
    : `${nodeTitle}: ${notificationKindLabel(pulse.kind)}`;
  return {
    title: truncateNotificationText(title, 80),
    body: truncateNotificationText(bodySource, 180),
  };
}

function truncateNotificationText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function notificationKindLabel(kind: NotificationPulse["kind"]) {
  switch (kind) {
    case "error":
      return formatAppMessage("label.notification.error");
    case "codex":
      return formatAppMessage("label.notification.codex");
    case "openclaw":
      return formatAppMessage("label.notification.openClaw");
    case "claude":
      return formatAppMessage("label.notification.claudeCode");
    case "cost":
      return formatAppMessage("label.notification.cost");
    case "done":
      return formatAppMessage("label.notification.completed");
    case "needs_review":
      return formatAppMessage("label.notification.review");
  }
}

function loadMobileNotificationPreference() {
  if (readAboutDemoConfig()) return false;
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MOBILE_NOTIFICATION_STORAGE_KEY) === "true";
}

function persistMobileNotificationPreference(enabled: boolean) {
  if (readAboutDemoConfig()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MOBILE_NOTIFICATION_STORAGE_KEY, String(enabled));
}

function loadRenderQualityPreference(): RenderQuality {
  if (readAboutDemoConfig()) return "high";
  if (typeof window === "undefined") return "high";
  const stored = window.localStorage.getItem(RENDER_QUALITY_STORAGE_KEY);
  if (isRenderQuality(stored)) return stored;
  return "high";
}

function shouldShowCommandDock(rootId: string, selectedNodeId: string, viewport: ViewportState) {
  if (selectedNodeId !== rootId) return true;
  return Number.isFinite(viewport.zoom) && viewport.zoom <= ROOT_COMMAND_MAX_ZOOM;
}

function persistRenderQualityPreference(quality: RenderQuality) {
  if (readAboutDemoConfig()) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RENDER_QUALITY_STORAGE_KEY, quality);
}

function isRenderQuality(value: string | null): value is RenderQuality {
  return value === "high" || value === "low";
}

function isPageRuntimeActive() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function getMobileNotificationPermission(): MobileNotificationPermission {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function isMobileNotificationTarget() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const mobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowViewport = window.matchMedia?.("(max-width: 980px)").matches ?? false;
  return mobileUa || (coarsePointer && narrowViewport);
}

function mobileNotificationStatusLabel(
  enabled: boolean,
  permission: MobileNotificationPermission,
  message: string,
) {
  if (message) return message;
  if (!isMobileNotificationTarget()) return formatAppMessage("label.mobile.only");
  if (permission === "unsupported") return formatAppMessage("label.mobile.unsupported");
  if (permission === "denied") return formatAppMessage("label.mobile.blocked");
  if (enabled && permission === "granted") return formatAppMessage("common.on");
  if (permission === "granted") return formatAppMessage("common.off");
  return formatAppMessage("label.mobile.tapToEnable");
}

function isDeviceOrientationSupported() {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

function canRestoreVrModeWithoutGesture() {
  if (!isDeviceOrientationSupported()) return false;
  const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
  return typeof orientationEvent.requestPermission !== "function";
}

async function requestDeviceOrientationAccess(): Promise<DeviceOrientationPermissionState> {
  if (!isDeviceOrientationSupported()) return "denied";
  const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission;
  if (typeof orientationEvent.requestPermission !== "function") return "granted";
  try {
    return await orientationEvent.requestPermission();
  } catch {
    return "denied";
  }
}

function vrModeStatusLabel(enabled: boolean, message: string) {
  if (message) return message;
  if (!isDeviceOrientationSupported()) return formatAppMessage("label.mobile.unsupported");
  return enabled ? formatAppMessage("label.vr.tilt") : formatAppMessage("common.off");
}

function useMobileBackButtonGuard({ closeOverlays }: { closeOverlays: () => void }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMobileBackButtonGuardTarget()) return;

    const state = window.history.state;
    if (!state?.mindAtlasBackGuard) {
      window.history.pushState({ ...(state && typeof state === "object" ? state : {}), mindAtlasBackGuard: true }, "", window.location.href);
    }

    const handlePopState = () => {
      closeOverlays();
      window.history.pushState({ mindAtlasBackGuard: true }, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [closeOverlays]);
}

function isMobileBackButtonGuardTarget() {
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarsePointer && window.innerWidth <= 980;
}

function useVisualViewportHeight(commandInputEditing: boolean) {
  const commandInputEditingRef = useRef(commandInputEditing);
  const requestViewportUpdateRef = useRef<() => void>(() => undefined);
  const stableHeightRef = useRef<number | null>(null);
  const lastViewportWidthRef = useRef<number | null>(null);
  const keyboardOverlayPreparedUntilRef = useRef(0);
  const keyboardPhaseRef = useRef<MobileKeyboardPhase>("idle");
  const keyboardOpeningStartedAtRef = useRef<number | null>(null);
  const keyboardClosingStartedAtRef = useRef<number | null>(null);
  const lastKeyboardBottomOffsetRef = useRef(0);
  const keyboardSessionBottomOffsetRef = useRef(0);
  const lastKeyboardLayoutSignatureRef = useRef("");

  useEffect(() => {
    commandInputEditingRef.current = commandInputEditing;
    requestViewportUpdateRef.current();
  }, [commandInputEditing]);

  useEffect(() => {
    const timeoutIds = new Set<number>();
    let animationFrameId: number | null = null;
    let geometrySettleTimeoutId: number | null = null;

    const readViewport = () => {
      const visualViewport = window.visualViewport;
      const visualWidth = Math.round(visualViewport?.width ?? window.innerWidth);
      const visualHeight = Math.round(visualViewport?.height ?? window.innerHeight);
      const visualBottom = Math.round((visualViewport?.offsetTop ?? 0) + visualHeight);
      const layoutHeight = Math.round(Math.max(visualBottom, window.innerHeight, document.documentElement.clientHeight));
      return { visualWidth, visualHeight, visualBottom, layoutHeight };
    };

    const rememberStableHeight = () => {
      const { visualWidth, layoutHeight } = readViewport();
      const lastWidth = lastViewportWidthRef.current;

      if (lastWidth !== null && Math.abs(visualWidth - lastWidth) > 80) {
        stableHeightRef.current = null;
      }

      lastViewportWidthRef.current = visualWidth;
      stableHeightRef.current = Math.max(stableHeightRef.current ?? 0, layoutHeight);
    };

    const readKeyboardViewport = () => {
      const viewport = readViewport();
      const stableHeight = stableHeightRef.current ?? viewport.layoutHeight;
      const visualKeyboardTop = clampNumber(viewport.visualBottom, 0, stableHeight);
      const virtualKeyboardTop = getVirtualKeyboardTop(stableHeight);
      const keyboardTop = virtualKeyboardTop === null ? visualKeyboardTop : Math.min(visualKeyboardTop, virtualKeyboardTop);
      const measuredKeyboardBottomOffset = Math.max(0, stableHeight - keyboardTop);
      return {
        ...viewport,
        stableHeight,
        keyboardTop,
        measuredKeyboardBottomOffset,
        keyboardLikelyOpen: measuredKeyboardBottomOffset >= MOBILE_KEYBOARD_OPEN_THRESHOLD_PX,
      };
    };

    const applyIdleViewportState = (appHeight: number) => {
      const roundedAppHeight = Math.round(appHeight);
      const layoutSignature = `idle:${roundedAppHeight}`;
      const layoutChanged = lastKeyboardLayoutSignatureRef.current !== layoutSignature;
      keyboardPhaseRef.current = "idle";
      keyboardOpeningStartedAtRef.current = null;
      keyboardClosingStartedAtRef.current = null;
      keyboardOverlayPreparedUntilRef.current = 0;
      lastKeyboardBottomOffsetRef.current = 0;
      keyboardSessionBottomOffsetRef.current = 0;
      lastKeyboardLayoutSignatureRef.current = layoutSignature;
      setVirtualKeyboardOverlay(false);
      clearKeyboardPanelSizeLock();
      document.documentElement.removeAttribute("data-keyboard-overlay-input");
      document.documentElement.removeAttribute("data-keyboard-overlay-portrait");
      document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
      document.documentElement.removeAttribute("data-keyboard-state");
      if (!layoutChanged) return;
      document.documentElement.style.setProperty("--app-height", `${roundedAppHeight}px`);
      document.documentElement.style.setProperty("--keyboard-top", `${roundedAppHeight}px`);
      document.documentElement.style.setProperty("--keyboard-bottom-offset", "0px");
      window.dispatchEvent(new Event(MOBILE_KEYBOARD_PROFILE_EVENT));
    };

    const applyKeyboardViewportState = (phase: MobileKeyboardPhase, stableHeight: number, keyboardBottomOffset: number) => {
      const boundedKeyboardBottomOffset = clampNumber(Math.round(keyboardBottomOffset), 0, stableHeight);
      const keyboardTop = Math.max(0, stableHeight - boundedKeyboardBottomOffset);
      const spaceLabelActive = isSpaceLabelKeyboardTargetActive();
      const layoutSignature = `keyboard:${Math.round(stableHeight)}:${boundedKeyboardBottomOffset}:${spaceLabelActive ? 1 : 0}`;
      const layoutChanged = lastKeyboardLayoutSignatureRef.current !== layoutSignature;

      keyboardPhaseRef.current = phase;
      lastKeyboardBottomOffsetRef.current = boundedKeyboardBottomOffset;
      lastKeyboardLayoutSignatureRef.current = layoutSignature;
      setVirtualKeyboardOverlay(false);
      document.documentElement.setAttribute("data-keyboard-overlay-input", "true");
      document.documentElement.setAttribute("data-keyboard-overlay-portrait", "true");
      document.documentElement.setAttribute("data-keyboard-state", phase);
      if (spaceLabelActive) {
        document.documentElement.setAttribute("data-keyboard-overlay-space-label", "true");
      } else {
        document.documentElement.removeAttribute("data-keyboard-overlay-space-label");
      }
      if (!hasKeyboardPanelSizeLock()) lockKeyboardPanelSizeForKeyboardOverlay();
      if (!layoutChanged) return;
      document.documentElement.style.setProperty("--app-height", `${stableHeight}px`);
      document.documentElement.style.setProperty("--keyboard-top", `${keyboardTop}px`);
      document.documentElement.style.setProperty("--keyboard-bottom-offset", `${boundedKeyboardBottomOffset}px`);
      window.dispatchEvent(new Event(MOBILE_KEYBOARD_PROFILE_EVENT));
    };

    const scheduleViewportUpdate = (delay = 0) => {
      if (delay > 0) {
        const timeoutId = window.setTimeout(() => {
          timeoutIds.delete(timeoutId);
          scheduleViewportUpdate();
        }, delay);
        timeoutIds.add(timeoutId);
        return;
      }
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        updateViewportHeight();
      });
    };

    const scheduleGeometrySettledUpdate = () => {
      // Mobile browsers emit several visualViewport values while the keyboard animates.
      // The keyboard session uses one locked safe area, so these intermediate frames
      // must not resize the Three.js canvas.
      if (keyboardPhaseRef.current !== "idle") return;
      scheduleViewportUpdate();
    };

    const getKeyboardOverlayTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return;
      const spaceLabelTarget = target.closest(SPACE_LABEL_KEYBOARD_SELECTOR);
      if (!target.closest(KEYBOARD_OVERLAY_INPUT_SELECTOR)) return;
      if (spaceLabelTarget instanceof HTMLElement && spaceLabelTarget.dataset.selected !== "true") return;
      if (!isMobileKeyboardOverlayTarget(stableHeightRef.current)) return;
      return { spaceLabelTarget };
    };

    const primeKeyboardOverlayTarget = (target: EventTarget | null) => {
      const overlayTarget = getKeyboardOverlayTarget(target);
      if (!overlayTarget) return;
      rememberStableHeight();
      lockKeyboardPanelSizeForKeyboardOverlay();
      setVirtualKeyboardOverlay(false);
    };

    const prepareKeyboardOverlay = (target: EventTarget | null) => {
      const overlayTarget = getKeyboardOverlayTarget(target);
      if (!overlayTarget) return;
      keyboardOverlayPreparedUntilRef.current = Date.now() + MOBILE_KEYBOARD_PREPARE_MS;
      keyboardOpeningStartedAtRef.current = Date.now();
      keyboardClosingStartedAtRef.current = null;
      rememberStableHeight();
      lockKeyboardPanelSizeForKeyboardOverlay();
      setVirtualKeyboardOverlay(false);
      const stableHeight = stableHeightRef.current ?? readKeyboardViewport().stableHeight;
      if (keyboardSessionBottomOffsetRef.current <= 0) {
        keyboardSessionBottomOffsetRef.current = getFallbackKeyboardBottomOffset(stableHeight);
      }
      applyKeyboardViewportState("opening", stableHeight, keyboardSessionBottomOffsetRef.current);
      scheduleViewportUpdate(MOBILE_KEYBOARD_OPEN_SETTLE_MS);
    };

    const updateViewportHeight = () => {
      const keyboardOverlayPrepared = Date.now() < keyboardOverlayPreparedUntilRef.current;
      const viewport = readKeyboardViewport();
      const keyboardOverlayPortrait = isMobileKeyboardOverlayTarget(stableHeightRef.current);
      const activeKeyboardTarget = commandInputEditingRef.current || isKeyboardOverlayTextTargetActive();
      const previousPhase = keyboardPhaseRef.current;
      let phase: MobileKeyboardPhase = "idle";

      if (keyboardOverlayPortrait && (activeKeyboardTarget || keyboardOverlayPrepared)) {
        keyboardClosingStartedAtRef.current = null;
        if (viewport.keyboardLikelyOpen && previousPhase === "open") {
          phase = "open";
          keyboardOpeningStartedAtRef.current = null;
        } else {
          const openingStartedAt = keyboardOpeningStartedAtRef.current ?? Date.now();
          keyboardOpeningStartedAtRef.current = openingStartedAt;
          if (viewport.keyboardLikelyOpen && Date.now() - openingStartedAt >= MOBILE_KEYBOARD_OPEN_SETTLE_MS) {
            phase = "open";
            keyboardOpeningStartedAtRef.current = null;
          } else if (Date.now() - openingStartedAt <= MOBILE_KEYBOARD_PREPARE_MS) {
            phase = "opening";
          }
        }
      } else if (keyboardOverlayPortrait && previousPhase !== "idle" && viewport.keyboardLikelyOpen) {
        const closingStartedAt = keyboardClosingStartedAtRef.current ?? Date.now();
        keyboardClosingStartedAtRef.current = closingStartedAt;
        keyboardOpeningStartedAtRef.current = null;
        if (Date.now() - closingStartedAt <= MOBILE_KEYBOARD_CLOSING_MS) {
          phase = "closing";
        }
      }

      if (phase === "idle") {
        rememberStableHeight();
        applyIdleViewportState(viewport.visualHeight);
        return;
      }

      if (keyboardSessionBottomOffsetRef.current <= 0) {
        keyboardSessionBottomOffsetRef.current = getFallbackKeyboardBottomOffset(viewport.stableHeight);
      }
      applyKeyboardViewportState(phase, viewport.stableHeight, keyboardSessionBottomOffsetRef.current);
    };

    const updateViewportHeightAfterOrientation = () => {
      stableHeightRef.current = null;
      lastViewportWidthRef.current = null;
      keyboardOpeningStartedAtRef.current = null;
      keyboardClosingStartedAtRef.current = null;
      keyboardOverlayPreparedUntilRef.current = 0;
      keyboardSessionBottomOffsetRef.current = 0;
      applyIdleViewportState(readViewport().visualHeight);
      scheduleViewportUpdate(80);
      scheduleViewportUpdate(360);
    };

    const handlePointerDown = (event: PointerEvent) => primeKeyboardOverlayTarget(event.target);
    const handleTouchStart = (event: TouchEvent) => primeKeyboardOverlayTarget(event.target);
    const handleFocusIn = (event: FocusEvent) => prepareKeyboardOverlay(event.target);
    const handleFocusOut = () => {
      keyboardOverlayPreparedUntilRef.current = 0;
      keyboardOpeningStartedAtRef.current = null;
      keyboardClosingStartedAtRef.current = Date.now();
      scheduleViewportUpdate();
      scheduleViewportUpdate(MOBILE_KEYBOARD_CLOSING_MS);
      scheduleViewportUpdate(MOBILE_KEYBOARD_CLOSING_MS + 180);
    };
    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;

    requestViewportUpdateRef.current = () => scheduleViewportUpdate();
    updateViewportHeight();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("touchstart", handleTouchStart, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    window.visualViewport?.addEventListener("resize", scheduleGeometrySettledUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleGeometrySettledUpdate);
    virtualKeyboard?.addEventListener("geometrychange", scheduleGeometrySettledUpdate);
    window.addEventListener("resize", scheduleGeometrySettledUpdate);
    window.addEventListener("orientationchange", updateViewportHeightAfterOrientation);
    return () => {
      requestViewportUpdateRef.current = () => undefined;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIds.clear();
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      if (geometrySettleTimeoutId !== null) window.clearTimeout(geometrySettleTimeoutId);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      window.visualViewport?.removeEventListener("resize", scheduleGeometrySettledUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleGeometrySettledUpdate);
      virtualKeyboard?.removeEventListener("geometrychange", scheduleGeometrySettledUpdate);
      window.removeEventListener("resize", scheduleGeometrySettledUpdate);
      window.removeEventListener("orientationchange", updateViewportHeightAfterOrientation);
      applyIdleViewportState(readViewport().visualHeight);
    };
  }, []);
}

type MobileKeyboardPhase = "idle" | "opening" | "open" | "closing";

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isMobileKeyboardOverlayTarget(stableHeight: number | null) {
  if (typeof window === "undefined") return false;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const narrowViewport = width <= 980 || window.innerWidth <= 980;
  const keyboardPortraitLocked = document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true" && hasKeyboardPanelSizeLock();
  const portraitBeforeKeyboard = keyboardPortraitLocked || (stableHeight ? stableHeight > width : (window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight >= width));
  return coarsePointer && narrowViewport && portraitBeforeKeyboard;
}

function getVirtualKeyboardTop(stableHeight: number) {
  const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
  const rect = virtualKeyboard?.boundingRect;
  if (!rect || rect.height <= 0) return null;
  const fallbackTop = stableHeight - rect.height;
  const rawTop = rect.top > 0 ? rect.top : rect.y > 0 ? rect.y : fallbackTop;
  const top = Math.round(Math.min(stableHeight, Math.max(0, rawTop)));
  return top <= 0 || top >= stableHeight ? null : top;
}

function getFallbackKeyboardBottomOffset(stableHeight: number) {
  return Math.round(Math.min(380, Math.max(260, stableHeight * 0.42)));
}

function isKeyboardOverlayTextTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(KEYBOARD_OVERLAY_INPUT_SELECTOR));
}

function isCommandKeyboardTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(".command-dock input, .command-dock textarea, .command-dock select"));
}

function isSpaceLabelKeyboardTargetActive() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && Boolean(activeElement.closest(SPACE_LABEL_KEYBOARD_SELECTOR));
}

function isKeyboardViewportLikelyOpen(stableHeight: number | null) {
  if (!stableHeight) return false;
  const visualViewport = window.visualViewport;
  const height = Math.round(visualViewport?.height ?? window.innerHeight);
  const visualKeyboardTop = Math.round((visualViewport?.offsetTop ?? 0) + height);
  const virtualKeyboardTop = getVirtualKeyboardTop(stableHeight);
  const keyboardTop = virtualKeyboardTop === null ? visualKeyboardTop : Math.min(visualKeyboardTop, virtualKeyboardTop);
  return Math.max(0, stableHeight - keyboardTop) >= MOBILE_KEYBOARD_OPEN_THRESHOLD_PX;
}

function lockKeyboardPanelSizeForKeyboardOverlay() {
  const panel = document.querySelector<HTMLElement>(".mobile-workspace-panel:not(.is-closing)");
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 160 || rect.height < 48) return;
  document.documentElement.style.setProperty("--keyboard-panel-width", `${Math.round(rect.width)}px`);
  document.documentElement.style.setProperty("--keyboard-panel-height", `${Math.round(rect.height)}px`);
}

function clearKeyboardPanelSizeLock() {
  document.documentElement.style.removeProperty("--keyboard-panel-width");
  document.documentElement.style.removeProperty("--keyboard-panel-height");
}

function hasKeyboardPanelSizeLock() {
  return document.documentElement.style.getPropertyValue("--keyboard-panel-width") !== "";
}

function setVirtualKeyboardOverlay(enabled: boolean) {
  const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;
  if (!virtualKeyboard) return;
  try {
    virtualKeyboard.overlaysContent = enabled;
  } catch {
    // Some Chromium builds expose the API but reject writes outside supported contexts.
  }
}

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: EventTarget & {
    overlaysContent: boolean;
    boundingRect?: DOMRectReadOnly;
  };
};

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function useMobilePortraitBreadcrumbLayout() {
  const [matches, setMatches] = useState(() => isMobilePortraitBreadcrumbTarget());

  useEffect(() => {
    const update = () => setMatches(isMobilePortraitBreadcrumbTarget());
    const query = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)");
    update();
    query?.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener(MOBILE_KEYBOARD_PROFILE_EVENT, update);
    return () => {
      query?.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener(MOBILE_KEYBOARD_PROFILE_EVENT, update);
    };
  }, []);

  return matches;
}

function useMobileOperationSurface() {
  const [matches, setMatches] = useState(() => isMobileOperationSurfaceTarget());

  useEffect(() => {
    const update = () => setMatches(isMobileOperationSurfaceTarget());
    const queries = [
      window.matchMedia?.("(pointer: coarse)"),
      window.matchMedia?.("(hover: none)"),
      window.matchMedia?.("(max-width: 980px)"),
      window.matchMedia?.("(max-height: 620px)"),
      window.matchMedia?.("(orientation: portrait)"),
    ].filter((query): query is MediaQueryList => Boolean(query));
    update();
    queries.forEach((query) => query.addEventListener?.("change", update));
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener(MOBILE_KEYBOARD_PROFILE_EVENT, update);
    return () => {
      queries.forEach((query) => query.removeEventListener?.("change", update));
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener(MOBILE_KEYBOARD_PROFILE_EVENT, update);
    };
  }, []);

  return matches;
}

function useMobilePortraitOperationSurface() {
  const [matches, setMatches] = useState(() => isMobilePortraitOperationSurfaceTarget());

  useEffect(() => {
    const update = () => setMatches(isMobilePortraitOperationSurfaceTarget());
    const queries = [
      window.matchMedia?.("(pointer: coarse)"),
      window.matchMedia?.("(hover: none)"),
      window.matchMedia?.("(max-width: 980px)"),
      window.matchMedia?.("(orientation: portrait)"),
    ].filter((query): query is MediaQueryList => Boolean(query));
    update();
    queries.forEach((query) => query.addEventListener?.("change", update));
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener(MOBILE_KEYBOARD_PROFILE_EVENT, update);
    return () => {
      queries.forEach((query) => query.removeEventListener?.("change", update));
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener(MOBILE_KEYBOARD_PROFILE_EVENT, update);
    };
  }, []);

  return matches;
}

function isMobilePortraitBreadcrumbTarget() {
  if (typeof window === "undefined") return false;
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return true;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrowPortrait = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)").matches ?? false;
  return coarsePointer && narrowPortrait;
}

function isMobileOperationSurfaceTarget() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return true;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const hoverNone = window.matchMedia?.("(hover: none)").matches ?? false;
  const narrowViewport = window.matchMedia?.("(max-width: 980px)").matches ?? false;
  const shortViewport = window.matchMedia?.("(max-height: 620px)").matches ?? false;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const touchDevice = navigator.maxTouchPoints > 0;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  const compactViewport = narrowViewport || shortViewport;
  const phoneOrSmallTabletViewport = compactViewport || (shortSide <= 820 && longSide <= 1366);
  if (mobileUa || coarsePointer) return phoneOrSmallTabletViewport;
  return hoverNone && (touchDevice || compactViewport) && phoneOrSmallTabletViewport;
}

function isMobilePortraitOperationSurfaceTarget() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return true;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const hoverNone = window.matchMedia?.("(hover: none)").matches ?? false;
  const narrowPortrait = window.matchMedia?.("(max-width: 980px) and (orientation: portrait)").matches ?? false;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  const touchDevice = navigator.maxTouchPoints > 0;
  return narrowPortrait && (coarsePointer || mobileUa || (hoverNone && touchDevice));
}

function isMobileWorkspacePanelRevealTarget() {
  if (typeof window === "undefined") return false;
  if (document.documentElement.getAttribute("data-keyboard-overlay-portrait") === "true") return true;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const mobileViewport = window.matchMedia?.("(max-width: 980px)").matches ?? false;
  return coarsePointer && mobileViewport;
}

function DatasetTitleInput({
  title,
  placeholderTitle,
  onChange,
}: {
  title: string;
  placeholderTitle: string;
  onChange: (title: string) => void;
}) {
  const titleIsPlaceholder = isUniverseTitlePlaceholder(title, placeholderTitle);
  const storedTitle = title && !titleIsPlaceholder ? title : "";
  const [draftTitle, setDraftTitle] = useState(storedTitle);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) return;
    setDraftTitle(storedTitle);
  }, [editing, storedTitle]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType === "mouse" || editing) return;
    event.preventDefault();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <input
      ref={inputRef}
      className="dataset-title-input"
      value={draftTitle}
      placeholder={placeholderTitle}
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        if (!editing) event.preventDefault();
      }}
      onFocus={() => {
        setEditing(true);
        if (titleIsPlaceholder && title !== "") {
          setDraftTitle("");
          onChange("");
        }
      }}
      onBlur={() => setEditing(false)}
      onChange={(event) => {
        const nextTitle = event.target.value;
        setDraftTitle(nextTitle);
        onChange(nextTitle);
      }}
      aria-label={formatAppMessage("ui.app.datasetName.4133ac0")}
    />
  );
}

function usePreventBrowserViewportGestures(bridgeAboutDemoScroll = false) {
  useEffect(() => {
    const preventDefault = (event: Event) => event.preventDefault();
    const preventViewportTouchMove = (event: TouchEvent) => {
      if (bridgeAboutDemoScroll && shouldBridgeAboutDemoScroll(event.target)) {
        // The parent landing page owns mobile vertical gestures through a
        // transparent touch layer. Do not turn iframe touchmove into a second,
        // competing scroll implementation.
        return;
      }
      if (shouldAllowNativeTouchScroll(event.target)) return;
      event.preventDefault();
    };
    const preventCtrlWheelZoom = (event: WheelEvent) => {
      if (bridgeAboutDemoScroll && shouldBridgeAboutDemoScroll(event.target) && !event.ctrlKey) {
        postAboutDemoParentScroll(event.deltaY);
        event.preventDefault();
        return;
      }
      if (event.ctrlKey) event.preventDefault();
    };

    document.addEventListener("gesturestart", preventDefault, { passive: false, capture: true });
    document.addEventListener("gesturechange", preventDefault, { passive: false, capture: true });
    document.addEventListener("gestureend", preventDefault, { passive: false, capture: true });
    document.addEventListener("touchmove", preventViewportTouchMove, { passive: false, capture: true });
    window.addEventListener("wheel", preventCtrlWheelZoom, { passive: false, capture: true });
    return () => {
      document.removeEventListener("gesturestart", preventDefault, { capture: true });
      document.removeEventListener("gesturechange", preventDefault, { capture: true });
      document.removeEventListener("gestureend", preventDefault, { capture: true });
      document.removeEventListener("touchmove", preventViewportTouchMove, { capture: true });
      window.removeEventListener("wheel", preventCtrlWheelZoom, { capture: true });
    };
  }, [bridgeAboutDemoScroll]);
}

function shouldAllowNativeTouchScroll(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("textarea, .context-menu, .surface-context-menu, .status-context-menu, .reminder-context-menu, .focus-panel, .event-strip, .voice-log-dialog, .node-search-dialog, .notebook-history-dialog, .text-import-dialog, .merge-preview-dialog, .cloud-load-dialog, .voice-settings-dialog, .outline-editor-panel, .mobile-workspace-panel"));
}

function shouldBridgeAboutDemoScroll(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return !target.closest("textarea, input, select, button, a");
}

function postAboutDemoParentScroll(deltaY: number) {
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
  if (window.parent === window) return;
  try {
    if (window.parent.location.origin === window.location.origin) {
      window.parent.scrollBy(0, deltaY);
      return;
    }
  } catch {
    // Cross-origin or opaque origins fall back to postMessage below.
  }
  const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
  window.parent.postMessage({ type: "mind-atlas-about-scroll", deltaY }, targetOrigin);
}

function isUniverseTitlePlaceholder(title: string, placeholderTitle: string) {
  return title === DEFAULT_DATASET_TITLE || title === placeholderTitle || UNIVERSE_TITLE_PLACEHOLDER_ALIASES.includes(title);
}

function AtlasBreadcrumb({ path, mobilePortrait, onFocus }: { path: AtlasNode[]; mobilePortrait: boolean; onFocus: (id: string) => void }) {
  const crumbs = compactBreadcrumb(path, mobilePortrait);
  const handleLogoClick = () => {
    emitOnboardingEvent("home-logo-clicked");
    onFocus(path[0].id);
  };

  return (
    <nav className={`atlas-breadcrumb ${mobilePortrait ? "is-mobile-portrait" : ""}`} aria-label={formatAppMessage("ui.app.atlasPath.c522500")}>
      <button className="atlas-logo-crumb" type="button" onClick={handleLogoClick}>
        {<I18nText id="ui.app.mindatlas.94ba7f6" />}</button>
      {crumbs.map((crumb, index) =>
        crumb === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="breadcrumb-ellipsis">
            ...
          </span>
        ) : (
          <button key={crumb.id} type="button" onClick={() => onFocus(crumb.id)}>
            {shortCrumb(crumb.title)}
          </button>
        ),
      )}
    </nav>
  );
}

function UnreadNotificationLinks({
  items,
  voiceLogEntry,
  voiceLogUnreadCount,
  onFocus,
  onOpenVoiceLog,
}: {
  items: Array<{
    notification: {
      nodeId: string;
      kind: NotificationPulse["kind"];
      title: string;
      signature?: string;
    };
    node: AtlasNode;
  }>;
  voiceLogEntry?: VoiceLogEntry;
  voiceLogUnreadCount: number;
  onFocus: (id: string) => void;
  onOpenVoiceLog: () => void;
}) {
  if (!items.length && !voiceLogEntry) return null;

  return (
    <nav className="unread-notification-links" aria-label={formatAppMessage("ui.app.unreadNotifications.f2695f5")}>
      {voiceLogEntry ? (
        <button
          className={`unread-notification-link is-voice-log ${voiceLogEntry.role === "error" ? "is-error" : ""}`}
          type="button"
          onClick={onOpenVoiceLog}
          title={voiceLogEntry.title || formatAppMessage("ui.app.aiPartnerReply.9a33fab")}
        >
          <MessageSquareText size={12} />
          <span>{voiceLogUnreadCount > 1 ? formatAppMessage("dynamic.aiPartnerReplies", { count: voiceLogUnreadCount }) : shortNotificationTitle(voiceLogEntry.title || formatAppMessage("ui.app.aiPartnerReply.9a33fab"))}</span>
        </button>
      ) : null}
      {items.map(({ notification, node }) => (
        <button
          key={notification.nodeId}
          className={`unread-notification-link is-${notification.kind}`}
          type="button"
          onClick={() => onFocus(notification.nodeId)}
          title={`${notification.title}: ${node.title || formatAppMessage("ui.app.untitled.39af82f")}`}
        >
          <Bell size={12} />
          <span>{shortNotificationTitle(node.title || notification.title)}</span>
        </button>
      ))}
    </nav>
  );
}

function isUnreadPartnerEntry(entry: VoiceLogEntry, lastSeenAt: string) {
  if (entry.role !== "assistant" && entry.role !== "error") return false;
  if (
    !entry.sessionId?.startsWith("text-partner-") &&
    !entry.sessionId?.startsWith("openclaw-partner-") &&
    !entry.sessionId?.startsWith("agent-recovery-")
  ) return false;
  if (typeof entry.metadata?.responseNodeId === "string" && entry.metadata.responseNodeId) return false;
  const entryTime = new Date(entry.createdAt).getTime();
  const seenTime = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(entryTime)) return false;
  return !Number.isFinite(seenTime) || entryTime > seenTime;
}

function voiceLogUnreadLabel(unreadCount: number, totalCount: number) {
  if (unreadCount > 0) return `${unreadCount} unread / ${totalCount} entries`;
  return `${totalCount} entries`;
}

function compactBreadcrumb(path: AtlasNode[], mobilePortrait = false) {
  const nodes = path.slice(1);
  if (mobilePortrait) {
    if (nodes.length <= 10) return nodes;
    return [...nodes.slice(0, 5), "ellipsis" as const, ...nodes.slice(-5)];
  }

  if (nodes.length <= 5) return nodes;

  const first = nodes.slice(0, 2);
  const last = nodes.slice(-3);
  return [...first, "ellipsis" as const, ...last];
}

function shortCrumb(title: string) {
  const clean = title.trim() || "Untitled";
  return clean.length > 10 ? `${clean.slice(0, 10)}...` : clean;
}

function shortNotificationTitle(title: string) {
  const clean = title.trim() || "Untitled";
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
}

function datasetFileName(name: string) {
  const baseName = name && name !== "Mind Atlas" ? name : "Spatial Notebook";
  return (
    baseName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "Untitled Atlas"
  );
}

function datasetNameFromFile(fileName: string) {
  return fileName.replace(/\.(mindatlaspkg|mindatlas|markdown|md|opml|mm)$/i, "").trim() || "Untitled Atlas";
}

function atlasNodeToOutlineInput(node: AtlasNode, forcedId?: string): OutlineNodeInput {
  return {
    id: forcedId ?? node.id,
    clientKey: forcedId ?? node.id,
    title: node.title,
    body: node.body,
    children: node.children.map((child) => atlasNodeToOutlineInput(child)),
  };
}

function markdownBodyForActiveNodeReplacement(root: AtlasNode) {
  if (root.body.trim()) return root.body.trim();
  if (root.children.length === 1 && root.children[0].body.trim()) return root.children[0].body.trim();
  if (root.children.length) return root.children.map(formatNodeAsMarkdown).join("\n\n").trim();
  return "";
}

function formatNodeAsMarkdown(node: AtlasNode, depth = 2): string {
  const heading = `${"#".repeat(Math.min(6, depth))} ${node.title}`;
  const parts = [heading, node.body.trim(), ...node.children.map((child) => formatNodeAsMarkdown(child, depth + 1))].filter(Boolean);
  return parts.join("\n\n");
}

function firstMarkdownLine(value: string) {
  return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function createMergePreviewState(current: AtlasNode, incoming: AtlasNode): MergePreviewState {
  return { root: createMergePreviewBlock(current, incoming, current.title || incoming.title || "Active node", "merge-root") };
}

function createMergePreviewBlock(current: AtlasNode | undefined, incoming: AtlasNode | undefined, path: string, key: string): MergePreviewBlock {
  const currentChildren = current?.children ?? [];
  const incomingChildren = incoming?.children ?? [];
  const maxChildren = Math.max(currentChildren.length, incomingChildren.length);
  const children = Array.from({ length: maxChildren }, (_, index) => {
    const currentChild = currentChildren[index];
    const incomingChild = incomingChildren[index];
    const title = incomingChild?.title || currentChild?.title || `Child ${index + 1}`;
    return createMergePreviewBlock(currentChild, incomingChild, `${path} / ${title}`, `${key}-${index}`);
  });
  return {
    key,
    path,
    currentTitle: current?.title ?? "",
    incomingTitle: incoming?.title ?? current?.title ?? "",
    currentBody: current?.body ?? "",
    incomingBody: incoming?.body ?? current?.body ?? "",
    choice: "incoming",
    children,
  };
}

function updateMergeChoice(block: MergePreviewBlock, key: string, choice: MergeChoice): MergePreviewBlock {
  if (block.key === key) return { ...block, choice };
  return { ...block, children: block.children.map((child) => updateMergeChoice(child, key, choice)) };
}

function mergePreviewToOutline(current: AtlasNode, preview: MergePreviewState): OutlineNodeInput {
  return mergeBlockToOutline(current, preview.root, current.id);
}

function mergeBlockToOutline(current: AtlasNode | undefined, block: MergePreviewBlock, forcedId?: string): OutlineNodeInput {
  const useIncoming = block.choice === "incoming";
  return {
    id: forcedId ?? current?.id,
    clientKey: forcedId ?? current?.id ?? block.key,
    title: useIncoming ? block.incomingTitle || block.currentTitle || "Untitled" : block.currentTitle || block.incomingTitle || "Untitled",
    body: useIncoming ? block.incomingBody : block.currentBody,
    children: block.children.map((child, index) => mergeBlockToOutline(current?.children[index], child)),
  };
}

function hasDraggedFiles(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function externalFormatLabel(format: ReturnType<typeof detectImportFormat>) {
  if (format === "opml") return "OPML";
  if (format === "freemind") return "FreeMind";
  return "Markdown";
}

function importErrorMessage(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail ? `${prefix}\n\n${detail}` : prefix;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error(formatAppMessage("error.clipboardUnavailable"));
}

function exportErrorMessage(prefix: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `${prefix}\n\n${detail}`;
}

function confirmJsonOnlyPackageFallback(atlasRoot: AtlasNode, prefix: string, error: unknown) {
  const message = formatAppMessage("dialog.packageFallback", { error: exportErrorMessage(prefix, error) });
  if (!window.confirm(message)) return null;
  return createNotebookJsonPackage(atlasRoot);
}

function showPackageResultNotice(result: NotebookPackageResult) {
  const messages: string[] = [];
  if (result.packageKind === "json") {
    messages.push(formatAppMessage("dialog.packageJsonOnly"));
  }
  if (result.missingCount > 0) {
    messages.push(formatAppMessage("dialog.packageMissingAttachments", { count: result.missingCount }));
  }
  if (messages.length) window.alert(messages.join("\n\n"));
}
