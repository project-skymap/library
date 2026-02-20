export type ProjectionId = "perspective" | "stereographic";

export interface ProjectionState {
  id: ProjectionId;
  fovDeg: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface ProjectionAdapter {
  projectUnit(point: readonly [number, number, number], state: ProjectionState): ProjectedPoint;
  unprojectUnit(screen: readonly [number, number], state: ProjectionState): readonly [number, number, number];
}
