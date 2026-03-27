/**
 * Procedural arrangement layer.
 *
 * Responsible for generating star positions from biblical hierarchy data.
 * Must not depend on Three.js or any rendering detail.
 *
 * The renderer boundary type (StarArrangement) lives in src/types.ts.
 */

export type { ArrangementStrategy, ArrangementInput } from "./types";

export {
    spineNoiseStrategy,
    generateArrangement,
    defaultGenerateOptions,
} from "./strategies/spine-noise";

export type { GenerateOptions } from "./strategies/spine-noise";

export { computeSphericalArrangement } from "./strategies/spherical";
export type { SphericalResult } from "./strategies/spherical";

export { evaluateArrangement } from "./evaluate";
export type { ArrangementMetrics, BookMetrics, DivisionMetrics } from "./evaluate";

export { runExperiment, runActiveExperiment, compareExperiments, EXPERIMENT_PRESETS, ACTIVE_EXPERIMENT } from "./experiment";
export type { ExperimentConfig, ExperimentResult, ExperimentMeta, SphericalConfig, SpineNoiseConfig, ComparisonResult, MetricDeltas } from "./experiment";
