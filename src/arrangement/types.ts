import type { BibleJSON } from "../adapters/bible";
import type { StarArrangement } from "../types";

/**
 * Input passed to every arrangement strategy.
 * Strategies must not receive or return Three.js objects.
 */
export interface ArrangementInput {
    bible: BibleJSON;
}

/**
 * An arrangement strategy takes a BibleJSON input and a config,
 * and returns a StarArrangement — a plain map of node id → position.
 *
 * Strategies must be:
 * - deterministic for a given config.seed
 * - free of Three.js dependencies
 * - unaware of rendering details
 *
 * StarArrangement lives in src/types.ts as the shared renderer boundary type.
 * It is not owned by this layer — it is consumed and returned by it.
 */
export interface ArrangementStrategy<TConfig extends Record<string, unknown> = Record<string, unknown>> {
    readonly name: string;
    generate(input: ArrangementInput, config: Partial<TConfig>): StarArrangement;
}
