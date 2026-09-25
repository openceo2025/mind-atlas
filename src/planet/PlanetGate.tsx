/**
 * PlanetGate — diving from Mind Atlas (Space) into a node's Mind Atlas (Cards)
 * space, and rising back out.
 *
 * Hold a node for HOLD_MS and the dive starts: on "high" rendering the universe
 * rushes toward the planet and whites out while the card app loads behind the
 * white, then the white lifts over the cards. Letting go (or moving) during the
 * first half of the whole effect cancels it. On "low" the view switches the
 * moment the card space is ready, with no effect at all.
 *
 * The card app is its own build, served under /card/ and mounted here in a
 * same-origin iframe that stays alive between visits, so later dives are
 * instant. The two talk through `cardBridge`.
 *
 * Mode: hosted-only. App mounts this only in public service mode; local
 * developer mode never gets a card space.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAtlasStore, findNodeByCardPlanet } from "../store/atlasStore";
import { formatAppMessage } from "../i18n/format";
import type { AtlasTheme } from "../theme";
import {
  CARD_APP_BASE_PATH,
  CARD_EMBED_PARAM,
  CARD_EMBED_VALUE,
  postPlanetMessage,
  readPlanetMessage,
  takeDueReminders,
  type CardToUniverseMessage,
  type PlanetAnchor,
  type UniverseToCardMessage,
} from "./cardBridge";
import { endPlanetHold, markPlanetHoldSpent, onPlanetHold, setPlanetEntryEnabled, type PlanetHoldStart } from "./planetHold";
import "./planetGate.css";

/** Hold this long on a node before the dive starts. */
const HOLD_MS = 1000;
/** Universe rushes toward the planet and whites out. */
const DIVE_MS = 600;
/** White lifts over the card space. */
const REVEAL_MS = 300;
/** Releasing before half of the whole effect cancels the dive. */
const CANCEL_WINDOW_MS = (DIVE_MS + REVEAL_MS) / 2;
const CANCEL_BACK_MS = 220;
/** Rising: the card space whites out, then the universe pulls back into view. */
const RISE_WHITE_MS = 250;
const RISE_MS = 600;
/** Start fetching the card app this long into a press. */
const PRELOAD_AFTER_MS = 250;
/** Show "Landing…" when the white has to wait longer than this. */
const LANDING_HINT_AFTER_MS = 900;
const LOAD_TIMEOUT_MS = 20000;
const REMINDER_TICK_MS = 15000;
const MOVE_TOLERANCE_PX: Record<string, number> = { mouse: 6, pen: 8, touch: 12 };

type Phase = "idle" | "holding" | "diving" | "cancelling" | "white" | "revealing" | "card" | "leaving" | "rising";

interface GateState {
  phase: Phase;
  hold?: PlanetHoldStart & { startedAt: number };
  planet?: PlanetAnchor;
  /** The card app said the requested planet is on screen. */
  opened: boolean;
  committed: boolean;
  animStartedAt: number;
  x: number;
  y: number;
  /** We pushed a history entry for the card view (browser Back rises). */
  pushedHistory: boolean;
  /** An ascend we started ourselves, so the popstate it causes is ignored. */
  ignoreNextPop: boolean;
}

function easeInCubic(t: number) {
  return t * t * t;
}
function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function cardFrameUrl(locale: string) {
  const params = new URLSearchParams({ [CARD_EMBED_PARAM]: CARD_EMBED_VALUE, locale });
  return `${CARD_APP_BASE_PATH}?${params.toString()}`;
}

export function PlanetGate({
  enabled,
  highQuality,
  theme,
  locale,
  onCardViewChange,
}: {
  enabled: boolean;
  highQuality: boolean;
  theme: AtlasTheme;
  locale: string;
  onCardViewChange: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [frameMounted, setFrameMounted] = useState(false);
  const [holdPoint, setHoldPoint] = useState<{ x: number; y: number; key: number } | null>(null);
  const [landingHint, setLandingHint] = useState(false);
  const [failure, setFailure] = useState("");
  /** Mirrors gate.committed for rendering: the frame is laid out once the dive is certain. */
  const [staged, setStaged] = useState(false);
  const gate = useRef<GateState>({ phase: "idle", opened: false, committed: false, animStartedAt: 0, x: 0, y: 0, pushedHistory: false, ignoreNextPop: false });
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const frameReady = useRef(false);
  /** Fixed at first mount: later language changes are sent as messages, not reloads. */
  const frameSrc = useRef<string | null>(null);
  const pending = useRef<UniverseToCardMessage | null>(null);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);
  const detachPointer = useRef<(() => void) | null>(null);
  const settings = useRef({ highQuality, theme, locale, onCardViewChange });
  settings.current = { highQuality, theme, locale, onCardViewChange };

  const effectsOn = () => settings.current.highQuality && !prefersReducedMotion();

  const setGatePhase = useCallback((next: Phase) => {
    gate.current.phase = next;
    setPhase(next);
  }, []);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // ── Rendering the effect ────────────────────────────────────────────────
  /** p: how far into the planet (0..1), w: whiteout (0..1). */
  const paint = (p: number, w: number) => {
    const { x, y } = gate.current;
    const e = easeInCubic(Math.min(1, Math.max(0, p)));
    const shell = document.querySelector<HTMLElement>(".universe-shell");
    if (shell) {
      if (p <= 0) {
        shell.style.transform = "";
        shell.style.transformOrigin = "";
        shell.style.filter = "";
      } else {
        shell.style.transformOrigin = `${x}px ${y}px`;
        shell.style.transform = `scale(${1 + e * 5})`;
        shell.style.filter = `blur(${(e * 7).toFixed(2)}px) brightness(${(1 + e * 0.9).toFixed(3)})`;
      }
    }
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.setProperty("--planet-x", `${x}px`);
      overlay.style.setProperty("--planet-y", `${y}px`);
      overlay.style.setProperty("--planet-e", e.toFixed(4));
      overlay.style.setProperty("--planet-r", `${(40 + e * 2200).toFixed(1)}px`);
      overlay.style.setProperty("--planet-streak", (Math.sin(Math.PI * Math.min(1, p)) * 0.85).toFixed(3));
      overlay.style.setProperty("--planet-white", w.toFixed(4));
    }
  };

  const fallbackTimer = useRef(0);
  const stopAnimation = () => {
    window.cancelAnimationFrame(raf.current);
    window.clearTimeout(fallbackTimer.current);
    raf.current = 0;
    fallbackTimer.current = 0;
  };

  const animate = (duration: number, step: (t: number) => void, done?: () => void) => {
    stopAnimation();
    const started = performance.now();
    gate.current.animStartedAt = started;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stopAnimation();
      step(1);
      done?.();
    };
    const tick = () => {
      const t = Math.min(1, (performance.now() - started) / duration);
      if (t >= 1) {
        finish();
        return;
      }
      step(t);
      raf.current = window.requestAnimationFrame(tick);
    };
    raf.current = window.requestAnimationFrame(tick);
    // A hidden tab stops requestAnimationFrame; never leave the gate stuck mid-effect.
    fallbackTimer.current = window.setTimeout(finish, duration + 250);
  };

  // ── The card frame ──────────────────────────────────────────────────────
  const send = useCallback((message: UniverseToCardMessage) => {
    const target = frameRef.current?.contentWindow;
    if (!target || !frameReady.current) {
      // Only the latest open-planet matters; settings ride along with it.
      if (message.type === "open-planet" || !pending.current) pending.current = message;
      return;
    }
    postPlanetMessage(target, message);
  }, []);

  const ensureFrame = useCallback(() => setFrameMounted(true), []);

  // ── Hold → dive → card ──────────────────────────────────────────────────
  const releasePointerWatch = () => {
    detachPointer.current?.();
    detachPointer.current = null;
  };

  const resetToIdle = useCallback(() => {
    stopAnimation();
    clearTimers();
    releasePointerWatch();
    if (gate.current.hold) endPlanetHold(gate.current.hold.pointerId);
    gate.current.hold = undefined;
    gate.current.committed = false;
    gate.current.opened = false;
    setStaged(false);
    paint(0, 0);
    setHoldPoint(null);
    setLandingHint(false);
    setGatePhase("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGatePhase]);

  const showCard = () => {
    const g = gate.current;
    clearTimers();
    setLandingHint(false);
    settings.current.onCardViewChange(true);
    if (!g.pushedHistory) {
      try {
        window.history.pushState({ ...(window.history.state ?? {}), mindAtlasPlanet: g.planet?.planetId }, "", window.location.href);
        g.pushedHistory = true;
      } catch {
        g.pushedHistory = false;
      }
    }
    const finish = () => {
      paint(0, 0);
      setGatePhase("card");
      window.setTimeout(() => frameRef.current?.focus(), 0);
    };
    if (!effectsOn()) {
      finish();
      return;
    }
    setGatePhase("revealing");
    animate(REVEAL_MS, (t) => paint(0, 1 - easeOutCubic(t)), finish);
  };

  const fail = (message?: string) => {
    setFailure(message || formatAppMessage("planet.failed"));
    window.setTimeout(() => setFailure(""), 4200);
    if (effectsOn() && gate.current.phase !== "idle") {
      setGatePhase("rising");
      const from = gate.current.phase === "white" ? 1 : 0.6;
      animate(RISE_MS, (t) => paint(1 - easeOutCubic(t), from * (1 - smoothstep(0, 0.7, t))), resetToIdle);
    } else {
      resetToIdle();
    }
  };

  /** Past the point of no return: tell the card app which planet to open. */
  const commit = () => {
    const g = gate.current;
    if (g.committed || !g.hold) return;
    const store = useAtlasStore.getState();
    const nodeId = g.hold.nodeId;
    const planetId = store.assignCardPlanet(nodeId);
    const node = planetId ? findNodeByCardPlanet(useAtlasStore.getState().atlasRoot, planetId) : null;
    if (!planetId || !node) {
      fail();
      return;
    }
    g.committed = true;
    g.opened = false;
    setStaged(true);
    g.planet = { planetId, nodeId: node.id, nodeTitle: node.title || "" };
    // Diving in is how you look at a card reminder's ripple.
    if (store.unreadNotifications[node.id]?.signature?.startsWith("card-reminder:")) store.acknowledgeNodeNotification(node.id);
    ensureFrame();
    send({ type: "open-planet", planet: g.planet, locale: settings.current.locale, theme: settings.current.theme });
    later(LANDING_HINT_AFTER_MS + (effectsOn() ? DIVE_MS : 0), () => setLandingHint(true));
    later(LOAD_TIMEOUT_MS, () => {
      if (!gate.current.opened) fail();
    });
  };

  const cancelDive = () => {
    const g = gate.current;
    if (g.phase !== "diving" || g.committed) return;
    releasePointerWatch();
    const elapsed = performance.now() - g.animStartedAt;
    const from = Math.min(1, elapsed / DIVE_MS);
    setGatePhase("cancelling");
    animate(CANCEL_BACK_MS, (t) => {
      const p = from * (1 - easeOutCubic(t));
      paint(p, smoothstep(0.55, 1, p));
    }, resetToIdle);
  };

  const startDive = () => {
    const g = gate.current;
    if (g.phase !== "holding" || !g.hold) return;
    markPlanetHoldSpent(g.hold.pointerId);
    setHoldPoint(null);
    if (!effectsOn()) {
      // Low quality: no effect. The view switches as soon as the card space is ready.
      releasePointerWatch();
      setGatePhase("white");
      commit();
      return;
    }
    setGatePhase("diving");
    // The point of no return is kept by the clock, not by animation frames.
    later(CANCEL_WINDOW_MS, () => {
      if (gate.current.phase !== "diving" || gate.current.committed) return;
      releasePointerWatch();
      commit();
    });
    animate(
      DIVE_MS,
      (t) => paint(t, smoothstep(0.55, 1, t)),
      () => {
        if (!gate.current.committed) commit();
        if (gate.current.phase === "idle" || gate.current.phase === "rising") return;
        setGatePhase("white");
        if (gate.current.opened) showCard();
      },
    );
  };

  const beginHold = useCallback(
    (start: PlanetHoldStart) => {
      const g = gate.current;
      if (g.phase !== "idle") return;
      const root = useAtlasStore.getState().atlasRoot;
      if (start.nodeId === root.id) return;
      g.hold = { ...start, startedAt: performance.now() };
      g.x = start.x;
      g.y = start.y;
      g.committed = false;
      g.opened = false;
      setGatePhase("holding");
      setHoldPoint({ x: start.x, y: start.y, key: Date.now() });
      const tolerance = MOVE_TOLERANCE_PX[start.pointerType] ?? 8;
      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== start.pointerId) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= tolerance) return;
        // Moving counts as letting go.
        if (gate.current.phase === "holding") resetToIdle();
        else cancelDive();
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== start.pointerId) return;
        if (gate.current.phase === "holding") resetToIdle();
        else cancelDive();
      };
      const onOtherPointer = (event: PointerEvent) => {
        if (event.pointerId === start.pointerId) return;
        if (gate.current.phase === "holding") resetToIdle();
        else cancelDive();
      };
      const onBlur = () => {
        if (gate.current.phase === "holding") resetToIdle();
        else cancelDive();
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      window.addEventListener("pointerdown", onOtherPointer, true);
      window.addEventListener("blur", onBlur);
      detachPointer.current = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        window.removeEventListener("pointerdown", onOtherPointer, true);
        window.removeEventListener("blur", onBlur);
      };
      later(PRELOAD_AFTER_MS, ensureFrame);
      later(HOLD_MS, startDive);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureFrame, resetToIdle, setGatePhase],
  );

  const enterDirect = useCallback(
    (nodeId: string) => {
      const g = gate.current;
      if (g.phase !== "idle") return;
      if (nodeId === useAtlasStore.getState().atlasRoot.id) return;
      const shell = document.querySelector<HTMLElement>(".universe-shell")?.getBoundingClientRect();
      const x = shell ? shell.left + shell.width / 2 : window.innerWidth / 2;
      const y = shell ? shell.top + shell.height / 2 : window.innerHeight / 2;
      g.hold = { nodeId, pointerId: -1, pointerType: "button", x, y, startedAt: performance.now() };
      g.x = x;
      g.y = y;
      g.committed = false;
      g.opened = false;
      setGatePhase("holding");
      startDive();
      // Nothing to let go of: there is no cancel window.
      commit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setGatePhase],
  );

  // ── Rising back to the universe ─────────────────────────────────────────
  const ascend = useCallback(
    (planetId?: string, fromPopState = false) => {
      const g = gate.current;
      if (g.phase !== "card") return;
      if (g.pushedHistory) {
        g.pushedHistory = false;
        if (!fromPopState) {
          g.ignoreNextPop = true;
          window.history.back();
        }
      }
      const store = useAtlasStore.getState();
      const node = findNodeByCardPlanet(store.atlasRoot, planetId ?? g.planet?.planetId ?? "");
      settings.current.onCardViewChange(false);
      if (node) store.focusNode(node.id);
      g.x = window.innerWidth / 2;
      g.y = window.innerHeight / 2;
      const land = () => {
        g.planet = undefined;
        resetToIdle();
      };
      if (!effectsOn()) {
        land();
        return;
      }
      setGatePhase("leaving");
      paint(0, 0);
      animate(RISE_WHITE_MS, (t) => paint(0, easeOutCubic(t)), () => {
        setGatePhase("rising");
        animate(RISE_MS, (t) => paint(1 - easeOutCubic(t), 1 - smoothstep(0, 0.65, t)), land);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resetToIdle, setGatePhase],
  );

  // ── Wiring ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setPlanetEntryEnabled(enabled);
    onPlanetHold(enabled ? beginHold : null, enabled ? enterDirect : null);
    if (!enabled && gate.current.phase === "holding") resetToIdle();
    return () => {
      onPlanetHold(null);
      setPlanetEntryEnabled(false);
    };
  }, [beginHold, enabled, enterDirect, resetToIdle]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readPlanetMessage<CardToUniverseMessage>(event, frameRef.current?.contentWindow ?? null);
      if (!message) return;
      const g = gate.current;
      if (message.type === "card-ready") {
        frameReady.current = true;
        const queued = pending.current;
        pending.current = null;
        if (queued && frameRef.current?.contentWindow) postPlanetMessage(frameRef.current.contentWindow, queued);
        return;
      }
      if (message.type === "planet-opened") {
        if (!g.planet || message.planetId !== g.planet.planetId || !g.committed || g.opened) return;
        g.opened = true;
        if (g.phase === "white") showCard();
        return;
      }
      if (message.type === "planet-failed") {
        if (g.planet && message.planetId === g.planet.planetId && !g.opened) fail(message.message);
        return;
      }
      if (message.type === "ascend") {
        ascend(message.planetId);
        return;
      }
      if (message.type === "reminders-fired") {
        useAtlasStore.getState().receiveCardReminders(message.entries);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ascend]);

  // Browser Back from the card view rises to the universe.
  useEffect(() => {
    const onPopState = () => {
      const g = gate.current;
      if (g.ignoreNextPop) {
        g.ignoreNextPop = false;
        return;
      }
      if (g.phase === "card" && g.pushedHistory) {
        g.pushedHistory = false;
        ascend(undefined, true);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [ascend]);

  // Language and background follow the universe.
  useEffect(() => {
    if (frameMounted) send({ type: "settings", locale, theme });
  }, [frameMounted, locale, send, theme]);

  // Card reminders: this device's index is watched here, whether or not the
  // card app is loaded, and each due reminder ripples from its planet's node.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const due = takeDueReminders();
      if (!due.length) return;
      useAtlasStore.getState().receiveCardReminders(due);
      if (gate.current.phase === "card") send({ type: "reminders-fired", entries: due });
    };
    tick();
    const timer = window.setInterval(tick, REMINDER_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, send]);

  useEffect(
    () => () => {
      stopAnimation();
      clearTimers();
      releasePointerWatch();
      paint(0, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!enabled && !frameMounted) return null;

  const frameClass =
    phase === "card" || phase === "revealing" || phase === "leaving"
      ? "is-shown"
      : staged && (phase === "white" || phase === "diving")
        ? "is-staged"
        : "is-parked";
  const overlayActive = phase === "diving" || phase === "cancelling" || phase === "white" || phase === "revealing" || phase === "leaving" || phase === "rising";

  return (
    <>
      {holdPoint && phase === "holding" ? (
        <div className="planet-hold" key={holdPoint.key} style={{ left: holdPoint.x, top: holdPoint.y }} aria-hidden="true">
          <svg viewBox="0 0 64 64" className="planet-hold-ring">
            <circle cx="32" cy="32" r="27" className="planet-hold-track" />
            <circle cx="32" cy="32" r="27" className="planet-hold-fill" style={{ animationDuration: `${HOLD_MS}ms` }} />
          </svg>
          <span className="planet-hold-hint">{formatAppMessage("planet.holdHint")}</span>
        </div>
      ) : null}
      <div ref={overlayRef} className={`planet-gate-overlay ${overlayActive && effectsOn() ? "is-active" : ""}`} aria-hidden="true">
        <div className="planet-gate-glow" />
        <div className="planet-gate-streaks" />
        <div className="planet-gate-white" />
      </div>
      {landingHint && (phase === "white" || phase === "diving") ? (
        <div className={`planet-gate-landing ${effectsOn() ? "" : "is-plain"}`} role="status">
          {formatAppMessage("planet.landing")}
        </div>
      ) : null}
      {failure ? (
        <div className="planet-gate-failure" role="alert">
          {failure}
        </div>
      ) : null}
      {frameMounted ? (
        <div className={`planet-gate-frame ${frameClass}`} data-theme={theme}>
          <iframe
            ref={frameRef}
            src={frameSrc.current ?? (frameSrc.current = cardFrameUrl(locale))}
            title={formatAppMessage("planet.frameTitle")}
            allow="microphone; clipboard-read; clipboard-write"
          />
        </div>
      ) : null}
    </>
  );
}
