export const BOARD_MOBILE_REFERENCE_NODE_VIEW_HEIGHT_PX = 359;
export const BOARD_MOBILE_REFERENCE_ACTIVE_NODE_DIAMETER_PX = 57;
export const BOARD_MOBILE_ACTIVE_NODE_DIAMETER_RATIO =
  BOARD_MOBILE_REFERENCE_ACTIVE_NODE_DIAMETER_PX / BOARD_MOBILE_REFERENCE_NODE_VIEW_HEIGHT_PX;
export const BOARD_MOBILE_NODE_WORLD_SCALE = 0.72;

export function getBoardMobileTargetNodeDiameterPx(viewportHeight: number) {
  return Math.max(1, viewportHeight) * BOARD_MOBILE_ACTIVE_NODE_DIAMETER_RATIO;
}

export function getBoardMobileFocusDistance(worldDiameter: number, viewportHeight: number, verticalFovDegrees: number) {
  const targetDiameterPx = getBoardMobileTargetNodeDiameterPx(viewportHeight);
  const verticalFov = (verticalFovDegrees * Math.PI) / 180;
  return (Math.max(0.001, worldDiameter) * Math.max(1, viewportHeight)) /
    (2 * targetDiameterPx * Math.tan(verticalFov / 2));
}

export function getProjectedDiameterPx(worldDiameter: number, distance: number, viewportHeight: number, verticalFovDegrees: number) {
  const verticalFov = (verticalFovDegrees * Math.PI) / 180;
  return (Math.max(0, worldDiameter) * Math.max(1, viewportHeight)) /
    (2 * Math.max(0.001, distance) * Math.tan(verticalFov / 2));
}
