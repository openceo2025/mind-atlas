import { useState } from "react";
import { useMessage, useMindAtlasLocale } from "../../i18n/I18nProvider";
import { useAtlasStore } from "../../store/atlasStore";
import { parseLedgerLine } from "../../galaxy/galaxyQuickEntry";
import { formatMoney, spaceMoney, todayIso } from "../../galaxy/galaxyRollup";
import { draftToEntry, useGalaxyStore } from "../../galaxy/galaxyStore";
import "./nodeLedger.css";

/**
 * The money view on a focused node: what this branch has cost and earned
 * (its own entries plus every descendant's), and a one-line way to add a cost
 * allocated to exactly this node. Hidden until the galaxy is ready.
 */
export function NodeLedgerSection({ nodeId }: { nodeId: string }) {
  const t = useMessage();
  const { locale } = useMindAtlasLocale();
  const galaxy = useGalaxyStore((state) => state.galaxy);
  const status = useGalaxyStore((state) => state.status);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const [line, setLine] = useState("");
  const [message, setMessage] = useState("");
  if (status !== "ready" || !galaxy) return null;
  const spaceId = galaxy.activeSpaceId;
  const totals = spaceMoney(galaxy, spaceId, atlasRoot, todayIso()).byNode[nodeId];
  const money = (value: number) => formatMoney(value, galaxy.displayCurrency, locale);
  return (
    <section className="node-ledger-section" aria-label={t("galaxy.node.money")}>
      <span className="node-ledger-title">{t("galaxy.node.money")}</span>
      {totals ? <small>{t("galaxy.node.subtree", { expense: money(totals.expense), income: money(totals.income) })}</small> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const draft = parseLedgerLine(line, galaxy);
          if (!draft) {
            setMessage(t("galaxy.ledger.parseFailed"));
            return;
          }
          useGalaxyStore.getState().upsertLedgerEntry(draftToEntry({ ...draft, spaceId }, nodeId === atlasRoot.id ? undefined : nodeId));
          setLine("");
          setMessage(t("galaxy.node.added"));
        }}
      >
        <input value={line} onChange={(event) => setLine(event.target.value)} placeholder={t("galaxy.node.add")} aria-label={t("galaxy.node.add")} />
      </form>
      {message ? <small>{message}</small> : null}
    </section>
  );
}
