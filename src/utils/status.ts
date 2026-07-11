import type { WorkStatus } from "../types";
import { formatAppMessage } from "../i18n/format";

export function getStatusLabel(status: WorkStatus) {
  switch (status) {
    case "needs_review":
      return formatAppMessage("label.status.needsReview");
    case "running":
      return formatAppMessage("label.status.running");
    case "waiting":
      return formatAppMessage("label.status.waiting");
    case "blocked":
      return formatAppMessage("label.status.blocked");
    case "error":
      return formatAppMessage("label.status.error");
    case "done":
      return formatAppMessage("label.status.done");
  }
}

export function getStatusColor(status: WorkStatus) {
  switch (status) {
    case "needs_review":
      return "#f7d765";
    case "running":
      return "#7ddfac";
    case "waiting":
      return "#86b7ff";
    case "blocked":
      return "#b793f5";
    case "error":
      return "#ff6b6b";
    case "done":
      return "#8bd8d2";
  }
}
