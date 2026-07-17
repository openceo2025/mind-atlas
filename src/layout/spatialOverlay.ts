export type SpatialVec3 = [number, number, number];

export type SpatialGuideLineTone = "primary" | "secondary";
export type SpatialGuideLabelTone = "heading" | "weekday" | "date" | "count" | "muted";

export interface SpatialGuideLine {
  id: string;
  start: SpatialVec3;
  end: SpatialVec3;
  tone?: SpatialGuideLineTone;
  delay?: number;
}

export interface SpatialGuideLabel {
  id: string;
  text: string;
  position: SpatialVec3;
  tone?: SpatialGuideLabelTone;
  delay?: number;
}

export interface SpatialLayoutOverlay {
  lines: SpatialGuideLine[];
  labels: SpatialGuideLabel[];
}

export const EMPTY_SPATIAL_LAYOUT_OVERLAY: SpatialLayoutOverlay = {
  lines: [],
  labels: [],
};
