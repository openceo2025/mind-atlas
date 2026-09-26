import { Mic, MicOff, Plus, Repeat, Trash2, TriangleAlert, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { AtlasNode } from "../../types";
import { useMessage, useMindAtlasLocale } from "../../i18n/I18nProvider";
import type { MessageId } from "../../i18n/messages";
import { parseLedgerLine } from "../../galaxy/galaxyQuickEntry";
import { formatMoney, todayIso, unallocatedEntries } from "../../galaxy/galaxyRollup";
import { draftToEntry, newId, useGalaxyStore } from "../../galaxy/galaxyStore";
import type { SpaceView } from "../../galaxy/galaxySummary";
import type { Currency, GalaxyResource, GalaxyState, LedgerEntry, ResourceKind } from "../../galaxy/galaxyTypes";

const CURRENCIES: Currency[] = ["JPY", "USD"];

interface LedgerPanelProps {
  galaxy: GalaxyState;
  views: SpaceView[];
  spaceFilter: string | null;
  onClearFilter: () => void;
  onClose: () => void;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

/** Browser speech recognition, when the browser offers it. */
export function useSpeechLine(locale: string, onText: (text: string) => void) {
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const Constructor = typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition)
    : undefined;
  const toggle = () => {
    if (!Constructor) return false;
    if (listening) {
      recognition.current?.stop();
      return true;
    }
    const instance = new Constructor();
    instance.lang = locale === "ja" ? "ja-JP" : locale;
    instance.interimResults = false;
    instance.continuous = false;
    instance.onresult = (event) => {
      const text = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (text) onText(text);
    };
    instance.onend = () => setListening(false);
    instance.onerror = () => setListening(false);
    recognition.current = instance;
    setListening(true);
    instance.start();
    return true;
  };
  return { supported: Boolean(Constructor), listening, toggle };
}

export function LedgerPanel({ galaxy, views, spaceFilter, onClearFilter, onClose }: LedgerPanelProps) {
  const t = useMessage();
  const { locale } = useMindAtlasLocale();
  const [line, setLine] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const money = (value: number, currency: Currency) => formatMoney(value, currency, locale);
  const speech = useSpeechLine(locale, (text) => {
    setLine(text);
    readLine(text, true);
  });

  const readLine = (text: string, spoken = false) => {
    const draft = parseLedgerLine(text, galaxy);
    if (!draft) {
      setMessage(t("galaxy.ledger.parseFailed"));
      return;
    }
    setMessage("");
    setEditing({ ...draftToEntry({ ...draft, spaceId: draft.spaceId ?? spaceFilter ?? undefined }), source: spoken ? "voice" : "manual" });
  };

  const unallocated = unallocatedEntries(galaxy);
  const unallocatedIds = new Set(unallocated.map((entry) => entry.id));
  const filterTitle = spaceFilter ? views.find((view) => view.space.id === spaceFilter)?.space.title ?? "" : "";
  const entries = [...galaxy.ledger]
    .filter((entry) => !spaceFilter || entry.allocations.some((allocation) => allocation.spaceId === spaceFilter))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return (
    <aside className="galaxy-panel galaxy-ledger" aria-label={t("galaxy.ledger")}>
      <header className="galaxy-panel-header">
        <h2>{t("galaxy.ledger")}</h2>
        {spaceFilter ? (
          <button type="button" className="galaxy-chip-button" onClick={onClearFilter}>
            {t("galaxy.ledger.filter", { title: filterTitle })} · {t("galaxy.ledger.showAll")}
          </button>
        ) : null}
        <button type="button" className="galaxy-icon-button" onClick={onClose} aria-label={t("common.close")}>
          <X size={18} />
        </button>
      </header>

      <form
        className="galaxy-quick-entry"
        onSubmit={(event) => {
          event.preventDefault();
          readLine(line);
        }}
      >
        <input value={line} onChange={(event) => setLine(event.target.value)} placeholder={t("galaxy.ledger.quick")} aria-label={t("galaxy.ledger.quick")} />
        <button
          type="button"
          className={`galaxy-icon-button ${speech.listening ? "is-recording" : ""}`}
          title={speech.supported ? t("galaxy.ledger.voice") : t("galaxy.ledger.voiceUnsupported")}
          aria-label={t("galaxy.ledger.voice")}
          disabled={!speech.supported}
          onClick={() => speech.toggle()}
        >
          {speech.listening ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button type="submit" className="galaxy-button is-primary">
          {t("galaxy.ledger.parse")}
        </button>
      </form>
      {message ? <p className="galaxy-muted is-negative">{message}</p> : null}

      {editing ? (
        <EntryEditor
          entry={editing}
          galaxy={galaxy}
          views={views}
          onSave={(entry) => {
            useGalaxyStore.getState().upsertLedgerEntry(entry);
            setEditing(null);
            setLine("");
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <p className="galaxy-muted">{t("galaxy.ledger.auto")}</p>

      {unallocated.length && !spaceFilter ? (
        <section className="galaxy-unallocated">
          <h3>
            <TriangleAlert size={14} /> {t("galaxy.ledger.unallocatedTitle")}
          </h3>
        </section>
      ) : null}

      {entries.length ? (
        <ul className="galaxy-ledger-list">
          {entries.map((entry) => (
            <li key={entry.id} className={unallocatedIds.has(entry.id) ? "is-unallocated" : ""}>
              <button type="button" className="galaxy-ledger-row" onClick={() => setEditing(entry)}>
                <span className="date">{entry.date}</span>
                <span className="memo">
                  {entry.memo || "—"}
                  {entry.approximate ? <em> · {t("galaxy.ledger.approximate")}</em> : null}
                </span>
                <span className="spaces">
                  {entry.allocations.map((allocation) => {
                    const view = views.find((item) => item.space.id === allocation.spaceId);
                    return view ? <i key={`${allocation.spaceId}:${allocation.nodeId ?? ""}`} className="galaxy-dot" style={{ background: view.space.color }} title={view.space.title} /> : null;
                  })}
                </span>
                {entry.recurrence ? <Repeat size={12} aria-label={t(`galaxy.ledger.recurrence.${entry.recurrence.every}` as MessageId)} /> : <span />}
                <b className={entry.kind === "income" ? "is-positive" : "is-negative"}>
                  {entry.kind === "income" ? "+" : "−"}
                  {money(entry.amount, entry.currency)}
                </b>
              </button>
              <button
                type="button"
                className="galaxy-inline-icon"
                aria-label={t("common.delete")}
                title={t("common.delete")}
                onClick={() => useGalaxyStore.getState().removeLedgerEntry(entry.id)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="galaxy-muted">{t("galaxy.ledger.empty")}</p>
      )}

      <ResourcesSection galaxy={galaxy} />
    </aside>
  );
}

function flattenNodes(root: AtlasNode | null, limit = 400) {
  const out: { id: string; label: string }[] = [];
  const walk = (node: AtlasNode, depth: number) => {
    if (out.length >= limit) return;
    if (depth > 0) out.push({ id: node.id, label: `${"  ".repeat(depth - 1)}${node.title || "—"}` });
    node.children.forEach((child) => walk(child, depth + 1));
  };
  if (root) walk(root, 0);
  return out;
}

export function EntryEditor({
  entry,
  galaxy,
  views,
  onSave,
  onCancel,
  lockAllocation = false,
}: {
  entry: LedgerEntry;
  galaxy: GalaxyState;
  views: SpaceView[];
  onSave: (entry: LedgerEntry) => void;
  onCancel: () => void;
  lockAllocation?: boolean;
}) {
  const t = useMessage();
  const [draft, setDraft] = useState(entry);
  const allocation = draft.allocations[0];
  const allocatedView = views.find((view) => view.space.id === allocation?.spaceId) ?? null;
  const nodes = useMemo(() => flattenNodes(allocatedView?.root ?? null), [allocatedView?.root]);
  const patch = (next: Partial<LedgerEntry>) => setDraft((current) => ({ ...current, ...next }));
  return (
    <form
      className="galaxy-entry-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!(draft.amount > 0)) return;
        onSave(draft);
      }}
    >
      <div className="galaxy-segmented" role="radiogroup">
        {(["expense", "income"] as const).map((kind) => (
          <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} className={draft.kind === kind ? "is-on" : ""} onClick={() => patch({ kind })}>
            {t(`galaxy.ledger.kind.${kind}` as MessageId)}
          </button>
        ))}
      </div>
      <label>
        <span>{t("galaxy.ledger.amount")}</span>
        <span className="galaxy-inline-fields">
          <input type="number" min={0} step="any" value={draft.amount || ""} onChange={(event) => patch({ amount: Number(event.target.value) })} />
          <select value={draft.currency} aria-label={t("galaxy.ledger.currency")} onChange={(event) => patch({ currency: event.target.value as Currency })}>
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label>
        <span>{t("galaxy.ledger.date")}</span>
        <input type="date" value={draft.date} onChange={(event) => patch({ date: event.target.value || todayIso() })} />
      </label>
      <label>
        <span>{t("galaxy.ledger.recurrence")}</span>
        <select
          value={draft.recurrence?.every ?? "none"}
          onChange={(event) => patch({ recurrence: event.target.value === "none" ? undefined : { every: event.target.value as "month" | "year" } })}
        >
          <option value="none">{t("galaxy.ledger.recurrence.none")}</option>
          <option value="month">{t("galaxy.ledger.recurrence.month")}</option>
          <option value="year">{t("galaxy.ledger.recurrence.year")}</option>
        </select>
      </label>
      {!lockAllocation ? (
        <>
          <label>
            <span>{t("galaxy.ledger.space")}</span>
            <select
              value={allocation?.spaceId ?? ""}
              onChange={(event) => patch({ allocations: event.target.value ? [{ spaceId: event.target.value, weight: 1 }] : [] })}
            >
              <option value="">{t("galaxy.ledger.space.none")}</option>
              {views.map((view) => (
                <option key={view.space.id} value={view.space.id}>
                  {view.space.title}
                </option>
              ))}
            </select>
          </label>
          {allocation && nodes.length ? (
            <label>
              <span>{t("galaxy.ledger.node")}</span>
              <select
                value={allocation.nodeId ?? ""}
                onChange={(event) => patch({ allocations: [{ ...allocation, nodeId: event.target.value || undefined }] })}
              >
                <option value="">{t("galaxy.ledger.node.whole")}</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : null}
      <label>
        <span>{t("galaxy.ledger.resource")}</span>
        <select value={draft.resourceId ?? ""} onChange={(event) => patch({ resourceId: event.target.value || undefined })}>
          <option value="">{t("galaxy.ledger.resource.none")}</option>
          {galaxy.resources
            .filter((resource) => resource.kind === "account")
            .map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>{t("galaxy.ledger.memo")}</span>
        <input value={draft.memo} onChange={(event) => patch({ memo: event.target.value })} />
      </label>
      <label className="galaxy-check">
        <input type="checkbox" checked={Boolean(draft.approximate)} onChange={(event) => patch({ approximate: event.target.checked })} />
        <span>{t("galaxy.ledger.approximate")}</span>
      </label>
      <div className="galaxy-row-actions">
        <button type="button" className="galaxy-button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="galaxy-button is-primary" disabled={!(draft.amount > 0)}>
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

const RESOURCE_KINDS: ResourceKind[] = ["account", "time", "ai-quota", "brand"];

function ResourcesSection({ galaxy }: { galaxy: GalaxyState }) {
  const t = useMessage();
  const store = useGalaxyStore.getState();
  const update = (resource: GalaxyResource, patch: Partial<GalaxyResource>) => store.upsertResource({ ...resource, ...patch });
  return (
    <section className="galaxy-resources">
      <h3>{t("galaxy.resources.title")}</h3>
      <ul>
        {galaxy.resources.map((resource) => (
          <li key={resource.id}>
            <select value={resource.kind} aria-label={t("galaxy.resources.title")} onChange={(event) => update(resource, { kind: event.target.value as ResourceKind })}>
              {RESOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`galaxy.resources.kind.${kind}` as MessageId)}
                </option>
              ))}
            </select>
            <input value={resource.name} aria-label={t("galaxy.resources.name")} onChange={(event) => update(resource, { name: event.target.value })} />
            {resource.kind === "account" ? (
              <input
                type="number"
                step="any"
                value={resource.balance ?? ""}
                placeholder={t("galaxy.resources.balance")}
                aria-label={t("galaxy.resources.balance")}
                onChange={(event) => update(resource, { balance: event.target.value === "" ? undefined : Number(event.target.value), currency: resource.currency ?? galaxy.displayCurrency })}
              />
            ) : resource.kind === "time" ? (
              <input
                type="number"
                step="1"
                value={resource.hoursPerWeek ?? ""}
                placeholder={t("galaxy.resources.hours")}
                aria-label={t("galaxy.resources.hours")}
                onChange={(event) => update(resource, { hoursPerWeek: event.target.value === "" ? undefined : Number(event.target.value) })}
              />
            ) : (
              <span />
            )}
            <button type="button" className="galaxy-inline-icon" aria-label={t("common.delete")} onClick={() => store.removeResource(resource.id)}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="galaxy-button"
        onClick={() => store.upsertResource({ id: newId("res"), kind: "account", name: t("galaxy.resources.kind.account"), currency: galaxy.displayCurrency })}
      >
        <Plus size={14} /> {t("galaxy.resources.add")}
      </button>
    </section>
  );
}
