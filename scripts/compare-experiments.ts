/**
 * Compare two arrangement experiments side by side.
 *
 * Usage:
 *   npm run experiment:compare -- <presetA> <presetB>
 *
 * Examples:
 *   npm run experiment:compare -- spherical-default spine-noise-default
 *   npm run experiment:compare -- spine-noise-tight-clusters spine-noise-wide-clusters
 *
 * Defaults to comparing "spherical-default" vs "spine-noise-default" if no args given.
 */

import fs from "fs";
import path from "path";
import {
    EXPERIMENT_PRESETS,
    compareExperiments,
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

function resolvePreset(key: string) {
    const config = EXPERIMENT_PRESETS[key];
    if (!config) {
        console.error(`Unknown preset: "${key}"`);
        console.error("Available presets:");
        Object.keys(EXPERIMENT_PRESETS).forEach(k => console.error("  " + k));
        process.exit(1);
    }
    return config;
}

function fmt(n: number) { return n.toFixed(1).padStart(8); }

function main() {
    const bible = loadBible();

    const keyA = process.argv[2] ?? "spherical-default";
    const keyB = process.argv[3] ?? "spine-noise-default";

    const configA = resolvePreset(keyA);
    const configB = resolvePreset(keyB);

    console.log(`Comparing "${keyA}" vs "${keyB}"\n`);

    const cmp = compareExperiments(bible, configA, configB);

    // Header
    const col = (s: string) => s.padEnd(28);
    console.log(`${"Metric".padEnd(28)}  ${"A: " + keyA}  /  ${"B: " + keyB}`);
    console.log("-".repeat(72));

    console.log(`${col("Strategy")}  ${cmp.a.strategy.padEnd(14)}  /  ${cmp.b.strategy}`);
    console.log(`${col("Positioned nodes")}  ${String(cmp.a.positionedNodes).padEnd(14)}  /  ${cmp.b.positionedNodes}`);
    console.log(`${col("Elapsed (ms)")}  ${cmp.a.elapsedMs.toFixed(2).padEnd(14)}  /  ${cmp.b.elapsedMs.toFixed(2)}`);

    console.log("");
    console.log(`${col("Shared node IDs")}  ${cmp.shared}`);
    console.log(`${col("Only in A")}  ${cmp.onlyInA.length}${cmp.onlyInA.length > 0 ? "  " + cmp.onlyInA.slice(0, 3).join(", ") + (cmp.onlyInA.length > 3 ? " …" : "") : ""}`);
    console.log(`${col("Only in B")}  ${cmp.onlyInB.length}${cmp.onlyInB.length > 0 ? "  " + cmp.onlyInB.slice(0, 3).join(", ") + (cmp.onlyInB.length > 3 ? " …" : "") : ""}`);

    console.log("");
    console.log("Position distances (shared nodes, radius ~2000):");
    console.log(`  Mean:    ${fmt(cmp.distances.mean)}`);
    console.log(`  Median:  ${fmt(cmp.distances.median)}`);
    console.log(`  Max:     ${fmt(cmp.distances.max)}`);

    if (cmp.distances.outliers.length > 0) {
        console.log("\nTop divergent nodes:");
        for (const { id, distance } of cmp.distances.outliers) {
            const level = id.startsWith("T:") ? "testament"
                : id.startsWith("D:") ? "division "
                : id.startsWith("B:") ? "book     "
                : "chapter  ";
            console.log(`  ${level}  ${id.padEnd(30)}  ${fmt(distance)}`);
        }
    }

    // Quality metrics side-by-side + deltas
    console.log("\n--- Quality Metrics ---");
    const sign = (n: number) => n > 0 ? "+" : "";
    const metricRow = (label: string, a: number, b: number, delta: number, note: string) => {
        const arrow = Math.abs(delta) < 0.5 ? "  ≈" : delta > 0 ? "  ↑" : "  ↓";
        console.log(`  ${label.padEnd(20)} A:${fmt(a)}   B:${fmt(b)}   Δ:${(sign(delta) + delta.toFixed(1)).padStart(8)}${arrow}   ${note}`);
    };
    const mA = cmp.metricsA;
    const mB = cmp.metricsB;
    const d  = cmp.metricDeltas;
    metricRow("orderContinuity",    mA.orderContinuity,    mB.orderContinuity,    d.orderContinuity,    "lower = order preserved");
    metricRow("clusterTightness",   mA.clusterTightness,   mB.clusterTightness,   d.clusterTightness,   "lower = tighter clusters");
    metricRow("clusterSeparation",  mA.clusterSeparation,  mB.clusterSeparation,  d.clusterSeparation,  "higher = better separation");
    metricRow("divisionSeparation", mA.divisionSeparation, mB.divisionSeparation, d.divisionSeparation, "higher = distinct regions");
    metricRow("chapterSpread",      mA.chapterSpread,      mB.chapterSpread,      d.chapterSpread,      "higher = full sky coverage");

    if (cmp.a.divisionBoundaries) {
        console.log(`\nA division boundaries (${cmp.a.divisionBoundaries.length}): `
            + cmp.a.divisionBoundaries.map(b => (b * 180 / Math.PI).toFixed(1) + "°").join("  "));
    }

    // Write full comparison to file
    const outPath = path.resolve(process.cwd(), "experiment-comparison.json");
    fs.writeFileSync(outPath, JSON.stringify(cmp, null, 2));
    console.log(`\nFull comparison written to: ${outPath}`);
}

main();
