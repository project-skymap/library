/**
 * Spine + Noise arrangement strategy.
 *
 * Places books along a density-weighted sphere, sorted to preserve approximate
 * canonical order, then clusters chapters around each book anchor.
 *
 * Deterministic from a given seed via a simple LCG RNG.
 * No Three.js dependency — uses src/arrangement/math.ts only.
 */

import type { BibleJSON } from "../../adapters/bible";
import type { StarArrangement } from "../../types";
import type { ArrangementStrategy, ArrangementInput } from "../types";
import { vec3, add, normalized, multiplyScalar, dot, degToRad, type Vec3 } from "../math";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GenerateOptions extends Record<string, unknown> {
    seed: number;
    discRadius: number;
    milkyWayEnabled: boolean;
    milkyWayAngle: number;      // degrees
    milkyWayWidth: number;      // width in dot-product space
    milkyWayStrength: number;   // 0..1 attraction to band
    noiseScale: number;
    noiseStrength: number;
    clusterSpread: number;      // radians, approx spread of chapters around book
    bookSizeAware: boolean;     // scale spread by sqrt(chapters/median); bounds [0.5, 1.5]

    // --- Large-scale structure ---
    // After the longitude sort, each book anchor is blended toward a canonical
    // arc target computed from its division's position on the arc and (optionally)
    // its individual position within the full book sequence.
    //
    // divisionBiasStrength=0 disables this step entirely (pure noise layout).
    // divisionBiasStrength=1 fully snaps every anchor to its arc target.
    // Values 0.4–0.7 give soft regional grouping while noise stays dominant.
    divisionBiasStrength: number; // fraction to blend toward arc target [0..1]
    globalFlowStrength: number;   // intra-division gradient: 0=division-only, 1=book-level arc
    canonicalArcLonStart: number; // arc start longitude (degrees)
    canonicalArcSpan: number;     // total arc angular span (degrees)
    canonicalArcLat: number;      // arc base latitude (degrees)

    // --- Global large-scale structure ---
    // canonicalArcCurve: the arc gently arches in latitude by this many degrees at its
    // midpoint (sin(t*π) envelope), so early and late canonical books sit at the base
    // latitude while the middle of the sequence peaks higher.  Creates a visible sky-arc
    // without straight lines.  0 = flat (original behaviour).
    canonicalArcCurve: number;    // peak latitude lift at arc midpoint (degrees)

    // testamentBiasStrength: after arc attraction, gently shift OT books upward (toward
    // zenith) and NT books downward (toward horizon).  Applied as a soft additive Y-bias
    // then re-normalised, so noise remains dominant locally.  0 = off.
    testamentBiasStrength: number; // magnitude of OT/NT vertical separation [0..1]

    // --- Spatial distribution (ring-breaking) ---
    //
    // globalNoiseStrength / globalNoiseScale: a low-frequency tangential displacement
    // field evaluated on the unit sphere.  Pushes groups of books off the canonical arc
    // in a spatially coherent way, so nearby-canonical books don't all land on the same
    // orbital path.  Scale < 1.5 keeps the field at division-group level; higher values
    // create more per-book variation.  0 = no displacement.
    globalNoiseStrength: number;   // tangential push magnitude on unit sphere [0..1]
    globalNoiseScale: number;      // spatial frequency of the field (lower = smoother groups)

    // radialVarianceStrength: each book anchor is placed at a slightly different depth
    // (actual 3D radius) so the arrangement projects to a band rather than a single ring
    // when viewed from the zenith.  Offset follows a smooth canonical-position wave plus
    // a small per-book RNG jitter.  0 = all books at discRadius exactly.
    // 0.15 = ±15% depth variation (books range from 0.85 × to 1.15 × discRadius).
    radialVarianceStrength: number; // max fractional radius offset [0..1]
}

export const defaultGenerateOptions: GenerateOptions = {
    seed: 12345,
    discRadius: 2000,
    milkyWayEnabled: true,
    milkyWayAngle: 60,
    milkyWayWidth: 0.3,
    milkyWayStrength: 0.7,
    noiseScale: 2.0,
    noiseStrength: 0.4,
    clusterSpread: 0.08,
    bookSizeAware: true,
    divisionBiasStrength: 0.6,
    globalFlowStrength: 0.3,
    canonicalArcLonStart: 20,
    canonicalArcSpan: 280,
    canonicalArcLat: 25,
    canonicalArcCurve: 15,
    testamentBiasStrength: 0.25,
    globalNoiseStrength: 0.35,
    globalNoiseScale: 1.2,
    radialVarianceStrength: 0.15,
};

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

class RNG {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    /** Returns 0..1 */
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    /** Uniform random on upper hemisphere (y >= 0). */
    randomOnSphere(): Vec3 {
        const y = this.next();
        const theta = 2 * Math.PI * this.next();
        const r = Math.sqrt(1 - y * y);
        return vec3(r * Math.cos(theta), y, r * Math.sin(theta));
    }
}

// ---------------------------------------------------------------------------
// Noise / Density
// ---------------------------------------------------------------------------

function simpleNoise3D(v: Vec3, scale: number): number {
    const s = scale;
    return (
        Math.sin(v[0] * s) +
        Math.sin(v[1] * s * 1.3) +
        Math.sin(v[2] * s * 1.7) +
        Math.sin(v[0] * s * 2.1 + v[1] * s * 2.1) * 0.5
    ) / 3.5;
}

function getDensity(v: Vec3, opts: GenerateOptions, mwNormal: Vec3): number {
    let density = 0.3;

    if (opts.milkyWayEnabled) {
        const d = Math.abs(dot(v, mwNormal));
        const band = Math.exp(-(d * d) / (opts.milkyWayWidth * opts.milkyWayWidth));
        density += band * opts.milkyWayStrength;
    }

    const noise = simpleNoise3D(v, opts.noiseScale);
    density *= (1.0 + noise * opts.noiseStrength);

    return Math.max(0.01, density);
}

/**
 * Returns a unit vector at parameter t ∈ [0,1] along the canonical arc.
 * The arc sweeps from canonicalArcLonStart to canonicalArcLonStart+canonicalArcSpan.
 * Latitude follows a gentle arch: base + sin(t·π)·canonicalArcCurve, so the midpoint
 * of the sequence peaks higher than either end.  Set canonicalArcCurve=0 for the
 * original flat arc.
 */
function arcTargetAt(t: number, opts: GenerateOptions): Vec3 {
    const lonRad = degToRad(opts.canonicalArcLonStart + t * opts.canonicalArcSpan);
    const archLift = Math.sin(t * Math.PI) * opts.canonicalArcCurve;
    const latRad = degToRad(opts.canonicalArcLat + archLift);
    const cosLat = Math.cos(latRad);
    return vec3(cosLat * Math.cos(lonRad), Math.sin(latRad), cosLat * Math.sin(lonRad));
}

// ---------------------------------------------------------------------------
// Core generation function
// ---------------------------------------------------------------------------

export function generateArrangement(bible: BibleJSON, options: Partial<GenerateOptions> = {}): StarArrangement {
    const opts: GenerateOptions = { ...defaultGenerateOptions, ...options };
    const rng = new RNG(opts.seed);
    const arrangement: StarArrangement = {};

    // 1. Collect all books in canonical order
    const books: {
        key: string;
        name: string;
        chapters: number;
        division: string;
        testament: string;
    }[] = [];

    bible.testaments.forEach(t => {
        t.divisions.forEach(d => {
            d.books.forEach(b => {
                books.push({
                    key: b.key,
                    name: b.name,
                    chapters: b.chapters,
                    division: d.name,
                    testament: t.name,
                });
            });
        });
    });

    const bookCount = books.length;

    // Milky Way plane normal
    const mwRad = degToRad(opts.milkyWayAngle);
    const mwNormal = normalized(vec3(Math.sin(mwRad), Math.cos(mwRad), 0));

    // Build canonical division order — used by the arc attraction step.
    // Divisions are listed in the order they first appear in the book sequence.
    const divisionOrder: string[] = [];
    const divisionIndexMap = new Map<string, number>();
    books.forEach(book => {
        const divId = `${book.testament}:${book.division}`;
        if (!divisionIndexMap.has(divId)) {
            divisionIndexMap.set(divId, divisionOrder.length);
            divisionOrder.push(divId);
        }
    });
    const divisionCount = divisionOrder.length;

    // Build canonical testament order — used by the testament altitude bias step.
    const testamentOrder: string[] = [];
    const testamentIndexMap = new Map<string, number>();
    books.forEach(book => {
        if (!testamentIndexMap.has(book.testament)) {
            testamentIndexMap.set(book.testament, testamentOrder.length);
            testamentOrder.push(book.testament);
        }
    });
    const testamentCount = testamentOrder.length;

    // 2. Generate book anchors via density-weighted rejection sampling
    const anchors: Vec3[] = [];

    for (let i = 0; i < bookCount; i++) {
        let bestP = vec3(0, 1, 0);
        let valid = false;
        let attempt = 0;

        while (!valid && attempt < 100) {
            const p = rng.randomOnSphere();
            const d = getDensity(p, opts, mwNormal);
            if (rng.next() < d) {
                bestP = p;
                valid = true;
            }
            attempt++;
        }
        if (!valid) bestP = rng.randomOnSphere();
        anchors.push(bestP);
    }

    // 3. Sort anchors by pseudo-longitude to preserve approximate canonical order
    anchors.sort((a, b) => Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]));

    // 3b. Post-sort arc attraction: blend each anchor toward its canonical arc target.
    //
    //     Each division is assigned an evenly-spaced position along the arc.
    //     Each book's target blends its division's position (coarse) with its
    //     individual canonical position (fine gradient), weighted by globalFlowStrength.
    //
    //     The slerp-like blend guarantees the bias has effect regardless of the
    //     underlying density, and preserves full determinism (no additional RNG calls).
    if (opts.divisionBiasStrength > 0) {
        for (let i = 0; i < bookCount; i++) {
            const book = books[i]!;
            const divIdx = divisionIndexMap.get(`${book.testament}:${book.division}`) ?? 0;
            const divisionT = divisionCount > 1 ? divIdx / (divisionCount - 1) : 0.5;
            const bookT = bookCount > 1 ? i / (bookCount - 1) : 0.5;
            const blendT = divisionT * (1 - opts.globalFlowStrength) + bookT * opts.globalFlowStrength;
            const target = arcTargetAt(blendT, opts);

            // Linear blend then re-normalise (equivalent to a slerp for moderate strengths)
            anchors[i] = normalized(add(
                multiplyScalar(anchors[i]!, 1 - opts.divisionBiasStrength),
                multiplyScalar(target, opts.divisionBiasStrength),
            ));
        }
    }

    // 3c. Testament altitude bias: gently separates OT and NT vertically.
    //     For each book the first testament (OT) gets a small positive Y push (toward
    //     zenith) and the last testament (NT) gets a small negative push (toward horizon).
    //     The bias is proportional to testamentBiasStrength; re-normalisation keeps the
    //     point on the unit sphere.  Noise from step 2 remains dominant locally.
    if (opts.testamentBiasStrength > 0 && testamentCount > 1) {
        for (let i = 0; i < bookCount; i++) {
            const book = books[i]!;
            const testIdx = testamentIndexMap.get(book.testament) ?? 0;
            // testamentT: 0 for first testament (OT), 1 for last (NT)
            const testamentT = testIdx / (testamentCount - 1);
            // biasY: +strength/2 for OT, -strength/2 for NT
            const biasY = (0.5 - testamentT) * opts.testamentBiasStrength;
            const biased = normalized(add(anchors[i]!, vec3(0, biasY, 0)));
            // Preserve above-horizon constraint
            anchors[i] = biased[1] < 0.01
                ? normalized(vec3(biased[0], 0.01, biased[2]))
                : biased;
        }
    }

    // 3d. Low-frequency tangential noise: displaces book anchors off the canonical arc
    //     in a group-coherent way.  The field is evaluated on the unit-sphere position
    //     of each anchor using a low-frequency version of the existing noise function.
    //     Displacement is projected onto the tangent plane so it moves books horizontally
    //     without changing their altitude — preserving the testament height separation
    //     while breaking the ring that forms when all books share the same orbital path.
    if (opts.globalNoiseStrength > 0) {
        const gs = opts.globalNoiseScale;
        for (let i = 0; i < bookCount; i++) {
            const a = anchors[i]!;
            // Two evaluations with rotated inputs give approximately orthogonal components.
            const nx = simpleNoise3D(a, gs);
            const nz = simpleNoise3D(vec3(a[2] * 0.9 + 0.37, a[0] * 0.9 - 0.28, a[1] * 0.9 + 0.19), gs);
            // Horizontal displacement only (Y=0 keeps altitude intact).
            const rawDisplace = vec3(nx, 0, nz);
            // Project out the radial component to stay on the sphere surface.
            const radialComp = dot(rawDisplace, a);
            const tangential = vec3(
                rawDisplace[0] - radialComp * a[0],
                rawDisplace[1] - radialComp * a[1],
                rawDisplace[2] - radialComp * a[2],
            );
            const displaced = add(a, multiplyScalar(tangential, opts.globalNoiseStrength));
            anchors[i] = displaced[1] < 0.01
                ? normalized(vec3(displaced[0], 0.01, displaced[2]))
                : normalized(displaced);
        }
    }

    // 3e. Radial variation: pre-compute a per-book actual depth (3D radius).
    //     Each book is placed at discRadius × (1 + radialOffset) rather than exactly
    //     at discRadius, so the arrangement projects to a natural band rather than a
    //     single ring when viewed from the zenith.
    //
    //     radialOffset = (smoothWave(bookT) × 0.7 + rngJitter × 0.3) × radialVarianceStrength
    //     smoothWave uses two overlapping sines giving ~3 depth peaks across the
    //     canonical sequence — large-scale variation, not per-book noise.
    //     The RNG jitter (0.3 weight) adds just enough individual variation so books
    //     in the same wave trough don't all collapse to the exact same radius.
    const bookRadii: number[] = [];
    if (opts.radialVarianceStrength > 0) {
        for (let i = 0; i < bookCount; i++) {
            const t = bookCount > 1 ? i / (bookCount - 1) : 0.5;
            const wave = Math.sin(t * Math.PI * 2.0) * 0.6
                       + Math.sin(t * Math.PI * 3.7 + 1.2) * 0.4;
            const jitter = rng.next() - 0.5;
            const offset = (wave * 0.7 + jitter * 0.3) * opts.radialVarianceStrength;
            bookRadii.push(opts.discRadius * (1 + offset));
        }
    } else {
        // Consume zero RNG calls but keep the array in sync.
        for (let i = 0; i < bookCount; i++) bookRadii.push(opts.discRadius);
    }

    // 4. Assign books and generate chapter clusters
    // Pre-compute median chapter count for book-size-aware spread scaling.
    const sortedCounts = books.map(b => b.chapters).sort((a, b) => a - b);
    const medianChapters = sortedCounts[Math.floor(sortedCounts.length / 2)]!;

    books.forEach((book, i) => {
        const anchor = anchors[i]!;
        const bookR = bookRadii[i] ?? opts.discRadius;
        const anchorPos = multiplyScalar(anchor, bookR);

        arrangement[`B:${book.key}`] = {
            position: [anchorPos[0], anchorPos[1], anchorPos[2]],
        };

        const sizeMultiplier = opts.bookSizeAware
            ? Math.min(1.5, Math.max(0.5, Math.sqrt(book.chapters / medianChapters)))
            : 1.0;
        const localSpread = opts.clusterSpread * sizeMultiplier * (0.8 + rng.next() * 0.4);

        for (let c = 0; c < book.chapters; c++) {
            const offset = normalized(
                vec3(
                    (rng.next() - 0.5) * 2,
                    (rng.next() - 0.5) * 2,
                    (rng.next() - 0.5) * 2,
                )
            );
            const scaled = multiplyScalar(offset, rng.next() * localSpread);
            let starDir = normalized(add(anchor, scaled));

            // Ensure above horizon
            if (starDir[1] < 0.01) {
                starDir[1] = 0.01;
                starDir = normalized(starDir);
            }

            const starPos = multiplyScalar(starDir, bookR);
            arrangement[`C:${book.key}:${c + 1}`] = {
                position: [starPos[0], starPos[1], starPos[2]],
            };
        }
    });

    // 5. Division anchors as centroids of their book anchors
    const divisions = new Map<string, { sum: Vec3; count: number }>();

    books.forEach((book, i) => {
        const anchorPos = multiplyScalar(anchors[i]!, opts.discRadius);
        const divId = `D:${book.testament}:${book.division}`;

        if (!divisions.has(divId)) {
            divisions.set(divId, { sum: vec3(0, 0, 0), count: 0 });
        }
        const entry = divisions.get(divId)!;
        entry.sum[0] += anchorPos[0];
        entry.sum[1] += anchorPos[1];
        entry.sum[2] += anchorPos[2];
        entry.count++;
    });

    divisions.forEach((val, key) => {
        if (val.count > 0) {
            const centroid = multiplyScalar(
                normalized(multiplyScalar(val.sum, 1 / val.count)),
                opts.discRadius * 0.9,
            );
            arrangement[key] = {
                position: [centroid[0], centroid[1], centroid[2]],
            };
        }
    });

    return arrangement;
}

// ---------------------------------------------------------------------------
// Strategy object (implements ArrangementStrategy interface)
// ---------------------------------------------------------------------------

export const spineNoiseStrategy: ArrangementStrategy<GenerateOptions> = {
    name: "spine-noise",
    generate(input: ArrangementInput, config: Partial<GenerateOptions>): StarArrangement {
        return generateArrangement(input.bible, config);
    },
};
