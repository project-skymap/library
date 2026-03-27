export { StarMap } from "./react/StarMap";
export type { StarMapProps, StarMapHandle } from "./react/StarMap";
export type {
  StarMapConfig,
  SceneModel,
  SceneNode,
  SceneLink,
  StarArrangement,
  ConstellationConfig,
  HierarchyFilter,
  HorizonThemeConfig,
  HorizonProfile,
  HorizonSamplePoint,
  HorizonAtmosphereConfig,
  SceneMechanicsDebugConfig
} from "./types";

export { bibleToSceneModel } from "./adapters/bible";
export type { BibleJSON } from "./adapters/bible";

export { default as defaultStars } from "./assets/default-stars.json";

export { generateArrangement, defaultGenerateOptions, spineNoiseStrategy } from "./arrangement";
export type { GenerateOptions, ArrangementStrategy, ArrangementInput } from "./arrangement";

export { PROJECTIONS } from "./engine/projections";
export type { Projection, ProjectionId } from "./engine/projections";
