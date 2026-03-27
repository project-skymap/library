/**
 * Spherical arrangement strategy.
 *
 * Places books on a sphere by distributing canonical biblical order across
 * angular wedges (one per division), proportional to verse-count weight.
 * Chapters are arranged in book-specific constellation shapes, tangent to
 * the sphere surface at each book anchor.
 *
 * No Three.js dependency — uses src/arrangement/math.ts and src/arrangement/shapes.ts.
 *
 * Previously extracted from src/engine/layout.ts (spherical mode), now the canonical arrangement source.
 */

import type { SceneModel, SceneNode, StarArrangement } from "../../types";
import { vec3, clone, add, normalized, multiplyScalar, length, lengthSq, cross, type Vec3 } from "../math";
import { getConstellationLayout, type Point3D } from "../shapes";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface SphericalResult {
    /** Positions for all nodes, keyed by node id. */
    arrangement: StarArrangement;
    /**
     * Start angles (radians) for each division wedge, in traversal order.
     * Used by the engine to render division boundary lines.
     * This is a rendering hint; it is not part of the arrangement contract.
     */
    divisionBoundaries: number[];
}

// ---------------------------------------------------------------------------
// lookAt: rotate a local-space point tangent to the sphere at `target`
//
// Equivalent to THREE.Matrix4.makeBasis(xAxis, yAxis, zAxis).applyMatrix4(v).add(target).
// makeBasis stores axes as columns, so the application is:
//   result = xAxis*v.x + yAxis*v.y + zAxis*v.z + target
// ---------------------------------------------------------------------------

function lookAt(point: Point3D, target: Vec3, up: Vec3): Point3D {
    const zAxis = normalized(target);

    // Cross product of up × zAxis gives the right-axis; fall back if degenerate
    let xAxisRaw = cross(up, zAxis);
    if (lengthSq(xAxisRaw) < 0.0001) {
        xAxisRaw = cross(vec3(1, 0, 0), zAxis);
    }
    const xAxis = normalized(xAxisRaw);
    const yAxis = normalized(cross(zAxis, xAxis));

    return {
        x: xAxis[0] * point.x + yAxis[0] * point.y + zAxis[0] * point.z + target[0],
        y: xAxis[1] * point.x + yAxis[1] * point.y + zAxis[1] * point.z + target[1],
        z: xAxis[2] * point.x + yAxis[2] * point.y + zAxis[2] * point.z + target[2],
    };
}

// ---------------------------------------------------------------------------
// Hierarchy helpers
// ---------------------------------------------------------------------------

function buildChildrenMap(nodes: SceneNode[]): Map<string, SceneNode[]> {
    const map = new Map<string, SceneNode[]>();
    for (const n of nodes) {
        if (n.parent) {
            const list = map.get(n.parent) ?? [];
            list.push(n);
            map.set(n.parent, list);
        }
    }
    return map;
}

function computeWeights(roots: SceneNode[], childrenMap: Map<string, SceneNode[]>): Map<string, number> {
    const weights = new Map<string, number>();

    function getWeight(node: SceneNode): number {
        const children = childrenMap.get(node.id) ?? [];
        if (children.length === 0) {
            const w = node.weight ?? 1;
            weights.set(node.id, w);
            return w;
        }
        let sum = 0;
        for (const c of children) sum += getWeight(c);
        weights.set(node.id, sum);
        return sum;
    }

    for (const r of roots) getWeight(r);
    return weights;
}

// ---------------------------------------------------------------------------
// Main strategy function
// ---------------------------------------------------------------------------

export function computeSphericalArrangement(model: SceneModel, config: { radius: number }): SphericalResult {
    const { radius } = config;
    const arrangement: StarArrangement = {};
    const divisionBoundaries: number[] = [];

    const childrenMap = buildChildrenMap(model.nodes);
    const roots = model.nodes.filter(n => !n.parent);
    const books = model.nodes.filter(n => n.level === 2);
    const weights = computeWeights(roots, childrenMap);
    const totalWeight = roots.reduce((acc, r) => acc + (weights.get(r.id) ?? 0), 0);

    if (totalWeight === 0) return { arrangement, divisionBoundaries };

    // Track positions written for testament centroid calculation
    const positionById = new Map<string, Vec3>();

    let currentAngle = 0;
    const up: Vec3 = vec3(0, 1, 0);

    // Traverse: testament → division → book → chapter
    for (const testament of roots) {
        const divisions = childrenMap.get(testament.id) ?? [];

        for (const division of divisions) {
            const divWeight = weights.get(division.id) ?? 0;
            if (divWeight === 0) continue;

            const angleSpan = (divWeight / totalWeight) * Math.PI * 2;
            const startAngle = currentAngle;
            const midAngle = startAngle + angleSpan / 2;

            divisionBoundaries.push(startAngle);

            // Division label — just above the horizon at the mid-angle of its wedge
            {
                const y = 0.08;
                const radiusAtY = Math.sqrt(1 - y * y);
                const divPos = multiplyScalar(
                    vec3(Math.cos(midAngle) * radiusAtY, y, Math.sin(midAngle) * radiusAtY),
                    radius,
                );
                arrangement[division.id] = { position: [divPos[0], divPos[1], divPos[2]] };
                positionById.set(division.id, divPos);
            }

            const divBooks = childrenMap.get(division.id) ?? [];
            const numBooks = divBooks.length;

            for (let i = 0; i < divBooks.length; i++) {
                const book = divBooks[i]!;
                const bookKey = (book.meta?.bookKey as string | undefined) ?? "";

                const t = (i + 1) / (numBooks + 1);
                const y = 0.1 + t * 0.65;
                const radiusAtY = Math.sqrt(1 - y * y);
                const theta = startAngle + t * angleSpan;

                // Book position on the sphere surface
                const bookPos = multiplyScalar(
                    vec3(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY),
                    radius,
                );

                // Book label shifted slightly upward and snapped back to sphere
                const labelPos = clone(bookPos);
                labelPos[1] += radius * 0.025;
                const labelSnapped = multiplyScalar(normalized(labelPos), radius);

                arrangement[book.id] = {
                    position: [labelSnapped[0], labelSnapped[1], labelSnapped[2]],
                };
                positionById.set(book.id, bookPos); // store actual bookPos for chapter lookAt

                // Chapter constellation — local shape rotated tangent to sphere at bookPos
                const chapters = childrenMap.get(book.id) ?? [];
                if (chapters.length > 0) {
                    const territoryRadius = (radius * 2) / Math.sqrt(books.length * 2) * 0.7;
                    const localPoints = getConstellationLayout(bookKey, chapters.length, territoryRadius);

                    for (let ci = 0; ci < chapters.length; ci++) {
                        const chap = chapters[ci]!;
                        const lp = localPoints[ci];
                        if (!lp) continue;

                        const wp = lookAt(lp, bookPos, up);
                        arrangement[chap.id] = { position: [wp.x, wp.y, wp.z] };
                        positionById.set(chap.id, vec3(wp.x, wp.y, wp.z));
                    }
                }
            }

            currentAngle += angleSpan;
        }
    }

    // Testament labels — centroid of their division positions
    for (const testament of roots) {
        const divisions = childrenMap.get(testament.id) ?? [];
        if (divisions.length === 0) continue;

        const centroid = vec3(0, 0, 0);
        let count = 0;
        for (const div of divisions) {
            const p = positionById.get(div.id);
            if (p) {
                centroid[0] += p[0];
                centroid[1] += p[1];
                centroid[2] += p[2];
                count++;
            }
        }
        if (count === 0) continue;

        const avg = multiplyScalar(centroid, 1 / count);
        if (length(avg) > 0.1) {
            const testamentPos = multiplyScalar(normalized(avg), radius * 0.75);
            arrangement[testament.id] = {
                position: [testamentPos[0], testamentPos[1], testamentPos[2]],
            };
        }
    }

    return { arrangement, divisionBoundaries };
}
