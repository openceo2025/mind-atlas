import { Gauge, RefreshCw, SlidersHorizontal } from "lucide-react";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { getProviderUsage } from "../ai/bridgeClient";
import { getAboutDemoProviderUsage, readAboutDemoConfig } from "../aboutDemo";
import type { ProviderUsageMetric, ProviderUsageResult } from "../types";
import { I18nText, useMindAtlasLocale } from "../i18n/I18nProvider";
import { formatAppMessage } from "../i18n/format";
import { currentAppLocale } from "../i18n/locales";

const PROVIDER_USAGE_SELECTION_KEY = "mind-atlas-provider-usage-selection-v1";

export function ProviderUsagePanel() {
  const { locale } = useMindAtlasLocale();
  const aboutDemoConfig = useMemo(() => readAboutDemoConfig(), []);
  const aboutDemoUsage = useMemo(() => (aboutDemoConfig?.kind === "app" ? getAboutDemoProviderUsage(locale) : null), [aboutDemoConfig, locale]);
  const [result, setResult] = useState<ProviderUsageResult | null>(aboutDemoUsage);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(() => aboutDemoUsage?.metrics.map((metric) => metric.id) ?? loadProviderUsageSelection());
  const [configuring, setConfiguring] = useState(false);
  const [loading, setLoading] = useState(!aboutDemoUsage);
  const [error, setError] = useState("");

  const refresh = async (forceRefresh = false) => {
    if (aboutDemoUsage) {
      setResult(aboutDemoUsage);
      setSelectedIds(aboutDemoUsage.metrics.map((metric) => metric.id));
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await getProviderUsage(forceRefresh);
      setResult(next);
      setSelectedIds((current) => current ?? next.metrics.filter((metric) => metric.defaultVisible).map((metric) => metric.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Usage unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [aboutDemoUsage]);

  useEffect(() => {
    if (!aboutDemoUsage && selectedIds) persistProviderUsageSelection(selectedIds);
  }, [aboutDemoUsage, selectedIds]);

  const selectedMetrics = useMemo(() => {
    if (!result || !selectedIds) return [];
    const selected = new Set(selectedIds);
    return result.metrics.filter((metric) => selected.has(metric.id));
  }, [result, selectedIds]);

  const toggleMetric = (id: string) => {
    setSelectedIds((current) => {
      const selected = new Set(current ?? []);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return Array.from(selected);
    });
  };

  return (
    <section className={`provider-usage-panel ${configuring ? "is-configuring" : ""}`} aria-label={formatAppMessage("ui.providerUsagePanel.aiProviderUsage.3b4868f")}>
      <header className="provider-usage-header">
        <span className="provider-usage-title">
          <Gauge size={14} />
          {<I18nText id="ui.providerUsagePanel.usage.83f3a8e" />}</span>
        <span className="provider-usage-updated">{loading ? formatAppMessage("ui.providerUsagePanel.sync.f877560") : formatUpdatedAt(result?.fetchedAt)}</span>
        {!aboutDemoUsage ? (
          <>
            <button
              className="provider-usage-icon-button"
              type="button"
              onClick={() => void refresh(true)}
              aria-label={formatAppMessage("ui.providerUsagePanel.refreshProviderUsage.1d40174")}
              title={formatAppMessage("ui.providerUsagePanel.refreshProviderUsage.6f8e298")}
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? "is-spinning" : ""} />
            </button>
            <button
              className={`provider-usage-icon-button ${configuring ? "is-active" : ""}`}
              type="button"
              onClick={() => setConfiguring((current) => !current)}
              aria-label={formatAppMessage("ui.providerUsagePanel.selectProviderUsageMetrics.481f1cf")}
              aria-expanded={configuring}
              title={formatAppMessage("ui.providerUsagePanel.selectProviderUsageMetrics.e40b46d")}
            >
              <SlidersHorizontal size={13} />
            </button>
          </>
        ) : null}
      </header>

      {configuring && result ? (
        <div className="provider-usage-selector" aria-label={formatAppMessage("ui.providerUsagePanel.providerUsageMetricSelection.8b11260")}>
          {result.metrics.map((metric) => (
            <label key={metric.id}>
              <input
                type="checkbox"
                checked={selectedIds?.includes(metric.id) ?? false}
                onChange={() => toggleMetric(metric.id)}
              />
              <span>{metric.vendorLabel}</span>
              <small>{metric.kind === "balance" ? formatAppMessage("ui.providerUsagePanel.balance.bd9d2f7") : metric.label}</small>
            </label>
          ))}
        </div>
      ) : null}

      <div className="provider-usage-grid">
        {selectedMetrics.map((metric) => (
          <ProviderUsageBar key={metric.id} metric={metric} />
        ))}
        {!loading && !error && selectedMetrics.length === 0 ? (
          <p className="provider-usage-empty">{<I18nText id="ui.providerUsagePanel.noMetricsSelected.3a18c33" />}</p>
        ) : null}
        {error ? <p className="provider-usage-error">{<I18nText id="ui.providerUsagePanel.offline.398a963" />}</p> : null}
      </div>
    </section>
  );
}

function ProviderUsageBar({ metric }: { metric: ProviderUsageMetric }) {
  const percent = clampPercent(metric.barPercent ?? 0);
  const resetLabel = formatResetAt(metric.resetAt);
  const title = [metric.detail, resetLabel ? `Reset ${resetLabel}` : "", `Source: ${metric.source}`].filter(Boolean).join(" / ");
  const style = { "--provider-usage-percent": `${percent}%` } as CSSProperties;

  return (
    <article className={`provider-usage-metric ${metric.available ? "" : "is-unavailable"}`} title={title}>
      <div className="provider-usage-metric-label">
        <strong>{metric.vendorLabel}</strong>
        <span>{metric.label}</span>
        <b>{metric.displayValue}</b>
      </div>
      <div className="provider-usage-track" aria-label={`${metric.vendorLabel} ${metric.label} ${metric.displayValue}`}>
        <span style={style} />
      </div>
      {resetLabel ? <small>{<I18nText id="ui.providerUsagePanel.reset.d78ee67" />}{resetLabel}</small> : <small>{metric.available ? metric.source.toUpperCase() : formatAppMessage("ui.providerUsagePanel.nA.5c37d2e")}</small>}
    </article>
  );
}

function loadProviderUsageSelection() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROVIDER_USAGE_SELECTION_KEY) ?? "null");
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function persistProviderUsageSelection(selectedIds: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROVIDER_USAGE_SELECTION_KEY, JSON.stringify(selectedIds));
  } catch {
    // Usage display preferences are best effort.
  }
}

function formatUpdatedAt(value?: string) {
  if (!value) return "WAIT";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "READY";
  return `UPD ${date.toLocaleTimeString(currentAppLocale(), { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function formatResetAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(currentAppLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString(currentAppLocale(), { month: "2-digit", day: "2-digit" });
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}
