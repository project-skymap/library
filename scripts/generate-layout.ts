import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as d3 from 'd3';
// @ts-ignore
import * as d3VoronoiTreemap from 'd3-voronoi-treemap';
import seedrandom from 'seedrandom';
import { getConstellationShape } from './constellations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIBLE_PATH = path.resolve(__dirname, '../../builder/public/bible.json');
const OUTPUT_PATH = path.resolve(__dirname, '../../builder/app/arrangement-2d.json');

// Configuration
const LAYOUT_RADIUS = 1000; // Working radius for Voronoi
const SEED = 'project-skymap-layout-v1';

// Types
interface Book {
    key: string;
    name: string;
    chapters: number;
    verses: number[];
}
interface Division {
    name: string;
    books: Book[];
}
interface Testament {
    name: string;
    divisions: Division[];
}
interface BibleData {
    testaments: Testament[];
}

interface HierarchyNode {
    name: string;
    key?: string; // For books
    value?: number; // Verse count
    children?: HierarchyNode[];
    bookData?: Book;
}

// Main
async function generate() {
    console.log("Loading Bible Data...");
    const bibleRaw = fs.readFileSync(BIBLE_PATH, 'utf-8');
    const bibleData = JSON.parse(bibleRaw) as BibleData;

    console.log("Building Hierarchy...");
    const rootData: HierarchyNode = {
        name: "Bible",
        children: bibleData.testaments.map(t => ({
            name: t.name,
            children: t.divisions.map(d => ({
                name: d.name,
                children: d.books.map(b => ({
                    name: b.name,
                    key: b.key,
                    value: b.verses.reduce((acc, v) => acc + v, 0),
                    bookData: b
                }))
            }))
        }))
    };

    const root = d3.hierarchy(rootData)
        .sum(d => d.value || 0);

    console.log("Computing Voronoi Treemap...");
    
    // Ordered Initialization Strategy
    // We pre-calculate a queue of (x, y) coordinates (0-1 normalized)
    // to guide the initial placement of sites in a clockwise spiral/circle.
    const layoutQueue: number[] = [];
    buildLayoutQueue(root, layoutQueue);
    
    // Create a PRNG that consumes the queue first, then falls back to seeded random
    const orderedPrng = createOrderedPrng(layoutQueue, SEED);
    
    // Create the Voronoi Treemap layout
    const voronoi = d3VoronoiTreemap.voronoiTreemap()
        .clip(getCirclePolygon(LAYOUT_RADIUS, 128))
        .prng(orderedPrng);

    voronoi(root);

    const output: Record<string, { pos: [number, number] }> = {};
    const polygons: Record<string, [number, number][]> = {};

    console.log("Placing Constellations...");
    const leaves = root.leaves();
    
    for (const leaf of leaves) {
        if (!leaf.data.key || !leaf.polygon) continue;
        const bookKey = leaf.data.key;
        const bookData = leaf.data.bookData!;
        const polygon = leaf.polygon;

        // Save Polygon
        polygons[bookKey] = polygon.map(p => [
            Number((p[0] / LAYOUT_RADIUS).toFixed(5)),
            Number((p[1] / LAYOUT_RADIUS).toFixed(5))
        ]);

        // 1. Calculate Centroid
        const centroid = d3.polygonCentroid(polygon);
        
        // Output Book Position (Centroid)
        const bCx = centroid[0] / LAYOUT_RADIUS;
        const bCy = centroid[1] / LAYOUT_RADIUS;
        output[`B:${bookKey}`] = { pos: [Number(bCx.toFixed(5)), Number(bCy.toFixed(5))] };
        
        // 2. Calculate Scale (Min distance to edge)
        let minDist = Infinity;
        for (let i = 0; i < polygon.length; i++) {
            const p1 = polygon[i];
            const p2 = polygon[(i + 1) % polygon.length];
            const dist = distToSegment(centroid, p1, p2);
            if (dist < minDist) minDist = dist;
        }
        
        // Constellation Size
        const paddingFactor = 0.8;
        const targetRadius = minDist * paddingFactor;

        // 3. Get Shape
        const numChapters = bookData.chapters;
        const shapePoints = getConstellationShape(bookKey, numChapters);

        // 4. Map Shape to Polygon
        shapePoints.forEach((pt, i) => {
            // pt is roughly unit scale. Scale to targetRadius.
            const xLocal = pt[0] * targetRadius;
            const yLocal = pt[1] * targetRadius;
            
            // Global (Layout) Coordinates
            const xGlobal = centroid[0] + xLocal;
            const yGlobal = centroid[1] + yLocal;
            
            // Normalize to Output Space [-1, 1]
            const xNorm = xGlobal / LAYOUT_RADIUS;
            const yNorm = yGlobal / LAYOUT_RADIUS; 
            
            const key = `C:${bookKey}:${i+1}`;
            output[key] = {
                pos: [
                    Number(xNorm.toFixed(5)),
                    Number(yNorm.toFixed(5))
                ]
            };
        });
    }

    // Write Output
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    
    const POLY_PATH = path.resolve(__dirname, '../../builder/app/arrangement-polygons.json');
    fs.writeFileSync(POLY_PATH, JSON.stringify(polygons, null, 2));
    
    console.log(`Generated layout for ${Object.keys(output).length} stars.`);
    console.log(`Saved to ${OUTPUT_PATH}`);
    console.log(`Saved polygons to ${POLY_PATH}`);
}

// Helpers

function getCirclePolygon(radius: number, steps: number): [number, number][] {
    const poly: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
        const theta = (i / steps) * 2 * Math.PI;
        poly.push([
            radius * Math.cos(theta),
            radius * Math.sin(theta)
        ]);
    }
    return poly;
}

function distToSegment(p: [number, number], v: [number, number], w: [number, number]): number {
    // Distance from point p to segment vw
    const l2 = distSq(v, w);
    if (l2 === 0) return dist(p, v);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection: [number, number] = [
        v[0] + t * (w[0] - v[0]),
        v[1] + t * (w[1] - v[1])
    ];
    return dist(p, projection);
}

function dist(p1: [number, number], p2: [number, number]): number {
    return Math.sqrt(distSq(p1, p2));
}

function distSq(p1: [number, number], p2: [number, number]): number {
    return (p1[0] - p2[0])**2 + (p1[1] - p2[1])**2;
}

function buildLayoutQueue(node: d3.HierarchyNode<HierarchyNode>, queue: number[], depth: number = 0) {
    // If leaf, no children to arrange
    if (!node.children || node.children.length === 0) return;
    
    // Only enforce order for top levels (Testaments and Divisions)
    // Books (depth >= 2) will use random fallback to avoid eclipsing issues with disparate weights
    const children = node.children;
    if (depth < 2) {
        // 1. Generate coordinates for current node's children
        const count = children.length;
        
        // Radius strategy:
        // Depth 0 (Root): 0.35 (Safe for circle/square).
        // Depth 1 (Divisions): 0.15 (Pack tight in center to avoid complex polygon edges; Voronoi will expand them).
        const r = depth === 0 ? 0.35 : 0.15;
        
        for (let i = 0; i < count; i++) {
            // Clockwise starting from Top (-PI/2)
            // Angle: -PI/2 + (i / count) * 2PI
            const theta = -Math.PI / 2 + (i / count) * 2 * Math.PI;
            
            const x = 0.5 + r * Math.cos(theta);
            const y = 0.5 + r * Math.sin(theta);
            
            queue.push(x);
            queue.push(y);
        }
    }

    // 2. Recurse (process children's children)
    for (const child of children) {
        buildLayoutQueue(child, queue, depth + 1);
    }
}

function createOrderedPrng(queue: number[], seed: string) {
    const rng = seedrandom(seed);
    let queueIndex = 0;
    
    return function() {
        if (queueIndex < queue.length) {
            return queue[queueIndex++];
        }
        return rng();
    };
}

generate().catch(console.error);
