import type { AtlasNode } from "../types.ts";
import type { SpatialLayoutOverlay, SpatialVec3 } from "./spatialOverlay.ts";

export type CalendarLayoutViewport = "desktop" | "mobile-portrait" | "mobile-landscape";

export interface CalendarLayoutResult {
  positions: Map<string, SpatialVec3>;
  visibleIds: Set<string>;
  nodeScales: Map<string, number>;
  labelScales: Map<string, number>;
  overlay: SpatialLayoutOverlay;
  boundsPoints: SpatialVec3[];
}

interface CalendarLayoutOptions {
  viewport?: CalendarLayoutViewport;
  locale?: string;
  now?: Date;
  focusNodeId?: string;
}

interface ScheduledNode {
  node: AtlasNode;
  date: Date;
  treeOrder: number;
}

interface CalendarMetrics {
  cellWidth: number;
  cellHeight: number;
  headerHeight: number;
  cellInsetX: number;
  cellInsetTop: number;
  cellInsetBottom: number;
}

const CALENDAR_PLANE_Z = -1320;
const CALENDAR_GUIDE_Z = CALENDAR_PLANE_Z + 4;
const CALENDAR_LABEL_Z = CALENDAR_PLANE_Z + 8;
const DAY_COLUMNS = 7;
const TARGET_NODE_SLOT = 76;

export function deriveCalendarLayout(tree: AtlasNode, options: CalendarLayoutOptions = {}): CalendarLayoutResult {
  const locale = options.locale || "en";
  const scheduledNodes = collectScheduledNodes(tree);
  const weekStarts = collectDisplayedWeeks(scheduledNodes, options.now ?? new Date());
  const metrics = getCalendarMetrics(options.viewport ?? "desktop");
  const weekIndexByKey = new Map(weekStarts.map((date, index) => [localDateKey(date), index]));
  const scheduledByDay = new Map<string, ScheduledNode[]>();

  for (const entry of scheduledNodes) {
    const key = localDateKey(entry.date);
    const entries = scheduledByDay.get(key) ?? [];
    entries.push(entry);
    scheduledByDay.set(key, entries);
  }

  const gridWidth = DAY_COLUMNS * metrics.cellWidth;
  const gridHeight = weekStarts.length * metrics.cellHeight;
  const left = -gridWidth / 2;
  const top = gridHeight / 2;
  const positions = new Map<string, SpatialVec3>();
  const visibleIds = new Set<string>();
  const nodeScales = new Map<string, number>();
  const labelScales = new Map<string, number>();
  const globalLabelScale = clamp(3.2 / Math.sqrt(Math.max(1, weekStarts.length)), 0.34, 1);

  weekStarts.forEach((weekStart, rowIndex) => {
    for (let columnIndex = 0; columnIndex < DAY_COLUMNS; columnIndex += 1) {
      const date = addLocalDays(weekStart, columnIndex);
      const dayEntries = scheduledByDay.get(localDateKey(date)) ?? [];
      if (!dayEntries.length) continue;

      const cellLeft = left + columnIndex * metrics.cellWidth;
      const cellTop = top - rowIndex * metrics.cellHeight;
      const availableWidth = metrics.cellWidth - metrics.cellInsetX * 2;
      const availableHeight = metrics.cellHeight - metrics.cellInsetTop - metrics.cellInsetBottom;
      const columns = Math.max(1, Math.ceil(Math.sqrt(dayEntries.length)));
      const rows = Math.max(1, Math.ceil(dayEntries.length / columns));
      const slotWidth = availableWidth / columns;
      const slotHeight = availableHeight / rows;
      const nodeScale = clamp(Math.min(slotWidth, slotHeight) / TARGET_NODE_SLOT, 0.28, 1);

      dayEntries
        .sort((leftEntry, rightEntry) => leftEntry.date.getTime() - rightEntry.date.getTime() || leftEntry.treeOrder - rightEntry.treeOrder)
        .forEach((entry, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          const x = cellLeft + metrics.cellInsetX + slotWidth * (column + 0.5);
          const y = cellTop - metrics.cellInsetTop - slotHeight * (row + 0.5);
          positions.set(entry.node.id, [x, y, CALENDAR_PLANE_Z]);
          visibleIds.add(entry.node.id);
          nodeScales.set(entry.node.id, nodeScale);
          const denseCellLabelVisible = dayEntries.length <= 2 || entry.node.id === options.focusNodeId;
          labelScales.set(entry.node.id, denseCellLabelVisible ? Math.min(nodeScale, globalLabelScale) : 0);
        });
    }
  });

  const overlay = buildCalendarOverlay(weekStarts, metrics, locale, left, top, gridWidth, gridHeight, weekIndexByKey, scheduledByDay);
  const boundsPoints: SpatialVec3[] = [
    [left, top + metrics.headerHeight * 1.3, CALENDAR_PLANE_Z],
    [left + gridWidth, top + metrics.headerHeight * 1.3, CALENDAR_PLANE_Z],
    [left, top - gridHeight, CALENDAR_PLANE_Z],
    [left + gridWidth, top - gridHeight, CALENDAR_PLANE_Z],
  ];

  return { positions, visibleIds, nodeScales, labelScales, overlay, boundsPoints };
}

function collectScheduledNodes(tree: AtlasNode) {
  const result: ScheduledNode[] = [];
  let treeOrder = 0;
  const visit = (node: AtlasNode) => {
    if (node.id !== tree.id && node.reminderAt) {
      const date = new Date(node.reminderAt);
      if (!Number.isNaN(date.getTime())) result.push({ node, date, treeOrder });
    }
    treeOrder += 1;
    node.children.forEach(visit);
  };
  visit(tree);
  return result;
}

function collectDisplayedWeeks(entries: ScheduledNode[], now: Date) {
  if (!entries.length) return [startOfLocalWeek(now)];
  const weekByKey = new Map<string, Date>();
  entries.forEach((entry) => {
    const week = startOfLocalWeek(entry.date);
    weekByKey.set(localDateKey(week), week);
  });
  return [...weekByKey.values()].sort((left, right) => left.getTime() - right.getTime());
}

function buildCalendarOverlay(
  weekStarts: Date[],
  metrics: CalendarMetrics,
  locale: string,
  left: number,
  top: number,
  gridWidth: number,
  gridHeight: number,
  weekIndexByKey: Map<string, number>,
  scheduledByDay: Map<string, ScheduledNode[]>,
): SpatialLayoutOverlay {
  const lines: SpatialLayoutOverlay["lines"] = [];
  const labels: SpatialLayoutOverlay["labels"] = [];

  for (let column = 0; column <= DAY_COLUMNS; column += 1) {
    const x = left + column * metrics.cellWidth;
    lines.push({
      id: `calendar-column-${column}`,
      start: [x, top, CALENDAR_GUIDE_Z],
      end: [x, top - gridHeight, CALENDAR_GUIDE_Z],
      tone: column === 0 || column === DAY_COLUMNS ? "primary" : "secondary",
      delay: column * 0.035,
    });
  }

  for (let row = 0; row <= weekStarts.length; row += 1) {
    const y = top - row * metrics.cellHeight;
    lines.push({
      id: `calendar-row-${row}`,
      start: [left, y, CALENDAR_GUIDE_Z],
      end: [left + gridWidth, y, CALENDAR_GUIDE_Z],
      tone: row === 0 || row === weekStarts.length ? "primary" : "secondary",
      delay: 0.18 + row * 0.045,
    });
  }

  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const weekdayReference = new Date(2024, 0, 1, 12);
  for (let column = 0; column < DAY_COLUMNS; column += 1) {
    const weekday = weekdayFormatter.format(addLocalDays(weekdayReference, column)).replace(/\.$/, "");
    labels.push({
      id: `calendar-weekday-${column}`,
      text: weekday.toLocaleUpperCase(locale),
      position: [left + metrics.cellWidth * (column + 0.5), top + metrics.headerHeight * 0.4, CALENDAR_LABEL_Z],
      tone: "weekday",
      delay: 0.3 + column * 0.045,
    });
  }

  let previousPeriod = "";
  weekStarts.forEach((weekStart, row) => {
    const rowTop = top - row * metrics.cellHeight;
    const period = formatPeriodLabel(weekStart, locale);
    if (period !== previousPeriod) {
      labels.push({
        id: `calendar-period-${localDateKey(weekStart)}`,
        text: period,
        position: [left + metrics.cellWidth * 0.5, rowTop + metrics.headerHeight * 1.2, CALENDAR_LABEL_Z],
        tone: "heading",
        delay: 0.34 + row * 0.04,
      });
      previousPeriod = period;
    }

    for (let column = 0; column < DAY_COLUMNS; column += 1) {
      const date = addLocalDays(weekStart, column);
      labels.push({
        id: `calendar-date-${localDateKey(date)}-${weekIndexByKey.get(localDateKey(weekStart)) ?? row}`,
        text: String(date.getDate()),
        position: [left + column * metrics.cellWidth + 18, rowTop - 20, CALENDAR_LABEL_Z],
        tone: "date",
        delay: 0.4 + row * 0.035 + column * 0.012,
      });
      const itemCount = scheduledByDay.get(localDateKey(date))?.length ?? 0;
      if (itemCount > 2) {
        labels.push({
          id: `calendar-count-${localDateKey(date)}-${row}`,
          text: `×${itemCount}`,
          position: [left + (column + 1) * metrics.cellWidth - 26, rowTop - 20, CALENDAR_LABEL_Z],
          tone: "count",
          delay: 0.48 + row * 0.035 + column * 0.012,
        });
      }
    }
  });

  return { lines, labels };
}

function getCalendarMetrics(viewport: CalendarLayoutViewport): CalendarMetrics {
  if (viewport === "mobile-portrait") {
    return { cellWidth: 174, cellHeight: 154, headerHeight: 96, cellInsetX: 16, cellInsetTop: 46, cellInsetBottom: 14 };
  }
  if (viewport === "mobile-landscape") {
    return { cellWidth: 196, cellHeight: 164, headerHeight: 96, cellInsetX: 18, cellInsetTop: 48, cellInsetBottom: 16 };
  }
  return { cellWidth: 238, cellHeight: 190, headerHeight: 100, cellInsetX: 22, cellInsetTop: 54, cellInsetBottom: 18 };
}

function startOfLocalWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

function addLocalDays(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount, 12);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPeriodLabel(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const CALENDAR_LAYOUT_PLANE_Z = CALENDAR_PLANE_Z;
