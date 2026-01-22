
// Type definitions
type Point2D = [number, number];

export const getConstellationShape = (bookKey: string, numPoints: number): Point2D[] => {
  switch (bookKey) {
    case 'GEN': return getAppleShape(numPoints);
    case 'JON': return getWhaleShape(numPoints);
    case 'RUT': return getCornShape(numPoints);
    case 'MAT': return getAngelShape(numPoints);
    case 'MRK': return getLionShape(numPoints);
    case 'LUK': return getOxShape(numPoints);
    case 'JHN': return getEagleShape(numPoints);
    case 'ACT': return getFlameShape(numPoints);
    default: return getSpiralShape(numPoints); // Fallback
  }
};

// --- Shape Generators ---

// Genesis: Apple
function getAppleShape(numPoints: number): Point2D[] {
  const points: Point2D[] = [];
  const phiRatio = (1 + Math.sqrt(5)) / 2;
  const biteCenter = [0.9, 0];
  const biteRadius = 0.75;

  for (let i = 0; i < numPoints; i++) {
    const idx = i + 0.5;
    const ySph = 1 - 2 * idx / numPoints;
    const thetaSph = 2 * Math.PI * idx / phiRatio;

    const rSph = Math.sqrt(1 - ySph * ySph);
    let px = rSph * Math.cos(thetaSph);
    let py = ySph;

    // Apple deformation (simplified 2D projection of the 3D logic)
    // 3D logic used x, y, z. Here we map to 2D (x, y).
    // The Python script mapped Apple Y -> Local Y, Apple X -> Local X.
    
    // Deform logic
    const phi = Math.acos(py);
    const shapeR = 1.2 - 0.5 * Math.pow(Math.abs(Math.cos(phi)), 0.8);
    
    px *= shapeR;
    py *= shapeR;

    if (py > 0) py -= 0.3 * Math.pow(1 - Math.abs(px), 2); // Top dimple
    if (py < 0) py += 0.1 * Math.pow(1 - Math.abs(px), 2); // Bottom dimple

    // Bite Logic
    // Check distance to bite center in 2D
    const dx = px - biteCenter[0];
    const dy = py - biteCenter[1];
    const distSq = dx*dx + dy*dy;
    
    if (distSq < biteRadius*biteRadius) {
       // Project to bite edge
       const dist = Math.sqrt(distSq);
       if (dist > 0) {
           px = biteCenter[0] + (dx / dist) * biteRadius;
           py = biteCenter[1] + (dy / dist) * biteRadius;
       }
    }

    points.push([px, py]);
  }
  return points;
}

// Jonah: Whale
function getWhaleShape(numPoints: number): Point2D[] {
    // 4 Key points defined in script
    // We can interpolate if numPoints > 4, but usually specific points matter.
    // However, the Treemap layout needs N points for N chapters.
    // The python script had a fixed list. We should probably interpolate a spline?
    // Or just cycle/scatter?
    // Given the requirement for "configuration of chapter placement", 
    // let's define the key path and distribute points along it.
    
    const keyPoints: Point2D[] = [
        [1.2, 0.2],   // Head
        [0.0, -0.6],  // Belly
        [-0.2, 0.4],  // Back
        [-1.5, 0.1]   // Tail
    ];

    if (numPoints <= 4) return keyPoints.slice(0, numPoints);

    // Interpolate for more points
    return interpolatePoints(keyPoints, numPoints);
}

// Ruth: Corn
function getCornShape(numPoints: number): Point2D[] {
    const keyPoints: Point2D[] = [
        [0.0, -1.0],  // Bottom
        [-0.5, -0.2], // Left
        [0.5, 0.2],   // Right
        [0.0, 1.0]    // Top
    ];
    
    if (numPoints <= 4) return keyPoints.slice(0, numPoints);
    return interpolatePoints(keyPoints, numPoints);
}

// Matthew: Angel
function getAngelShape(numPoints: number): Point2D[] {
    const points: Point2D[] = [];
    
    // The python script generates exactly 28 points.
    // If numPoints != 28, we might have an issue if we strictly follow the script.
    // Let's implement the generation logic and then sample/truncate/repeat if needed.
    
    const rawPoints: Point2D[] = [];

    // Head
    rawPoints.push([0, 1.2]);
    rawPoints.push([-0.2, 1.0]);
    rawPoints.push([0.2, 1.0]);

    // Wings (6 per side)
    for (let i = 0; i < 6; i++) {
        const t = i / 5.0;
        rawPoints.push([-0.4 - 1.2 * t, 0.8 + 0.4 * Math.sin(t * Math.PI)]);
    }
    for (let i = 0; i < 6; i++) {
        const t = i / 5.0;
        rawPoints.push([0.4 + 1.2 * t, 0.8 + 0.4 * Math.sin(t * Math.PI)]);
    }

    // Body (13 points)
    for (let i = 0; i < 13; i++) {
        const t = i / 12.0;
        const y = 0.8 - 2.0 * t;
        const width = 0.3 + 0.5 * t * t;
        let x = 0;
        const mod = i % 3;
        if (mod === 1) x = -width;
        if (mod === 2) x = width;
        rawPoints.push([x, y]);
    }

    return resample(rawPoints, numPoints);
}

// Mark: Lion
function getLionShape(numPoints: number): Point2D[] {
    const rawPoints: Point2D[] = [
        [1.0, 0.4], [0.8, 0.6], [0.8, 0.2], [0.5, 0.5], // Head
        [0.2, 0.4], [0.0, 0.35], [-0.3, 0.35], [-0.6, 0.3], [0.2, 0.0], // Body
        [0.2, -0.4], [-0.4, -0.4], [0.1, -0.3], [-0.5, -0.3], // Legs
        [-0.7, 0.4], [-0.8, 0.6], [-0.7, 0.8] // Tail
    ];
    return resample(rawPoints, numPoints);
}

// Luke: Ox
function getOxShape(numPoints: number): Point2D[] {
    const rawPoints: Point2D[] = [
        [-1.0, 0.3], [-0.8, 0.5], [-0.8, 0.7], [-0.9, 0.9], [-0.7, 0.9], // Head
        [-0.6, 0.5], [-0.3, 0.55], [0.0, 0.5], [0.3, 0.5], [0.6, 0.4], // Top Line
        [-0.6, 0.0], [-0.3, -0.1], [0.0, -0.1], [0.3, -0.05], [0.6, 0.1], // Bottom Line
        [-0.3, 0.2], // Shoulder
        [-0.4, -0.3], [-0.4, -0.5], // FL
        [-0.2, -0.3], [-0.2, -0.5], // FR
        [0.3, -0.3], [0.3, -0.5], // BL
        [0.5, -0.3], [0.5, -0.5]  // BR
    ];
    return resample(rawPoints, numPoints);
}

// John: Eagle
function getEagleShape(numPoints: number): Point2D[] {
    const rawPoints: Point2D[] = [];
    rawPoints.push([0.0, 0.8], [0.1, 0.7]); // Head

    // Left Wing
    for (let i = 0; i < 6; i++) {
        const t = (i + 1) / 6.0;
        rawPoints.push([-0.2 - 1.2 * t, 0.5 + 0.5 * t * t]);
    }
    // Right Wing
    for (let i = 0; i < 6; i++) {
        const t = (i + 1) / 6.0;
        rawPoints.push([0.2 + 1.2 * t, 0.5 + 0.5 * t * t]);
    }
    // Body
    rawPoints.push([0.0, 0.5], [0.0, 0.2], [0.0, -0.1], [0.0, -0.4]);
    // Tail
    rawPoints.push([-0.2, -0.6], [0.0, -0.7], [0.2, -0.6]);

    return resample(rawPoints, numPoints);
}

// Acts: Flame
function getFlameShape(numPoints: number): Point2D[] {
    const points: Point2D[] = [];
    const height = 1.0; 
    const maxWidth = 0.5;
    const turns = 3.0;

    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1 || 1);
        const v = (t - 0.3) * height; // Vertical pos
        
        // Envelope
        const hNorm = t;
        const envelope = maxWidth * 3.5 * hNorm * Math.pow(1 - hNorm, 1.5);
        
        // Spiral
        const theta = t * turns * 2 * Math.PI;
        const u = envelope * Math.cos(theta);
        
        points.push([u, v]); // Flattened spiral
    }
    return points;
}

// Generic Spiral (Fallback)
function getSpiralShape(numPoints: number): Point2D[] {
    const points: Point2D[] = [];
    const phiRatio = (1 + Math.sqrt(5)) / 2;
    for (let i = 0; i < numPoints; i++) {
        const idx = i + 0.5;
        const r = Math.sqrt(idx / numPoints);
        const theta = 2 * Math.PI * idx / phiRatio;
        points.push([r * Math.cos(theta), r * Math.sin(theta)]);
    }
    return points;
}


// --- Helper Functions ---

// Simple interpolation for ordered shapes
function interpolatePoints(keyPoints: Point2D[], numPoints: number): Point2D[] {
    const result: Point2D[] = [];
    if (numPoints === 0) return result;
    if (numPoints === 1) return [keyPoints[0]];

    // Create a path
    const totalSegments = keyPoints.length - 1;
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1); // 0 to 1
        
        // Find segment
        const segmentT = t * totalSegments;
        const idx = Math.floor(segmentT);
        const localT = segmentT - idx;
        
        if (idx >= totalSegments) {
            result.push(keyPoints[totalSegments]);
        } else {
            const p0 = keyPoints[idx];
            const p1 = keyPoints[idx+1];
            result.push([
                p0[0] + (p1[0] - p0[0]) * localT,
                p0[1] + (p1[1] - p0[1]) * localT
            ]);
        }
    }
    return result;
}

// Resample a set of points to a new count (nearest neighbor or simple fill)
// For shapes like Lion/Ox/Angel, the order in the list wasn't necessarily a continuous path.
// However, preserving the generated set is best. 
// If we need MORE points, we cycle or interpolate?
// If we need FEWER, we take first N?
function resample(sourcePoints: Point2D[], targetCount: number): Point2D[] {
    if (sourcePoints.length === targetCount) return sourcePoints;
    
    if (sourcePoints.length > targetCount) {
        // Take first N (assuming the definition order was meaningful/priority)
        return sourcePoints.slice(0, targetCount);
    }
    
    // If we need more, we can cycle (bad for unique shapes) or just add copies?
    // Let's add copies at the end for now, or maybe interpolate between last and first?
    // A safe bet is to just repeat the last point or cycle.
    const result = [...sourcePoints];
    while (result.length < targetCount) {
        // simple cycle
        result.push(sourcePoints[result.length % sourcePoints.length]);
    }
    return result;
}
