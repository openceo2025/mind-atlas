import { X } from "lucide-react";
import { useMessage } from "../../i18n/I18nProvider";
import type { MessageId } from "../../i18n/messages";
import { isHostedServiceMode } from "../../hosted/serviceClient";
import { useJudgeRuntime } from "../../galaxy/galaxyJudgeRunner";
import { useGalaxyStore } from "../../galaxy/galaxyStore";
import type { Currency, GalaxyState, JudgeBackend } from "../../galaxy/galaxyTypes";

const CURRENCIES: Currency[] = ["JPY", "USD"];

export function GalaxySettingsPanel({ galaxy, onClose }: { galaxy: GalaxyState; onClose: () => void }) {
  const t = useMessage();
  const store = useGalaxyStore.getState();
  const availability = useJudgeRuntime((state) => state.availability);
  const hosted = isHostedServiceMode();
  // Hosted Public Mode only ever offers the hosted judge; local backends stay local-only.
  const backend: JudgeBackend = hosted ? "jev-hosted" : galaxy.judge.backend === "llama-local" ? "llama-local" : "jev-local";
  return (
    <aside className="galaxy-panel galaxy-settings" aria-label={t("galaxy.settings")}>
      <header className="galaxy-panel-header">
        <h2>{t("galaxy.settings")}</h2>
        <button type="button" className="galaxy-icon-button" onClick={onClose} aria-label={t("common.close")}>
          <X size={18} />
        </button>
      </header>

      <section className="galaxy-group">
        <h3>{t("galaxy.settings.judge")}</h3>
        <label className="galaxy-check">
          <input type="checkbox" checked={galaxy.judge.auto} onChange={(event) => store.setJudgeSettings({ auto: event.target.checked })} />
          <span>{t("galaxy.settings.auto")}</span>
        </label>
        <fieldset className="galaxy-radio-list">
          <legend>{t("galaxy.settings.backend")}</legend>
          {hosted ? (
            <label>
              <input type="radio" checked readOnly />
              <span>{t("galaxy.settings.backend.jevHosted")}</span>
            </label>
          ) : (
            <>
              <label>
                <input type="radio" name="galaxy-judge-backend" checked={backend === "jev-local"} onChange={() => store.setJudgeSettings({ backend: "jev-local" })} />
                <span>{t("galaxy.settings.backend.jevLocal")}</span>
              </label>
              <label>
                <input type="radio" name="galaxy-judge-backend" checked={backend === "llama-local"} onChange={() => store.setJudgeSettings({ backend: "llama-local" })} />
                <span>{t("galaxy.settings.backend.llamaLocal")}</span>
              </label>
              {backend === "llama-local" ? (
                <label className="galaxy-field">
                  <span>{t("galaxy.settings.llamaUrl")}</span>
                  <input value={galaxy.judge.llamaUrl} onChange={(event) => store.setJudgeSettings({ llamaUrl: event.target.value.trim() })} />
                </label>
              ) : null}
            </>
          )}
        </fieldset>
        <p className={availability.available ? "is-positive" : "galaxy-muted"}>
          {availability.available
            ? t("galaxy.settings.status.ok", { model: availability.model })
            : t(`galaxy.settings.status.${availability.reason}` as MessageId)}
        </p>
      </section>

      <section className="galaxy-group">
        <h3>{t("galaxy.settings.currency")}</h3>
        <div className="galaxy-inline-fields">
          <select value={galaxy.displayCurrency} aria-label={t("galaxy.settings.currency")} onChange={(event) => store.setCurrency(event.target.value as Currency)}>
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
          <label className="galaxy-field">
            <span>{t("galaxy.settings.rate")}</span>
            <input type="number" min={1} step="any" value={galaxy.jpyPerUsd} onChange={(event) => store.setCurrency(galaxy.displayCurrency, Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="galaxy-group">
        <h3>{t("galaxy.settings.data")}</h3>
        <p className="galaxy-muted">{t("galaxy.settings.dataNote")}</p>
      </section>
    </aside>
  );
}
