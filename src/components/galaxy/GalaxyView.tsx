import { ArrowLeft, Bot, CircleCheck, Clock, Download, Hammer, Link2, Plus, Settings, TriangleAlert, Upload, User, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { HostedServiceSession } from "../../types";
import { useMessage, useMindAtlasLocale } from "../../i18n/I18nProvider";
import type { MessageId } from "../../i18n/messages";
import { useAtlasStore } from "../../store/atlasStore";
import { judgeHash } from "../../galaxy/galaxyJudge";
import { useJudgeRuntime } from "../../galaxy/galaxyJudgeRunner";
import { formatMoney, galaxyTotals, resourceFlows, todayIso, unallocatedEntries } from "../../galaxy/galaxyRollup";
import { useGalaxyStore } from "../../galaxy/galaxyStore";
import { buildSpaceViews, type SpaceView } from "../../galaxy/galaxySummary";
import type { GalaxyFile } from "../../galaxy/galaxyTypes";
import { DECISION_COLORS, GalaxyScene } from "./GalaxyScene";
import { GalaxySettingsPanel } from "./GalaxySettingsPanel";
import { LedgerPanel } from "./LedgerPanel";
import { SpaceDetailPanel } from "./SpaceDetailPanel";
import "./galaxy.css";

interface GalaxyViewProps {
  theme: "dark" | "light";
  lowQuality: boolean;
  hostedSession: HostedServiceSession | null;
  onClose: () => void;
}

export const CONSTRAINT_ICONS = { human: User, physical: Hammer, external: Link2, ai: Bot, none: CircleCheck } as const;

export function useSpaceViews() {
  const galaxy = useGalaxyStore((state) => state.galaxy);
  const inactiveRoots = useGalaxyStore((state) => state.inactiveRoots);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  return useMemo(() => {
    if (!galaxy) return [];
    const rootOf = (spaceId: string) => (spaceId === galaxy.activeSpaceId ? atlasRoot : inactiveRoots[spaceId] ?? null);
    return buildSpaceViews(galaxy, rootOf, todayIso(), (space, root) => judgeHash(galaxy, space, root));
  }, [atlasRoot, galaxy, inactiveRoots]);
}

export function GalaxyView({ theme, lowQuality, hostedSession, onClose }: GalaxyViewProps) {
  const t = useMessage();
  const { locale } = useMindAtlasLocale();
  const status = useGalaxyStore((state) => state.status);
  const error = useGalaxyStore((state) => state.error);
  const galaxy = useGalaxyStore((state) => state.galaxy);
  const switching = useGalaxyStore((state) => state.switching);
  const init = useGalaxyStore((state) => state.init);
  const availability = useJudgeRuntime((state) => state.availability);
  const runningSpaceId = useJudgeRuntime((state) => state.runningSpaceId);
  const views = useSpaceViews();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"ledger" | "settings" | null>(null);
  const [ledgerSpaceFilter, setLedgerSpaceFilter] = useState<string | null>(null);
  const [editingPhilosophy, setEditingPhilosophy] = useState(false);
  const [notice, setNotice] = useState("");
  const importInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel) setPanel(null);
      else if (selectedId) setSelectedId(null);
      else onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, panel, selectedId]);

  const today = todayIso();
  const totals = useMemo(() => {
    if (!galaxy) return null;
    const roots = Object.fromEntries(views.map((view) => [view.space.id, view.root]));
    return galaxyTotals(galaxy, roots, today);
  }, [galaxy, today, views]);
  const flows = useMemo(() => (galaxy ? resourceFlows(galaxy, today).map((flow) => ({ ...flow, value: flow.month > 0 ? flow.month : flow.total })) : []), [galaxy, today]);
  const unallocated = useMemo(() => (galaxy ? unallocatedEntries(galaxy) : []), [galaxy]);

  if (status !== "ready" || !galaxy || !totals) {
    return (
      <div className="galaxy-overlay galaxy-overlay-message" data-theme={theme} role="dialog" aria-modal="true">
        <p>{status === "unavailable" ? t("galaxy.unavailable") : status === "error" ? t("galaxy.error", { error }) : t("galaxy.loading")}</p>
        <button type="button" className="galaxy-button" onClick={onClose}>
          <ArrowLeft size={16} /> {t("galaxy.back")}
        </button>
      </div>
    );
  }

  const money = (value: number) => formatMoney(value, galaxy.displayCurrency, locale);
  const selectedView = views.find((view) => view.space.id === selectedId) ?? null;

  const enterSpace = async (spaceId: string) => {
    try {
      if (spaceId !== galaxy.activeSpaceId) await useGalaxyStore.getState().switchSpace(spaceId);
      onClose();
    } catch (switchError) {
      setNotice(t("galaxy.switchFailed", { error: switchError instanceof Error ? switchError.message : String(switchError) }));
    }
  };

  const addSpace = async () => {
    const title = window.prompt(t("galaxy.addSpace.prompt"))?.trim();
    if (!title) return;
    const id = await useGalaxyStore.getState().createSpace(title);
    setSelectedId(id);
  };

  const exportGalaxy = () => {
    const file = useGalaxyStore.getState().exportFile();
    if (!file) return;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mind-atlas-galaxy-${today}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const importGalaxy = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as GalaxyFile;
      const result = await useGalaxyStore.getState().importFile(parsed);
      setNotice(t("galaxy.import.done", result));
    } catch (importError) {
      setNotice(t("galaxy.import.failed", { error: importError instanceof Error ? importError.message : String(importError) }));
    }
  };

  const judgeLabel = !galaxy.judge.auto
    ? t("galaxy.judge.off")
    : availability.available
      ? runningSpaceId
        ? t("galaxy.judge.running")
        : t("galaxy.judge.ready", { model: availability.model })
      : t(`galaxy.settings.status.${availability.reason}` as MessageId);

  const renderLabel = (view: SpaceView) => (
    <SpaceLabel
      t={t}
      view={view}
      theme={theme}
      selected={view.space.id === selectedId}
      money={money}
      onSelect={() => setSelectedId(view.space.id)}
      onEnter={() => void enterSpace(view.space.id)}
    />
  );

  const coreLabel = (
    <button type="button" className={`galaxy-core-label ${theme}`} onClick={() => setEditingPhilosophy(true)} title={t("galaxy.philosophy.edit")}>
      <small>{t("galaxy.philosophy")}</small>
      <span>{galaxy.philosophy.trim() ? shorten(galaxy.philosophy, 64) : t("galaxy.philosophy.empty")}</span>
    </button>
  );

  return (
    <div className="galaxy-overlay" data-theme={theme} role="dialog" aria-modal="true" aria-label={t("galaxy.open")}>
      <GalaxyScene
        views={views}
        resources={galaxy.resources}
        flows={flows}
        selectedId={selectedId}
        theme={theme}
        lowQuality={lowQuality}
        onSelect={setSelectedId}
        onEnter={(spaceId) => void enterSpace(spaceId)}
        renderLabel={renderLabel}
        coreLabel={coreLabel}
      />

      <header className="galaxy-top">
        <button type="button" className="galaxy-button" onClick={onClose}>
          <ArrowLeft size={16} /> {t("galaxy.back")}
        </button>
        <div className="galaxy-stats" aria-label={t("galaxy.stats.month")}>
          <span>
            <small>{t("galaxy.stats.month")}</small>
            <b className="is-negative">−{money(totals.monthExpense + totals.aiCostMonth)}</b>
            <b className="is-positive">+{money(totals.monthIncome)}</b>
          </span>
          <span>
            <small>{t("galaxy.stats.net")}</small>
            <b className={totals.net < 0 ? "is-negative" : "is-positive"}>{signed(money, totals.net)}</b>
          </span>
          <span>
            <small>{t("galaxy.stats.ai")}</small>
            <b>{money(totals.aiCost)}</b>
          </span>
          {unallocated.length ? (
            <button
              type="button"
              className="galaxy-warning-chip"
              onClick={() => {
                setLedgerSpaceFilter(null);
                setPanel("ledger");
              }}
            >
              <TriangleAlert size={14} /> {t("galaxy.stats.unallocated", { count: unallocated.length })}
            </button>
          ) : null}
        </div>
        <div className="galaxy-actions">
          <button type="button" className="galaxy-chip-button" onClick={() => setPanel(panel === "settings" ? null : "settings")} title={t("galaxy.settings")}>
            <Clock size={14} /> {judgeLabel}
          </button>
          <button type="button" className="galaxy-icon-button" onClick={() => void addSpace()} title={t("galaxy.addSpace")} aria-label={t("galaxy.addSpace")}>
            <Plus size={18} />
          </button>
          <button
            type="button"
            className="galaxy-icon-button"
            onClick={() => {
              setLedgerSpaceFilter(null);
              setPanel(panel === "ledger" ? null : "ledger");
            }}
            title={t("galaxy.ledger")}
            aria-label={t("galaxy.ledger")}
          >
            <Wallet size={18} />
          </button>
          <button type="button" className="galaxy-icon-button" onClick={exportGalaxy} title={t("galaxy.export")} aria-label={t("galaxy.export")}>
            <Download size={18} />
          </button>
          <button type="button" className="galaxy-icon-button" onClick={() => importInput.current?.click()} title={t("galaxy.import")} aria-label={t("galaxy.import")}>
            <Upload size={18} />
          </button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importGalaxy(event)} />
          <button type="button" className="galaxy-icon-button" onClick={() => setPanel(panel === "settings" ? null : "settings")} title={t("galaxy.settings")} aria-label={t("galaxy.settings")}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      {editingPhilosophy ? (
        <PhilosophyEditor
          text={galaxy.philosophy}
          historyCount={galaxy.philosophyHistory.length}
          onSave={(text) => {
            useGalaxyStore.getState().setPhilosophy(text.trim());
            setEditingPhilosophy(false);
          }}
          onCancel={() => setEditingPhilosophy(false)}
        />
      ) : null}

      {selectedView ? (
        <SpaceDetailPanel
          view={selectedView}
          views={views}
          galaxy={galaxy}
          onClose={() => setSelectedId(null)}
          onEnter={() => void enterSpace(selectedView.space.id)}
          onOpenLedger={() => {
            setLedgerSpaceFilter(selectedView.space.id);
            setPanel("ledger");
          }}
        />
      ) : null}

      {panel === "ledger" ? (
        <LedgerPanel
          galaxy={galaxy}
          views={views}
          spaceFilter={ledgerSpaceFilter}
          onClearFilter={() => setLedgerSpaceFilter(null)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === "settings" ? <GalaxySettingsPanel galaxy={galaxy} onClose={() => setPanel(null)} /> : null}

      {switching || notice ? (
        <div className="galaxy-notice" role="status" aria-live="polite">
          <span>{switching ? t("galaxy.switching") : notice}</span>
          {!switching ? (
            <button type="button" onClick={() => setNotice("")} aria-label={t("common.close")}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Rendered inside the 3D canvas through drei's Html, which mounts a separate
// React root: the react-intl context is not available there, so the caller
// passes its translate function in.
function SpaceLabel({
  t,
  view,
  theme,
  selected,
  money,
  onSelect,
  onEnter,
}: {
  t: ReturnType<typeof useMessage>;
  view: SpaceView;
  theme: "dark" | "light";
  selected: boolean;
  money: (value: number) => string;
  onSelect: () => void;
  onEnter: () => void;
}) {
  const demandLevels = 4;
  const ConstraintIcon = view.constraint && view.constraint in CONSTRAINT_ICONS ? CONSTRAINT_ICONS[view.constraint as keyof typeof CONSTRAINT_ICONS] : null;
  const net = view.money.net;
  const decision = view.shownDecision;
  return (
    <button
      type="button"
      className={`galaxy-space-label ${theme} ${selected ? "is-selected" : ""} ${view.active ? "is-active" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEnter();
      }}
    >
      <strong>{view.space.title || "—"}</strong>
      <span className="galaxy-signals">
        <span className="galaxy-signal demand" title={`${t("galaxy.signal.demand")}: ${view.demand === null ? t("galaxy.signal.unjudged") : t(`galaxy.demand.${view.demand}` as MessageId)}`}>
          {view.demand === null
            ? "?"
            : Array.from({ length: demandLevels - 1 }, (_, index) => <i key={index} className={index < (view.demand ?? 0) ? "on" : ""} />)}
        </span>
        <span className={`galaxy-signal money ${net < 0 ? "is-negative" : net > 0 ? "is-positive" : ""}`} title={t("galaxy.signal.money")}>
          {net === 0 ? "±0" : signed(money, net)}
        </span>
        <span className="galaxy-signal constraint" title={`${t("galaxy.signal.constraint")}: ${view.constraint ? t(`galaxy.constraint.${view.constraint}` as MessageId) : t("galaxy.signal.unjudged")}`}>
          {ConstraintIcon ? <ConstraintIcon size={12} /> : "?"}
          {view.signals.staleDays >= 14 ? <em>{t("galaxy.signal.stale", { days: view.signals.staleDays })}</em> : null}
        </span>
        <span
          className={`galaxy-signal decision ${decision.proposed ? "is-proposed" : ""}`}
          style={{ borderColor: DECISION_COLORS[decision.value], color: DECISION_COLORS[decision.value] }}
          title={t("galaxy.signal.decision")}
        >
          {decision.proposed ? `${t("galaxy.signal.proposed")}: ` : ""}
          {t(`galaxy.decision.${decision.value}` as MessageId)}
        </span>
      </span>
    </button>
  );
}

function PhilosophyEditor({ text, historyCount, onSave, onCancel }: { text: string; historyCount: number; onSave: (text: string) => void; onCancel: () => void }) {
  const t = useMessage();
  const [draft, setDraft] = useState(text);
  return (
    <div className="galaxy-philosophy-editor" role="dialog" aria-label={t("galaxy.philosophy.edit")}>
      <label>
        <span>{t("galaxy.philosophy")}</span>
        <textarea value={draft} autoFocus rows={5} onChange={(event) => setDraft(event.target.value)} placeholder={t("galaxy.philosophy.empty")} />
      </label>
      {historyCount ? <small>{t("galaxy.philosophy.history", { count: historyCount })}</small> : null}
      <div className="galaxy-row-actions">
        <button type="button" className="galaxy-button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className="galaxy-button is-primary" onClick={() => onSave(draft)}>
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

export function signed(money: (value: number) => string, value: number) {
  if (value < 0) return `−${money(-value)}`;
  return `+${money(value)}`;
}

function shorten(text: string, limit: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}
