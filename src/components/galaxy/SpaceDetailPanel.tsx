import { LogIn, Pencil, RefreshCw, Trash2, Wallet, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useMessage, useMindAtlasLocale } from "../../i18n/I18nProvider";
import type { MessageId } from "../../i18n/messages";
import { DEMAND_LEVELS, QUALITY_LEVELS } from "../../galaxy/galaxyJudge";
import { runJudge, useJudgeRuntime } from "../../galaxy/galaxyJudgeRunner";
import { formatMoney, resourceFlows, todayIso } from "../../galaxy/galaxyRollup";
import { useGalaxyStore } from "../../galaxy/galaxyStore";
import type { SpaceView } from "../../galaxy/galaxySummary";
import type { GalaxyState, JudgedAnswer, SpaceDecision, SpaceRole } from "../../galaxy/galaxyTypes";
import { DECISION_COLORS } from "./GalaxyScene";
import { CONSTRAINT_ICONS } from "./GalaxyView";

const ROLES: SpaceRole[] = ["run", "grow", "transform", "foundation"];
const JUDGED_PREFIX: Record<"stage" | "uncertainty" | "constraint", string> = {
  stage: "galaxy.stage",
  uncertainty: "galaxy.uncertainty",
  constraint: "galaxy.constraint",
};
const DECISIONS: SpaceDecision[] = ["undecided", "continue", "hold", "recycle", "stop"];

interface SpaceDetailPanelProps {
  view: SpaceView;
  views: SpaceView[];
  galaxy: GalaxyState;
  onClose: () => void;
  onEnter: () => void;
  onOpenLedger: () => void;
}

export function SpaceDetailPanel({ view, views, galaxy, onClose, onEnter, onOpenLedger }: SpaceDetailPanelProps) {
  const t = useMessage();
  const { locale } = useMindAtlasLocale();
  const store = useGalaxyStore.getState();
  const runningSpaceId = useJudgeRuntime((state) => state.runningSpaceId);
  const availability = useJudgeRuntime((state) => state.availability);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(view.space.title);
  const { space, judgment, signals } = view;
  const money = (value: number) => formatMoney(value, galaxy.displayCurrency, locale);
  const answers = judgment?.answers ?? {};
  const today = todayIso();
  const flows = resourceFlows(galaxy, today).filter((flow) => flow.spaceId === space.id);
  const killOverdue = Boolean(space.killCriterion?.date && space.killCriterion.date < today && space.decision !== "stop");
  const judging = runningSpaceId === space.id;

  const judgedText = (key: "stage" | "uncertainty" | "constraint") => {
    const answer = answers[key];
    if (!answer) return <span className="galaxy-muted">{t("galaxy.signal.unjudged")}</span>;
    return (
      <>
        <b>{t(`${JUDGED_PREFIX[key]}.${answer.value}` as MessageId)}</b>
        <Confidence answer={answer} />
      </>
    );
  };

  return (
    <aside className="galaxy-panel galaxy-detail" aria-label={space.title}>
      <header className="galaxy-panel-header">
        <span className="galaxy-dot" style={{ background: space.color }} />
        {renaming ? (
          <form
            className="galaxy-rename"
            onSubmit={(event) => {
              event.preventDefault();
              if (titleDraft.trim()) store.updateSpace(space.id, { title: titleDraft.trim() });
              setRenaming(false);
            }}
          >
            <input value={titleDraft} autoFocus onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => setRenaming(false)} />
          </form>
        ) : (
          <h2>
            {space.title}
            <button type="button" className="galaxy-inline-icon" onClick={() => setRenaming(true)} aria-label={t("galaxy.rename")} title={t("galaxy.rename")}>
              <Pencil size={13} />
            </button>
          </h2>
        )}
        <button type="button" className="galaxy-icon-button" onClick={onClose} aria-label={t("common.close")}>
          <X size={18} />
        </button>
      </header>

      <div className="galaxy-detail-actions">
        <button type="button" className="galaxy-button is-primary" onClick={onEnter}>
          <LogIn size={15} /> {t("galaxy.enter")}
        </button>
        <button type="button" className="galaxy-button" disabled={!availability.available || Boolean(runningSpaceId)} onClick={() => void runJudge(space.id)}>
          <RefreshCw size={15} className={judging ? "is-spinning" : ""} /> {judging ? t("galaxy.judge.running") : t("galaxy.judgeNow")}
        </button>
        <button type="button" className="galaxy-button" onClick={onOpenLedger}>
          <Wallet size={15} /> {t("galaxy.ledger")}
        </button>
      </div>
      {judgment ? (
        <p className="galaxy-judge-meta">
          {t("galaxy.judge.meta", { model: judgment.model, time: new Date(judgment.judgedAt).toLocaleString(locale) })}
          {view.judgmentStale ? <em> · {t("galaxy.judge.stale")}</em> : null}
          {judgment.error ? <em className="is-negative"> · {t("galaxy.judge.error", { error: judgment.error })}</em> : null}
        </p>
      ) : null}

      <Group title={t("galaxy.group.why")}>
        <Item label={t("galaxy.item.purpose")}>
          {view.purpose ? <p className="galaxy-purpose">{view.purpose}</p> : <span className="galaxy-muted">{t("galaxy.purpose.empty")}</span>}
        </Item>
        <Item label={t("galaxy.item.role")}>
          <Segmented
            options={ROLES.map((role) => ({ value: role, label: t(`galaxy.role.${role}` as MessageId) }))}
            value={space.role ?? null}
            onChange={(role) => store.updateSpace(space.id, { role: role as SpaceRole })}
          />
        </Item>
      </Group>

      <Group title={t("galaxy.group.where")}>
        <Item label={t("galaxy.item.stage")}>{judgedText("stage")}</Item>
        <Item label={t("galaxy.item.quality")}>
          <LevelBar value={view.quality} levels={QUALITY_LEVELS} labelOf={(level) => t(`galaxy.quality.${level}` as MessageId)} answer={answers.quality} />
        </Item>
        <Item label={t("galaxy.item.demand")}>
          <LevelBar value={view.demand} levels={DEMAND_LEVELS} labelOf={(level) => t(`galaxy.demand.${level}` as MessageId)} answer={answers.demand} />
        </Item>
        <Item label={t("galaxy.item.money")}>
          <dl className="galaxy-figures">
            <div>
              <dt>{t("galaxy.money.expense")}</dt>
              <dd className="is-negative">{money(view.money.total.expense)}</dd>
            </div>
            <div>
              <dt>{t("galaxy.money.aiCost")}</dt>
              <dd className="is-negative">{money(view.money.aiCost)}</dd>
            </div>
            <div>
              <dt>{t("galaxy.money.income")}</dt>
              <dd className="is-positive">{money(view.money.total.income)}</dd>
            </div>
            <div>
              <dt>{t("galaxy.money.thisMonth")}</dt>
              <dd>
                −{money(view.money.month.expense + view.money.aiCostMonth)} / +{money(view.money.month.income)}
              </dd>
            </div>
          </dl>
          {view.money.orphanAllocations ? <small className="is-negative">{t("galaxy.money.orphans", { count: view.money.orphanAllocations })}</small> : null}
        </Item>
        <Item label={t("galaxy.item.resources")}>
          {flows.length ? (
            <ul className="galaxy-flat-list">
              {flows.map((flow) => (
                <li key={flow.resourceId}>
                  {galaxy.resources.find((resource) => resource.id === flow.resourceId)?.name ?? "—"}: {money(flow.total)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="galaxy-muted">{t("galaxy.resources.none")}</span>
          )}
          <small>
            {t("galaxy.resources.activity", { count: signals.activity30d })}
            {signals.aiRunMs ? ` · ${t("galaxy.resources.aiTime", { minutes: Math.round(signals.aiRunMs / 60_000) })}` : ""}
          </small>
        </Item>
      </Group>

      <Group title={t("galaxy.group.risk")}>
        <Item label={t("galaxy.item.uncertainty")}>{judgedText("uncertainty")}</Item>
        <Item label={t("galaxy.item.constraint")}>
          <span className="galaxy-constraint">
            {view.constraint && view.constraint in CONSTRAINT_ICONS
              ? (() => {
                  const Icon = CONSTRAINT_ICONS[view.constraint as keyof typeof CONSTRAINT_ICONS];
                  return <Icon size={14} />;
                })()
              : null}
            {judgedText("constraint")}
          </span>
          <small>
            {t("galaxy.constraint.counts", { blocked: signals.statusCounts.blocked, waiting: signals.statusCounts.waiting, review: signals.statusCounts.needs_review })}
            {signals.staleDays >= 14 ? ` · ${t("galaxy.signal.stale", { days: signals.staleDays })}` : ""}
          </small>
        </Item>
        <Item label={t("galaxy.item.dependencies")}>
          <div className="galaxy-chip-row">
            {views
              .filter((other) => other.space.id !== space.id)
              .map((other) => {
                const on = space.dependsOn.includes(other.space.id);
                return (
                  <button
                    key={other.space.id}
                    type="button"
                    className={`galaxy-toggle-chip ${on ? "is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      store.updateSpace(space.id, {
                        dependsOn: on ? space.dependsOn.filter((id) => id !== other.space.id) : [...space.dependsOn, other.space.id],
                      })
                    }
                  >
                    <span className="galaxy-dot" style={{ background: other.space.color }} /> {other.space.title}
                  </button>
                );
              })}
          </div>
          {!space.dependsOn.length ? <small className="galaxy-muted">{t("galaxy.dependencies.none")}</small> : null}
        </Item>
      </Group>

      <Group title={t("galaxy.group.act")}>
        <Item label={t("galaxy.item.decision")}>
          <Segmented
            options={DECISIONS.map((decision) => ({ value: decision, label: t(`galaxy.decision.${decision}` as MessageId), color: DECISION_COLORS[decision] }))}
            value={space.decision}
            onChange={(decision) => store.updateSpace(space.id, { decision: decision as SpaceDecision, decidedAt: new Date().toISOString() })}
          />
          {answers.proposal ? (
            <small>
              {t("galaxy.decision.proposal", {
                value: t(`galaxy.decision.${answers.proposal.value}` as MessageId),
                confidence: Math.round(answers.proposal.confidence * 100),
              })}
            </small>
          ) : null}
          <div className="galaxy-kill">
            <input
              value={space.killCriterion?.state ?? ""}
              placeholder={t("galaxy.decision.killState")}
              aria-label={t("galaxy.decision.killState")}
              onChange={(event) => store.updateSpace(space.id, { killCriterion: { state: event.target.value, date: space.killCriterion?.date ?? "" } })}
            />
            <input
              type="date"
              value={space.killCriterion?.date ?? ""}
              aria-label={t("galaxy.decision.killDate")}
              onChange={(event) => store.updateSpace(space.id, { killCriterion: { state: space.killCriterion?.state ?? "", date: event.target.value } })}
            />
          </div>
          {killOverdue ? <small className="is-negative">{t("galaxy.decision.overdue")}</small> : null}
        </Item>
        <Item label={t("galaxy.item.next")}>
          {signals.nextSteps.length ? (
            <ul className="galaxy-flat-list">
              {signals.nextSteps.map((step) => (
                <li key={step.nodeId}>
                  <span className={`galaxy-next-reason is-${step.reason}`}>{t(`galaxy.next.${step.reason}` as MessageId)}</span> <b>{step.title || "—"}</b>
                  {step.text ? `: ${step.text}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <span className="galaxy-muted">{t("galaxy.next.none")}</span>
          )}
          {signals.nextSteps.length && !signals.nextSteps.some((step) => step.reason === "pinned") ? <small>{t("galaxy.next.hint")}</small> : null}
        </Item>
      </Group>

      {!view.active ? (
        <button
          type="button"
          className="galaxy-button is-danger galaxy-delete"
          onClick={() => {
            if (!window.confirm(t("galaxy.deleteSpace.confirm", { title: space.title }))) return;
            void store.deleteSpace(space.id);
            onClose();
          }}
        >
          <Trash2 size={14} /> {t("galaxy.deleteSpace")}
        </button>
      ) : null}
    </aside>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="galaxy-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="galaxy-item">
      <span className="galaxy-item-label">{label}</span>
      <div className="galaxy-item-value">{children}</div>
    </div>
  );
}

function Confidence({ answer }: { answer: JudgedAnswer }) {
  const t = useMessage();
  const value = Math.round(answer.confidence * 100);
  return (
    <span className="galaxy-confidence" title={t("galaxy.judge.confidence", { value })}>
      <i style={{ width: `${value}%` }} />
      <em>{value}%</em>
    </span>
  );
}

function LevelBar({ value, levels, labelOf, answer }: { value: number | null; levels: number; labelOf: (level: number) => string; answer?: JudgedAnswer }) {
  const t = useMessage();
  if (value === null) return <span className="galaxy-muted">{t("galaxy.signal.unjudged")}</span>;
  return (
    <span className="galaxy-level">
      <span className="galaxy-level-steps">
        {Array.from({ length: levels }, (_, index) => (
          <i key={index} className={index <= value ? "on" : ""} />
        ))}
      </span>
      <b>{labelOf(value)}</b>
      {answer ? <Confidence answer={answer} /> : null}
    </span>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; color?: string }[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="galaxy-segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-on" : ""}
          style={value === option.value && option.color ? { borderColor: option.color, color: option.color } : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
