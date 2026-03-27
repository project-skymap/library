/**
 * Chapter constellation shape functions.
 *
 * Each function returns a set of local 2D/3D points defining the shape of a
 * book's chapter cluster (e.g. cross, tablet, harp). Points are in local
 * book-space and are rotated into world space by the spherical strategy.
 *
 * No Three.js dependency — plain math only.
 *
 * Moved from src/engine/constellations.ts.
 */

export type Point3D = { x: number; y: number; z: number };

/**
 * Golden spiral — good for books with many chapters (Genesis, Psalms, etc.).
 */
export function layoutSpiral(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.4 radians

    for (let i = 0; i < count; i++) {
        const r = radius * Math.sqrt((i + 1) / count);
        const theta = i * goldenAngle;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        // Deterministic z variation for 3D depth — index-based, no Math.random().
        const z = Math.sin(i * 2.3999 + 0.6180) * (radius * 0.05);
        points.push({ x, y, z });
    }
    return points;
}

/**
 * Cross — vertical bar longer, horizontal bar crosses near top. Used for Gospels.
 */
export function layoutCross(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    const verticalCount = Math.ceil(count * 0.7);
    const horizontalCount = count - verticalCount;
    const height = radius * 2.5;
    const width = radius * 1.5;

    for (let i = 0; i < verticalCount; i++) {
        const t = i / (verticalCount - 1 || 1);
        points.push({ x: 0, y: (height / 2) - t * height, z: 0 });
    }

    const crossY = (height / 2) - (height * 0.3);
    for (let i = 0; i < horizontalCount; i++) {
        const t = i / (horizontalCount - 1 || 1);
        points.push({ x: (-width / 2) + t * width, y: crossY, z: 0 });
    }
    return points;
}

/**
 * Tablet / two-column grid — used for Law (Genesis–Deuteronomy).
 */
export function layoutTablet(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    const cols = 2;
    const rows = Math.ceil(count / cols);
    const w = radius * 1.5;
    const h = radius * 2.0;

    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = (col === 0 ? -1 : 1) * (w * 0.25);
        const y = (h / 2) - (row / (rows - 1 || 1)) * h;
        points.push({ x, y, z: 0 });
    }
    return points;
}

/**
 * Crown — wide arc with alternating spikes. Used for Kings / Chronicles.
 */
export function layoutCrown(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1 || 1);
        const angle = -Math.PI * 0.8 + t * Math.PI * 1.6;
        const r = i % 3 === 1 ? radius * 1.4 : radius;
        points.push({ x: r * Math.sin(angle), y: r * Math.cos(angle) * 0.5, z: 0 });
    }
    return points;
}

/**
 * Harp — parametric curve. Used for Psalms / Song of Songs.
 */
export function layoutHarp(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1 || 1);
        const x = (-radius) + t * (radius * 2);
        const y = (-radius) + Math.pow(t, 2) * (radius * 2);
        points.push({ x, y, z: 0 });
    }
    return points;
}

/**
 * Flame / teardrop spiral — tapering vertical spiral. Used for Acts.
 */
export function layoutFlame(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    for (let i = 0; i < count; i++) {
        const tNorm = i / count;
        const r = radius * (1 - tNorm) * 0.8;
        const angle = tNorm * Math.PI * 4;
        const y = (tNorm - 0.5) * radius * 3;
        points.push({ x: r * Math.cos(angle), y, z: 0 });
    }
    return points;
}

/**
 * Registry mapping book keys to their chapter shape generator.
 */
const LAYOUT_REGISTRY: Record<string, (c: number, r: number) => Point3D[]> = {
    "GEN": layoutTablet, "EXO": layoutTablet, "LEV": layoutTablet,
    "NUM": layoutTablet, "DEU": layoutTablet,
    "1SA": layoutCrown, "2SA": layoutCrown, "1KI": layoutCrown,
    "2KI": layoutCrown, "1CH": layoutCrown, "2CH": layoutCrown,
    "PSA": layoutHarp,  "SNG": layoutHarp,
    "MAT": layoutCross, "MRK": layoutCross, "LUK": layoutCross, "JHN": layoutCross,
    "ACT": layoutFlame,
};

export function getConstellationLayout(bookKey: string, chapterCount: number, radius: number): Point3D[] {
    const generator = LAYOUT_REGISTRY[bookKey] ?? layoutSpiral;
    return generator(chapterCount, radius);
}
