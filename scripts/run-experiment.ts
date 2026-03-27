/**
 * Run an arrangement experiment and write the output to experiment-output.json.
 *
 * Switch the active experiment by editing ACTIVE_EXPERIMENT in
 * src/arrangement/experiment.ts, then re-run:
 *
 *   npm run experiment
 *
 * To compare two presets back-to-back, pass a preset name as an argument:
 *
 *   npm run experiment -- spherical-default
 *   npm run experiment -- spine-noise-tight-clusters
 */

import fs from "fs";
import path from "path";
import {
    ACTIVE_EXPERIMENT,
    EXPERIMENT_PRESETS,
    runExperiment,
} from "../src/arrangement/experiment";
import type { BibleJSON } from "../src/adapters/bible";

function loadBible(): BibleJSON {
    const candidates = [
        path.resolve(process.cwd(), "../builder/public/bible.json"),
        path.resolve(process.cwd(), "builder/public/bible.json"),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, "utf-8")) as BibleJSON;
        }
    }
    console.error("Could not find bible.json. Searched:");
    candidates.forEach(p => console.error("  " + p));
    process.exit(1);
}

function main() {
    const bible = loadBible();

    // Allow overriding the preset via CLI argument, e.g. `-- spine-noise-default`
    const presetArg = process.argv[2];
    const presetKey = presetArg ?? ACTIVE_EXPERIMENT;

    const config = EXPERIMENT_PRESETS[presetKey];
    if (!config) {
        console.error(`Unknown preset: "${presetKey}"`);
        console.error("Available presets:");
        Object.keys(EXPERIMENT_PRESETS).forEach(k => console.error("  " + k));
        process.exit(1);
    }

    console.log(`Experiment: "${presetKey}"`);
    console.log("Config:", JSON.stringify(config, null, 2));

    const result = runExperiment(bible, config);
    const { meta } = result;

    console.log("\n--- Results ---");
    console.log(`Strategy:         ${meta.strategy}`);
    console.log(`Positioned nodes: ${meta.positionedNodes}`);
    console.log(`  Testaments:     ${meta.byLevel[0] ?? 0}`);
    console.log(`  Divisions:      ${meta.byLevel[1] ?? 0}`);
    console.log(`  Books:          ${meta.byLevel[2] ?? 0}`);
    console.log(`  Chapters:       ${meta.byLevel[3] ?? 0}`);
    console.log(`Elapsed:          ${meta.elapsedMs.toFixed(2)} ms`);

    if (meta.divisionBoundaries && meta.divisionBoundaries.length > 0) {
        console.log(`\nDivision boundaries (${meta.divisionBoundaries.length}):`);
        meta.divisionBoundaries.forEach((b, i) => {
            const deg = (b * 180 / Math.PI).toFixed(1);
            console.log(`  [${i}] ${deg}°`);
        });
    }

    // Sample a few positions across hierarchy levels
    const sampleIds = ["T:Old Testament", "D:Old Testament:Pentateuch", "B:GEN", "C:GEN:1", "C:PSA:1"];
    const found = sampleIds.filter(id => result.arrangement[id]);
    if (found.length > 0) {
        console.log("\nSample positions:");
        for (const id of found) {
            const pos = result.arrangement[id]!.position;
            if (pos) {
                const fmt = pos.map(n => n.toFixed(0).padStart(6)).join(", ");
                console.log(`  ${id.padEnd(30)} [${fmt}]`);
            }
        }
    }

    // Quality metrics
    const m = result.metrics;
    console.log("\n--- Quality Metrics ---");
    console.log(`  orderContinuity    ${m.orderContinuity.toFixed(1).padStart(8)}   (avg step between consecutive chapters; lower = order preserved)`);
    console.log(`  clusterTightness   ${m.clusterTightness.toFixed(1).padStart(8)}   (avg chapter dist from book centroid; lower = tighter clusters)`);
    console.log(`  clusterSeparation  ${m.clusterSeparation.toFixed(1).padStart(8)}   (avg dist between book centroids; higher = better separation)`);
    console.log(`  divisionSeparation ${m.divisionSeparation.toFixed(1).padStart(8)}   (avg dist between division centroids; higher = distinct regions)`);
    console.log(`  chapterSpread      ${m.chapterSpread.toFixed(1).padStart(8)}   (std dev of chapter distances from global centroid; higher = full sky)`);
    if (m.missingChapters > 0) console.log(`  missingChapters    ${m.missingChapters.toString().padStart(8)}   (chapters with no position)`);

    // Testament vertical separation
    const testamentNames = Object.keys(m.testamentMeanY);
    if (testamentNames.length > 0) {
        console.log("\n--- Testament Mean Y (macro altitude, radius ~2000) ---");
        for (const t of testamentNames) {
            const y = m.testamentMeanY[t]!;
            console.log(`  ${t.padEnd(22)} meanY=${y.toFixed(0).padStart(5)}`);
        }
        if (testamentNames.length === 2) {
            const [tA, tB] = testamentNames as [string, string];
            const sep = (m.testamentMeanY[tA]! - m.testamentMeanY[tB]!);
            console.log(`  OT−NT Y separation   ${sep.toFixed(0).padStart(5)}   (positive = OT higher; target: 50–200 for subtle feel)`);
        }
    }

    // Bottom 5 books by cluster tightness (most scattered)
    const worst = [...m.books].sort((a, b) => b.clusterTightness - a.clusterTightness).slice(0, 5);
    console.log("\nLoosest clusters (high clusterTightness):");
    for (const b of worst) {
        console.log(`  ${b.label.padEnd(20)} tightness=${b.clusterTightness.toFixed(0).padStart(5)}  orderCont=${b.orderContinuity.toFixed(0).padStart(5)}  chapters=${b.chapterCount}`);
    }

    // Write full output
    const outPath = path.resolve(process.cwd(), "experiment-output.json");
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\nFull output written to: ${outPath}`);
}

main();
