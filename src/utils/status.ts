import type { WorkStatus } from "../types";

export function getStatusLabel(status: WorkStatus) {
  switch (status) {
    case "needs_review":
      return "Needs review";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "blocked":
      return "Blocked";
    case "error":
      return "Error";
    case "done":
      return "Done";
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
