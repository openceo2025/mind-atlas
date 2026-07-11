import { Bot, Circle, Hammer, UserRound } from "lucide-react";
import { findNodePath, getSelectionWorkArea, useAtlasStore } from "../store/atlasStore";
import type { EventActor } from "../types";
import { I18nText } from "../i18n/I18nProvider";
import { formatAppMessage } from "../i18n/format";

export function EventStrip() {
  const workAreas = useAtlasStore((state) => state.workAreas);
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selected = useAtlasStore((state) => state.selected);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const selectEvent = useAtlasStore((state) => state.selectEvent);
  const selectedPath = findNodePath(atlasRoot, selectedNodeId);
  const pathArea = selectedPath?.find((node) => node.kind === "workArea");
  const area = pathArea
    ? workAreas.find((workArea) => workArea.id === pathArea.id) ?? getSelectionWorkArea(workAreas, selected)
    : getSelectionWorkArea(workAreas, selected);
  const recent = area.events.slice(-5);

  return (
    <aside className="event-strip" aria-label={formatAppMessage("ui.eventStrip.recentEvents.50a6756")}>
      <div className="event-strip-header">
        <span>{<I18nText id="ui.eventStrip.recentEvents.5a8aca9" />}</span>
        <strong>{area.title}</strong>
      </div>
      <div className="event-strip-list">
        {recent.map((event) => {
          const Icon = getActorIcon(event.actor);
          return (
            <button key={event.id} className="event-chip" type="button" onClick={() => selectEvent(area.id, event.id)}>
              <Icon size={14} />
              <span className="event-chip-time">{event.createdAt}</span>
              <span>{event.content}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function getActorIcon(actor: EventActor) {
  switch (actor) {
    case "human":
      return UserRound;
    case "ai":
      return Bot;
    case "tool":
      return Hammer;
    case "system":
      return Circle;
  }
}
