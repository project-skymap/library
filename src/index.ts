export { StarMap } from "./react/StarMap";
export type { StarMapProps, StarMapHandle } from "./react/StarMap";
export type { StarMapConfig, SceneModel, SceneNode, SceneLink, StarArrangement, ConstellationConfig, HierarchyFilter } from "./types";

export { bibleToSceneModel } from "./adapters/bible";
export type { BibleJSON } from "./adapters/bible";

export { default as defaultStars } from "./assets/default-stars.json";

export { generateArrangement, defaultGenerateOptions } from "./generateArrangement";
export type { GenerateOptions } from "./generateArrangement";

export { PROJECTIONS } from "./engine/projections";
export type { Projection, ProjectionId } from "./engine/projections";

// Experimental Stellarium-parity rebuild track.
export { EngineNext } from "./engine-next";
export { createEngineNext } from "./engine-next";
export { createBibleTileStreaming } from "./engine-next";
export type {
  EngineModule as EngineNextModule,
  EngineMetrics as EngineNextMetrics,
  FrameTiming as EngineNextFrameTiming,
  RenderContext as EngineNextRenderContext,
  CameraState as EngineNextCameraState,
  ProjectionId as EngineNextProjectionId,
  ProjectionState as EngineNextProjectionState,
  ProjectedPoint as EngineNextProjectedPoint,
  ParitySnapshot as EngineNextParitySnapshot,
  InputReplayStep as EngineNextInputReplayStep,
} from "./engine-next";
