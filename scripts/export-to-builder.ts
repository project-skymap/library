/**
 * Run the active experiment and write its arrangement to builder/app/arrangement.json.
 *
 * Switch which experiment is exported by editing ACTIVE_EXPERIMENT in
 * src/arrangement/experiment.ts, then re-run:
 *
 *   npm run experiment:export
 *
 * Then hard-reload the builder (Cmd+Shift+R) to see the new arrangement.
 */

import fs from "fs";
import path from "path";
import { ACTIVE_EXPERIMENT, EXPERIMENT_PRESETS, runExperiment } from "../src/arrangement/experiment";
import type { BibleJSON } from "../src/adapters/bible";

const BIBLE_PATH = path.resolve(process.cwd(), "../builder/public/bible.json");
const OUT_PATH   = path.resolve(process.cwd(), "../builder/app/arrangement.json");

if (!fs.existsSync(BIBLE_PATH)) {
    console.error(`bible.json not found at ${BIBLE_PATH}`);
    process.exit(1);
}

const bible = JSON.parse(fs.readFileSync(BIBLE_PATH, "utf-8")) as BibleJSON;

const presetKey = process.argv[2] ?? ACTIVE_EXPERIMENT;
const config = EXPERIMENT_PRESETS[presetKey];
if (!config) {
    console.error(`Unknown preset: "${presetKey}"`);
    console.error("Available:", Object.keys(EXPERIMENT_PRESETS).join(", "));
    process.exit(1);
}

console.log(`Running experiment: "${presetKey}"`);
const result = runExperiment(bible, config);
const { meta } = result;

fs.writeFileSync(OUT_PATH, JSON.stringify(result.arrangement, null, 2));

console.log(`Written to: ${OUT_PATH}`);
console.log(`  Strategy:         ${meta.strategy}`);
console.log(`  Positioned nodes: ${meta.positionedNodes}  (divisions: ${meta.byLevel[1] ?? 0}, books: ${meta.byLevel[2] ?? 0}, chapters: ${meta.byLevel[3] ?? 0})`);
console.log(`  Elapsed:          ${meta.elapsedMs.toFixed(2)} ms`);
console.log(`\nHard-reload the builder to apply (Cmd+Shift+R).`);
