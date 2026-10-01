import { ArrowLeft, Bot, CircleCheck, Clock, Download, Hammer, Link2, Plus, Settings, TriangleAlert, Upload, User, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { HostedServiceSession } from "../../types";
import { useMessage, useMindAtlasLocale } from "../../i18n/I18nProvider";
import type { MessageId } from "../../i18n/messages";
import { useAtlasStore } from "../../store/atlasStore";
import { useJudgeRuntime } from "../../galaxy/galaxyJudgeRunner";
import { formatMoney, galaxyTotals, todayIso, unallocatedEntries } from "../../galaxy/galaxyRollup";
import { useGalaxyStore } from "../../galaxy/galaxyStore";
import { useSpaceViews } from "../../galaxy/useKnowledgeIndex";
import type { GalaxyFile } from "../../galaxy/galaxyTypes";
import { KnowledgePanel } from './KnowledgePanel';
import { useKnowledgeRuntime, closeKnowledge } from '../../galaxy/knowledgeRuntime';
import { GalaxySettingsPanel } from "./GalaxySettingsPanel";
import { LedgerPanel } from "./LedgerPanel";
import { SpaceDetailPanel } from "./SpaceDetailPanel";
import "./galaxy.css";
import './knowledge.css';

interface GalaxyViewProps {
  theme: "dark" | "light";
  lowQuality: boolean;
  hostedSession: HostedServiceSession | null;
  onClose: () => void;
}

export const CONSTRAINT_ICONS = { human: User, physical: Hammer, external: Link2, ai: Bot, none: CircleCheck } as const;

export function GalaxyView({ theme, onClose: finishClose }: GalaxyViewProps) {
  const onClose = () => closeKnowledge(finishClose);
  useEffect(() => {
    useKnowledgeRuntime.setState({ open: true, exiting: false, selected: null, anchor: null, hovered: null, hoveredRelation: null, relation: null, enterKey: null, focus: null });
    return () => { useKnowledgeRuntime.setState({ open: false, exiting: false, exit: null, labelLayer: null, hovered: null, hoveredRelation: null }); };
  }, []);
  const t = useMessage();
  const { locale } = useMindAtlasLocale();
  const exiting = useKnowledgeRuntime((state) => state.exiting);
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
      else if (useKnowledgeRuntime.getState().selected) useKnowledgeRuntime.setState({selected:null,anchor:null,relation:null});
      else if (useKnowledgeRuntime.getState().query) useKnowledgeRuntime.setState({query:''});
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

  const enterSpace = async (spaceId: string, nodeId?: string) => {
    try {
      if (spaceId !== galaxy.activeSpaceId) await useGalaxyStore.getState().switchSpace(spaceId);
      const target = useKnowledgeRuntime.getState().graph.nodes.find(n => n.spaceId === spaceId && (nodeId ? n.node.id === nodeId : n.depth === 0));
      useKnowledgeRuntime.setState({ enterKey: target?.key ?? null });
      closeKnowledge(() => {
        finishClose();
        if (nodeId) window.setTimeout(() => useAtlasStore.getState().focusNode(nodeId), 50);
      });
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

  return (
    <div className={`galaxy-overlay knowledge-overlay${exiting ? " is-exiting" : ""}`} data-theme="dark" role="dialog" aria-modal="true" aria-label={t("galaxy.open")}>
      <div className="knowledge-label-layer" ref={(element) => { if (useKnowledgeRuntime.getState().labelLayer !== element) useKnowledgeRuntime.setState({ labelLayer: element }); }} />
      <KnowledgePanel views={views} onEnter={(spaceId, nodeId) => void enterSpace(spaceId, nodeId)} onManagement={setSelectedId} />

      <header className="galaxy-top" data-kg-chrome>
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
          <button type="button" className="galaxy-chip-button" onClick={() => setEditingPhilosophy(true)}>{t('galaxy.philosophy')}</button>
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
