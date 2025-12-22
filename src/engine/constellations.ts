import * as THREE from "three";

export type Point3D = { x: number; y: number; z: number };

// Helper to rotate a point in 3D space
function rotatePoint(point: Point3D, euler: THREE.Euler): Point3D {
    const v = new THREE.Vector3(point.x, point.y, point.z);
    v.applyEuler(euler);
    return { x: v.x, y: v.y, z: v.z };
}

/**
 * Generates a Golden Spiral (Galaxy-like).
 * Good for books with many chapters (Gen, Psalms, etc).
 */
export function layoutSpiral(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.4 radians

    for (let i = 0; i < count; i++) {
        // radius grows with sqrt of index to keep area constant
        const r = radius * Math.sqrt((i + 1) / count); 
        const theta = i * goldenAngle;

        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        
        // slight variation in y for 3D depth, but mostly flat disc
        const y = (Math.random() - 0.5) * (radius * 0.1); 

        points.push({ x, y, z });
    }
    return points;
}

/**
 * Generates a Cross shape.
 * Vertical bar is longer, horizontal bar crosses near top.
 */
export function layoutCross(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    
    // Split chapters: 70% vertical, 30% horizontal
    const verticalCount = Math.ceil(count * 0.7);
    const horizontalCount = count - verticalCount;
    
    const height = radius * 2.5;
    const width = radius * 1.5;

    // Vertical beam (top to bottom)
    for (let i = 0; i < verticalCount; i++) {
        const t = i / (verticalCount - 1 || 1); // 0..1
        // x=0, z=0
        const y = (height / 2) - t * height; 
        points.push({ x: 0, y, z: 0 });
    }

    // Horizontal beam (left to right)
    // Crosses at roughly 30% from top of vertical
    const crossY = (height / 2) - (height * 0.3);

    for (let i = 0; i < horizontalCount; i++) {
        const t = i / (horizontalCount - 1 || 1); // 0..1
        const x = (-width / 2) + t * width;
        points.push({ x, y: crossY, z: 0 });
    }

    return points;
}

/**
 * Generates a Tablet/Grid shape (for Law).
 * Two columns of stars.
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
        
        // x: -w/2 or +w/2
        const x = (col === 0 ? -1 : 1) * (w * 0.25);
        // y: top to bottom
        const y = (h / 2) - (row / (rows - 1 || 1)) * h;
        
        points.push({ x, y, z: 0 });
    }
    return points;
}

/**
 * Generates a Crown shape (for Kings/Chronicles).
 * A semi-circle/circle with "spikes".
 */
export function layoutCrown(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    // Semi-circle arc (from -PI/2 to PI/2?) or full circle?
    // Let's do a wide arc "smile" shape pointing up.
    
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1 || 1); 
        const angle = -Math.PI * 0.8 + t * Math.PI * 1.6; // wide arc
        
        // Base arc
        let r = radius;
        // Spikes: every 3rd star is higher?
        if (i % 3 === 1) r *= 1.4;

        const x = r * Math.sin(angle);
        const y = r * Math.cos(angle) * 0.5; // flatten height
        
        points.push({ x, y, z: 0 });
    }
    return points;
}

/**
 * Generates a Harp shape (for Psalms).
 * A frame with "strings".
 */
export function layoutHarp(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    // A simple triangle frame
    
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1 || 1);
        
        // Parametric curve for a harp-ish shape
        // x goes left to right
        const x = (-radius) + t * (radius * 2);
        
        // y follows a curve
        // rapid rise on right side
        const y = (-radius) + Math.pow(t, 2) * (radius * 2);

        points.push({ x, y, z: 0 });
    }
    return points;
}

/**
 * Generates a Flame/Teardrop shape (for Acts).
 */
export function layoutFlame(count: number, radius: number): Point3D[] {
    const points: Point3D[] = [];
    
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1 || 1) * Math.PI * 2; // 0 to 2PI
        // Spiral tapering up?
        // Let's do a simple parametric teardrop
        
        // Distribute points along the perimeter of a teardrop
        // Parametric eq: x = cos(t), y = sin(t) * sin(t/2)^m
        
        // Actually, just a noisy vertical spiral looks good as fire
        const tNorm = i / count; 
        const r = radius * (1 - tNorm) * 0.8; // tapering radius
        const angle = tNorm * Math.PI * 4; // 2 turns
        const y = (tNorm - 0.5) * radius * 3; // tall

        const x = r * Math.cos(angle);
        
        points.push({ x, y, z: 0 });
    }
    return points;
}

/**
 * Registry mapping Book Keys (e.g., "MAT") to Layout Functions
 */
const LAYOUT_REGISTRY: Record<string, (c: number, r: number) => Point3D[]> = {
    // Law -> Tablet
    "GEN": layoutTablet,
    "EXO": layoutTablet,
    "LEV": layoutTablet,
    "NUM": layoutTablet,
    "DEU": layoutTablet,

    // Kings/History -> Crown
    "1SA": layoutCrown,
    "2SA": layoutCrown,
    "1KI": layoutCrown,
    "2KI": layoutCrown,
    "1CH": layoutCrown,
    "2CH": layoutCrown,

    // Poetry -> Harp/Spiral
    "PSA": layoutHarp,
    "SNG": layoutHarp,

    // Gospels -> Cross
    "MAT": layoutCross,
    "MRK": layoutCross,
    "LUK": layoutCross,
    "JHN": layoutCross,
    
    // Acts -> Flame
    "ACT": layoutFlame,
};

export function getConstellationLayout(bookKey: string, chapterCount: number, radius: number): Point3D[] {
    const generator = LAYOUT_REGISTRY[bookKey] || layoutSpiral;
    return generator(chapterCount, radius);
}
