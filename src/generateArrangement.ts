import * as THREE from "three";
import type { BibleJSON } from "./adapters/bible";
import type { StarArrangement } from "./types";

export interface GenerateOptions {
    seed: number;
    discRadius: number; // default 2000
    milkyWayEnabled: boolean;
    milkyWayAngle: number; // degrees
    milkyWayWidth: number;
    milkyWayStrength: number; // 0..1 how much it attracts
    noiseScale: number;
    noiseStrength: number;
    clusterSpread: number; // How much chapters spread from book center
}

export const defaultGenerateOptions: GenerateOptions = {
    seed: 12345,
    discRadius: 2000,
    milkyWayEnabled: true,
    milkyWayAngle: 60,
    milkyWayWidth: 0.3, // Width in dot-product space
    milkyWayStrength: 0.7,
    noiseScale: 2.0,
    noiseStrength: 0.4,
    clusterSpread: 0.08, // Radians approx
};

// Simple Linear Congruential Generator for seeded random
class RNG {
    private seed: number;
    constructor(seed: number) {
        this.seed = seed;
    }
    // Returns 0..1
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
    // Returns range [min, max)
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }
    // Uniform random on upper hemisphere (y > 0)
    randomOnSphere(): THREE.Vector3 {
        const y = this.next(); // 0..1 uniform for height
        const theta = 2 * Math.PI * this.next(); // 0..2PI uniform for angle
        const r = Math.sqrt(1 - y * y);
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        return new THREE.Vector3(x, y, z);
    }
}

// Simple 3D Noise (Sum of Sines)
function simpleNoise3D(v: THREE.Vector3, scale: number): number {
    const s = scale;
    return (
        Math.sin(v.x * s) + Math.sin(v.y * s * 1.3) + Math.sin(v.z * s * 1.7) +
        Math.sin(v.x * s * 2.1 + v.y * s * 2.1) * 0.5
    ) / 3.5; // Approx -1..1
}

// Density Function on Sphere
function getDensity(v: THREE.Vector3, opts: GenerateOptions, mwNormal: THREE.Vector3): number {
    let density = 0.3; // Base density

    // 1. Milky Way Band
    if (opts.milkyWayEnabled) {
        const dot = v.dot(mwNormal); // -1..1. 0 = on band.
        const dist = Math.abs(dot);
        // Gaussian falloff from plane
        const band = Math.exp(-(dist * dist) / (opts.milkyWayWidth * opts.milkyWayWidth));
        density += band * opts.milkyWayStrength;
    }

    // 2. Noise Clumping
    const noise = simpleNoise3D(v, opts.noiseScale);
    // Map -1..1 to 0.5..1.5 factor?
    // We want clumps.
    density *= (1.0 + noise * opts.noiseStrength);

    return Math.max(0.01, density);
}

export function generateArrangement(bible: BibleJSON, options: Partial<GenerateOptions> = {}): StarArrangement {
    const opts = { ...defaultGenerateOptions, ...options };
    const rng = new RNG(opts.seed);
    const arrangement: StarArrangement = {};

    // 1. Collect all Books in canonical order
    const books: { key: string; name: string; chapters: number; division: string; testament: string }[] = [];
    bible.testaments.forEach(t => {
        t.divisions.forEach(d => {
            d.books.forEach(b => {
                books.push({
                    key: b.key,
                    name: b.name,
                    chapters: b.chapters,
                    division: d.name,
                    testament: t.name
                });
            });
        });
    });

    const bookCount = books.length;
    
    // Milky Way Orientation
    const mwRad = THREE.MathUtils.degToRad(opts.milkyWayAngle);
    // Normal to the Milky Way plane. Let's tilt it relative to Y axis.
    const mwNormal = new THREE.Vector3(Math.sin(mwRad), Math.cos(mwRad), 0).normalize();

    // 2. Generate Book Anchors (Cluster Centers)
    const anchors: THREE.Vector3[] = [];
    
    // Use Rejection Sampling to place book centers
    for (let i = 0; i < bookCount; i++) {
        let bestP = new THREE.Vector3();
        let valid = false;
        let attempt = 0;
        while (!valid && attempt < 100) {
            const p = rng.randomOnSphere();
            const d = getDensity(p, opts, mwNormal);
            // Rejection
            if (rng.next() < d) {
                bestP = p;
                valid = true;
            }
            attempt++;
        }
        if (!valid) bestP = rng.randomOnSphere(); // Fallback
        anchors.push(bestP);
    }

    // 3. Sort Anchors to keep canonical order somewhat local
    // A simple sort by Y (declination) and then Angle (Right Ascension) is surprisingly effective
    // at keeping list-adjacent items visually accessible without strict lines.
    // Or we can use a "traveling salesman" heuristic? Too slow.
    // Let's use coordinate sort: primarily by longitude (angle), secondarily by latitude.
    anchors.sort((a, b) => {
        // Pseudo-longitude: atan2(z, x)
        const lonA = Math.atan2(a.z, a.x);
        const lonB = Math.atan2(b.z, b.x);
        return lonA - lonB;
    });

    // 4. Assign Books and Generate Chapters
    books.forEach((book, i) => {
        const anchor = anchors[i]!;
        // Apply radius
        const anchorPos = anchor.clone().multiplyScalar(opts.discRadius);
        
        arrangement[`B:${book.key}`] = { position: [anchorPos.x, anchorPos.y, anchorPos.z] };

        // Generate Chapters
        // Gaussian distribution around anchor on sphere surface
        for (let c = 0; c < book.chapters; c++) {
            // Random direction in tangent plane, then project back to sphere
            // Simplified: just add random vector and normalize
            
            // Spread depends on chapter count? Or fixed?
            // "Looks like a real night sky" -> varying spread.
            // Randomize spread per book slightly
            const localSpread = opts.clusterSpread * (0.8 + rng.next() * 0.4);
            
            // Random offset
            const offset = new THREE.Vector3(
                (rng.next() - 0.5) * 2,
                (rng.next() - 0.5) * 2,
                (rng.next() - 0.5) * 2
            ).normalize().multiplyScalar(rng.next() * localSpread); // Power of random to bias center?
            
            // Add to anchor (on unit sphere)
            const starDir = anchor.clone().add(offset).normalize();
            
            // Ensure strictly above horizon
            if (starDir.y < 0.01) {
                starDir.y = 0.01;
                starDir.normalize();
            }
            
            // Scale to radius
            const starPos = starDir.multiplyScalar(opts.discRadius);
            
            const chapId = `C:${book.key}:${c + 1}`;
            arrangement[chapId] = { position: [starPos.x, starPos.y, starPos.z] };
        }
    });

    // 5. Add Division Anchors (Centroids)
    const divisions = new Map<string, { sum: THREE.Vector3, count: number }>();
    books.forEach((book, i) => {
        const anchor = anchors[i]!;
        const anchorPos = anchor.clone().multiplyScalar(opts.discRadius);
        const divId = `D:${book.testament}:${book.division}`;
        
        if (!divisions.has(divId)) {
            divisions.set(divId, { sum: new THREE.Vector3(), count: 0 });
        }
        const entry = divisions.get(divId)!;
        entry.sum.add(anchorPos);
        entry.count++;
    });

    divisions.forEach((val, key) => {
        if (val.count > 0) {
            val.sum.divideScalar(val.count);
            // Project back to sphere surface for the label?
            // Or keep it inside (centroid)? Centroid is better for label averaging.
            // But if it's too deep inside, it might be weird.
            // Let's push it out to radius * 0.8
            val.sum.normalize().multiplyScalar(opts.discRadius * 0.9);
            arrangement[key] = { position: [val.sum.x, val.sum.y, val.sum.z] };
        }
    });

    return arrangement;
}