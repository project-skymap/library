/**
 * Arrangement quality metrics.
 *
 * All metrics are computed from a StarArrangement + BibleJSON — no Three.js.
 * Lower orderContinuity = chapters flow in canonical arc order.
 * Lower clusterTightness = chapters stay close to their book anchor.
 * Higher clusterSeparation / divisionSeparation = books / divisions spread apart.
 * Higher chapterSpread = good use of the full sky.
 */

import type { BibleJSON } from "../adapters/bible";
import type { StarArrangement } from "../types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type P3 = [number, number, number];

function dist(a: P3, b: P3): number {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function centroid(pts: P3[]): P3 {
    if (pts.length === 0) return [0, 0, 0];
    let x = 0, y = 0, z = 0;
    for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
    return [x / pts.length, y / pts.length, z / pts.length];
}

function mean(xs: number[]): number {
    return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
    if (xs.length === 0) return 0;
    const m = mean(xs);
    return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

/** Mean of all pairwise distances between a set of points. O(n²). */
function meanPairwiseDist(pts: P3[]): number {
    if (pts.length < 2) return 0;
    const dists: number[] = [];
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            dists.push(dist(pts[i]!, pts[j]!));
        }
    }
    return mean(dists);
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface BookMetrics {
    /** e.g. "B:GEN" */
    id: string;
    /** e.g. "Genesis" */
    label: string;
    chapterCount: number;
    /** Mean position of all chapter positions. */
    centroid: P3;
    /**
     * Max distance from centroid to any chapter — the bounding radius of the cluster.
     * Lower = tighter.
     */
    clusterRadius: number;
    /**
     * Mean distance from centroid to each chapter.
     * Lower = chapters hug the book anchor.
     */
    clusterTightness: number;
    /**
     * Mean distance between consecutive chapters (chapter N → N+1).
     * Lower = chapters form a continuous arc; higher = scattered order.
     */
    orderContinuity: number;
    /** Number of chapters that had no position in the arrangement. */
    missingChapters: number;
}

export interface DivisionMetrics {
    /** e.g. "D:Old Testament:Pentateuch" */
    id: string;
    label: string;
    bookCount: number;
    centroid: P3;
}

export interface ArrangementMetrics {
    // --- Global ---

    /**
     * Mean consecutive-chapter distance across all books.
     * Lower = canonical order preserved spatially.
     */
    orderContinuity: number;

    /**
     * Mean intra-book distance (mean distance from each chapter to its book centroid).
     * Lower = tighter clusters.
     */
    clusterTightness: number;

    /**
     * Mean pairwise distance between all book centroids.
     * Higher = books well separated from each other.
     */
    clusterSeparation: number;

    /**
     * Mean pairwise distance between all division centroids.
     * Higher = divisions occupy distinct sky regions.
     */
    divisionSeparation: number;

    /**
     * Standard deviation of chapter distances from the global chapter centroid.
     * Higher = chapters spread evenly across the sky rather than clumping.
     */
    chapterSpread: number;

    /** Number of chapter IDs that appeared in the bible but had no position. */
    missingChapters: number;

    /**
     * Mean Y-coordinate of book centroids, keyed by testament name.
     * Gives a macro readout of vertical sky separation between testaments.
     * On a discRadius=2000 sphere the Y range is roughly 20–1800 (above horizon).
     */
    testamentMeanY: Record<string, number>;

    // --- Per-entity ---
    books: BookMetrics[];
    divisions: DivisionMetrics[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function evaluateArrangement(
    arrangement: StarArrangement,
    bible: BibleJSON,
): ArrangementMetrics {
    const bookMetrics: BookMetrics[] = [];
    const divisionMetrics: DivisionMetrics[] = [];
    const allChapterPositions: P3[] = [];
    let totalMissingChapters = 0;

    // Per-testament book centroid Y values — for testamentMeanY macro metric.
    const testamentBookCentroidYs: Record<string, number[]> = {};

    for (const testament of bible.testaments) {
        testamentBookCentroidYs[testament.name] = [];

        for (const division of testament.divisions) {
            const divId = `D:${testament.name}:${division.name}`;
            const divBookCentroids: P3[] = [];

            for (const book of division.books) {
                const bookId = `B:${book.key}`;
                const chapterPositions: P3[] = [];
                let missing = 0;

                for (let ch = 1; ch <= book.chapters; ch++) {
                    const pos = arrangement[`C:${book.key}:${ch}`]?.position;
                    if (pos) {
                        chapterPositions.push(pos);
                        allChapterPositions.push(pos);
                    } else {
                        missing++;
                        totalMissingChapters++;
                    }
                }

                const c = centroid(chapterPositions);
                const radii = chapterPositions.map(p => dist(c, p));

                // Consecutive-chapter distances (chapters already in canonical order 1..N)
                const consecutiveDists: number[] = [];
                for (let i = 1; i < chapterPositions.length; i++) {
                    consecutiveDists.push(dist(chapterPositions[i - 1]!, chapterPositions[i]!));
                }

                bookMetrics.push({
                    id: bookId,
                    label: book.name,
                    chapterCount: book.chapters,
                    centroid: c,
                    clusterRadius: radii.length > 0 ? Math.max(...radii) : 0,
                    clusterTightness: mean(radii),
                    orderContinuity: mean(consecutiveDists),
                    missingChapters: missing,
                });

                if (chapterPositions.length > 0) {
                    divBookCentroids.push(c);
                    testamentBookCentroidYs[testament.name]!.push(c[1]);
                }
            }

            divisionMetrics.push({
                id: divId,
                label: division.name,
                bookCount: division.books.length,
                centroid: centroid(divBookCentroids),
            });
        }
    }

    // Global aggregates
    const orderContinuity = mean(bookMetrics.map(b => b.orderContinuity).filter(v => v > 0));
    const clusterTightness = mean(bookMetrics.map(b => b.clusterTightness).filter(v => v > 0));
    const bookCentroids = bookMetrics.map(b => b.centroid);
    const clusterSeparation = meanPairwiseDist(bookCentroids);
    const divCentroids = divisionMetrics.map(d => d.centroid);
    const divisionSeparation = meanPairwiseDist(divCentroids);

    const globalCentroid = centroid(allChapterPositions);
    const chapterSpread = stddev(allChapterPositions.map(p => dist(p, globalCentroid)));

    const testamentMeanY: Record<string, number> = {};
    for (const [t, ys] of Object.entries(testamentBookCentroidYs)) {
        testamentMeanY[t] = mean(ys);
    }

    return {
        orderContinuity,
        clusterTightness,
        clusterSeparation,
        divisionSeparation,
        chapterSpread,
        missingChapters: totalMissingChapters,
        testamentMeanY,
        books: bookMetrics,
        divisions: divisionMetrics,
    };
}
