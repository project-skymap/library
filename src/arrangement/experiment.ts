/**
 * Arrangement experiment harness.
 *
 * Provides a unified entry point for running any arrangement strategy with any
 * config, collecting debug metadata, and comparing outputs — without touching
 * the rendering engine.
 *
 * Usage pattern:
 *   1. Edit ACTIVE_EXPERIMENT to name a preset.
 *   2. Run `npm run experiment` to generate output and see debug info.
 *   3. Inspect experiment-output.json or pipe to a visualiser.
 *
 * No Three.js dependency. All output is plain data.
 */

import type { BibleJSON } from "../adapters/bible";
import type { StarArrangement } from "../types";
import { bibleToSceneModel } from "../adapters/bible";
import { computeSphericalArrangement } from "./strategies/spherical";
import { generateArrangement, defaultGenerateOptions } from "./strategies/spine-noise";
import type { GenerateOptions } from "./strategies/spine-noise";
import { evaluateArrangement } from "./evaluate";
import type { ArrangementMetrics } from "./evaluate";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface SphericalConfig {
    strategy: "spherical";
    radius?: number;
}

/**
 * All GenerateOptions fields are optional here; defaults come from
 * defaultGenerateOptions inside spine-noise.ts.
 */
export type SpineNoiseConfig = Partial<GenerateOptions> & {
    strategy: "spine-noise";
};

export type ExperimentConfig = SphericalConfig | SpineNoiseConfig;

// ---------------------------------------------------------------------------
// Preset registry
// Switch ACTIVE_EXPERIMENT to the key you want to run.
// ---------------------------------------------------------------------------

export const EXPERIMENT_PRESETS: Record<string, ExperimentConfig> = {
    /** Canonical spherical wedge layout — default engine strategy. */
    "spherical-default": {
        strategy: "spherical",
        radius: 2000,
    },
    /** Spine + noise with default parameters. */
    "spine-noise-default": {
        strategy: "spine-noise",
        seed: defaultGenerateOptions.seed,
        discRadius: defaultGenerateOptions.discRadius,
    },
    /** Spine + noise without Milky Way density bias — more uniform scatter. */
    "spine-noise-no-milkyway": {
        strategy: "spine-noise",
        seed: 42,
        discRadius: 2000,
        milkyWayEnabled: false,
    },
    /** Tighter chapter clusters — good for inspecting book shapes. */
    "spine-noise-tight-clusters": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.03,
    },
    /** Looser clusters with stronger noise — more organic, less readable. */
    "spine-noise-wide-clusters": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.18,
        noiseStrength: 0.7,
    },
    /** Moderate structure: softer regional grouping than structured, noise still dominant. */
    "spine-noise-balanced": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
    },
    /** Stronger global structure — clear regional grouping, still noise-dominated locally. */
    "spine-noise-structured": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.9,
        globalFlowStrength: 0.5,
    },
    /** Balanced preset with structure disabled — baseline for measuring structure impact. */
    "spine-noise-no-structure": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.0,
        globalFlowStrength: 0.0,
    },

    /**
     * True baseline for global-structure comparison: balanced config with both new
     * params explicitly zeroed.  Isolates the effect of canonicalArcCurve +
     * testamentBiasStrength from the pre-existing divisionBias / globalFlow.
     */
    "gs-baseline": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 0,
        testamentBiasStrength: 0.0,
        globalNoiseStrength: 0.0,
        globalNoiseScale: 1.2,
        radialVarianceStrength: 0.0,
    },

    // ---- Global-structure evaluation presets ----
    // All four use the same spine-noise-balanced base (divisionBiasStrength 0.6,
    // globalFlowStrength 0.5, clusterSpread 0.07) and vary only canonicalArcCurve
    // and testamentBiasStrength.  Compare against "spine-noise-balanced" as baseline
    // (which inherits the defaults: curve=15, testamentBias=0.25).

    /** Global-structure subtle — default tuning values; gentle arch + soft OT/NT split. */
    "gs-subtle": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 15,
        testamentBiasStrength: 0.25,
    },
    /** Global-structure stronger OT/NT split — same arch, doubled vertical bias. */
    "gs-strong-split": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 15,
        testamentBiasStrength: 0.40,
    },
    /** Global-structure stronger arch — higher canonical midpoint, same OT/NT split. */
    "gs-strong-arch": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 25,
        testamentBiasStrength: 0.25,
    },
    // ---- Ring-breaking evaluation presets ----

    /**
     * Ring-breaking: both new mechanisms enabled at default tuning.
     * Compare against gs-baseline (which explicitly zeros all new params) to isolate
     * the combined effect of tangential noise + radial variation.
     */
    "gs-ring-break": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 15,
        testamentBiasStrength: 0.25,
        globalNoiseStrength: 0.35,
        globalNoiseScale: 1.2,
        radialVarianceStrength: 0.15,
    },
    /** Ring-breaking: noise only (no radial variation) — isolates the tangential field. */
    "gs-ring-break-noise-only": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 15,
        testamentBiasStrength: 0.25,
        globalNoiseStrength: 0.35,
        globalNoiseScale: 1.2,
        radialVarianceStrength: 0.0,
    },
    /** Ring-breaking: radial variation only — isolates the depth band effect. */
    "gs-ring-break-radial-only": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 15,
        testamentBiasStrength: 0.25,
        globalNoiseStrength: 0.0,
        globalNoiseScale: 1.2,
        radialVarianceStrength: 0.15,
    },

    /** Global-structure near-original — minimal curve and minimal vertical bias. */
    "gs-near-original": {
        strategy: "spine-noise",
        seed: 12345,
        discRadius: 2000,
        clusterSpread: 0.07,
        bookSizeAware: true,
        divisionBiasStrength: 0.6,
        globalFlowStrength: 0.5,
        canonicalArcCurve: 5,
        testamentBiasStrength: 0.10,
    },
};

/**
 * Change this to switch which experiment runs via `npm run experiment`.
 * Must be a key of EXPERIMENT_PRESETS.
 */
export const ACTIVE_EXPERIMENT: keyof typeof EXPERIMENT_PRESETS = "spine-noise-structured";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ExperimentResult {
    arrangement: StarArrangement;
    meta: ExperimentMeta;
    metrics: ArrangementMetrics;
}

export interface ExperimentMeta {
    strategy: string;
    config: ExperimentConfig;
    /** Total nodes with a position entry in the output arrangement. */
    positionedNodes: number;
    /** Breakdown by node level (1=division, 2=book, 3=chapter). */
    byLevel: Record<number, number>;
    /** Wall-clock ms for the generation call only. */
    elapsedMs: number;
    /**
     * Start angles (radians) of division wedges in canonical order.
     * Only present for the "spherical" strategy.
     */
    divisionBoundaries?: number[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run an experiment with the given config and return the arrangement plus
 * debug metadata. Accepts any BibleJSON input.
 *
 * @example
 * const result = runExperiment(bibleData, EXPERIMENT_PRESETS["spherical-default"]);
 * console.log(result.meta);
 */
export function runExperiment(bible: BibleJSON, config: ExperimentConfig): ExperimentResult {
    const t0 = performance.now();

    let arrangement: StarArrangement;
    let divisionBoundaries: number[] | undefined;

    if (config.strategy === "spherical") {
        const model = bibleToSceneModel(bible);
        const result = computeSphericalArrangement(model, { radius: config.radius ?? 2000 });
        arrangement = result.arrangement;
        divisionBoundaries = result.divisionBoundaries;
    } else {
        // SpineNoiseConfig — strategy key is not part of GenerateOptions; it's ignored at runtime.
        arrangement = generateArrangement(bible, config);
    }

    const elapsedMs = performance.now() - t0;

    // Compute per-level breakdown from the arrangement keys.
    // Key format: "T:…" (level 0/testament), "D:…" (level 1/division),
    // "B:…" (level 2/book), "C:…" (level 3/chapter).
    const byLevel: Record<number, number> = {};
    for (const id of Object.keys(arrangement)) {
        const level = id.startsWith("T:") ? 0
            : id.startsWith("D:") ? 1
            : id.startsWith("B:") ? 2
            : id.startsWith("C:") ? 3
            : -1;
        byLevel[level] = (byLevel[level] ?? 0) + 1;
    }

    return {
        arrangement,
        meta: {
            strategy: config.strategy,
            config,
            positionedNodes: Object.keys(arrangement).length,
            byLevel,
            elapsedMs,
            divisionBoundaries,
        },
        metrics: evaluateArrangement(arrangement, bible),
    };
}

// ---------------------------------------------------------------------------
// Convenience: run the active preset
// ---------------------------------------------------------------------------

/**
 * Run whichever preset ACTIVE_EXPERIMENT names.
 * Useful in scripts: `import { runActiveExperiment } from "../src/arrangement/experiment"`.
 */
export function runActiveExperiment(bible: BibleJSON): ExperimentResult {
    const config = EXPERIMENT_PRESETS[ACTIVE_EXPERIMENT];
    if (!config) throw new Error(`Unknown experiment preset: "${ACTIVE_EXPERIMENT}"`);
    return runExperiment(bible, config);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Scalar difference (B − A) for each global metric. Positive = B is higher. */
export interface MetricDeltas {
    orderContinuity: number;
    clusterTightness: number;
    clusterSeparation: number;
    divisionSeparation: number;
    chapterSpread: number;
}

export interface ComparisonResult {
    a: ExperimentMeta;
    b: ExperimentMeta;
    metricsA: ArrangementMetrics;
    metricsB: ArrangementMetrics;
    /** B − A for each scalar metric. Positive = B scores higher. */
    metricDeltas: MetricDeltas;
    /** Node IDs present in both arrangements. */
    shared: number;
    /** Node IDs only in arrangement A (not covered by B). */
    onlyInA: string[];
    /** Node IDs only in arrangement B (not covered by A). */
    onlyInB: string[];
    distances: {
        mean: number;
        median: number;
        max: number;
        /** Up to 10 most-divergent shared nodes, sorted descending by distance. */
        outliers: Array<{ id: string; distance: number }>;
    };
}

/**
 * Run two experiments against the same bible and compare their arrangements.
 *
 * @example
 * const cmp = compareExperiments(bible,
 *   EXPERIMENT_PRESETS["spherical-default"],
 *   EXPERIMENT_PRESETS["spine-noise-default"],
 * );
 * console.log(cmp.distances.mean, cmp.onlyInA);
 */
export function compareExperiments(
    bible: BibleJSON,
    configA: ExperimentConfig,
    configB: ExperimentConfig,
): ComparisonResult {
    const resultA = runExperiment(bible, configA);
    const resultB = runExperiment(bible, configB);

    const arrA = resultA.arrangement;
    const arrB = resultB.arrangement;

    const idsA = new Set(Object.keys(arrA));
    const idsB = new Set(Object.keys(arrB));

    const onlyInA = [...idsA].filter(id => !idsB.has(id));
    const onlyInB = [...idsB].filter(id => !idsA.has(id));
    const sharedIds = [...idsA].filter(id => idsB.has(id));

    // Compute Euclidean distance for each shared node.
    const dists: Array<{ id: string; distance: number }> = [];
    for (const id of sharedIds) {
        const posA = arrA[id]?.position;
        const posB = arrB[id]?.position;
        if (!posA || !posB) continue;
        const dx = posA[0] - posB[0];
        const dy = posA[1] - posB[1];
        const dz = posA[2] - posB[2];
        dists.push({ id, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }

    dists.sort((a, b) => b.distance - a.distance);

    const values = dists.map(d => d.distance);
    const mean = values.length > 0
        ? values.reduce((s, v) => s + v, 0) / values.length
        : 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length === 0 ? 0
        : sorted.length % 2 === 1 ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;

    const mA = resultA.metrics;
    const mB = resultB.metrics;

    return {
        a: resultA.meta,
        b: resultB.meta,
        metricsA: mA,
        metricsB: mB,
        metricDeltas: {
            orderContinuity:    mB.orderContinuity    - mA.orderContinuity,
            clusterTightness:   mB.clusterTightness   - mA.clusterTightness,
            clusterSeparation:  mB.clusterSeparation  - mA.clusterSeparation,
            divisionSeparation: mB.divisionSeparation - mA.divisionSeparation,
            chapterSpread:      mB.chapterSpread       - mA.chapterSpread,
        },
        shared: sharedIds.length,
        onlyInA,
        onlyInB,
        distances: {
            mean,
            median,
            max: dists[0]?.distance ?? 0,
            outliers: dists.slice(0, 10),
        },
    };
}
