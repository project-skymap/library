import fs from 'fs';
import path from 'path';

// Types
type Vector3 = [number, number, number];
type Arrangement3D = Record<string, { position: Vector3 }>;
type Arrangement2D = Record<string, { pos: [number, number] }>;

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.resolve(__dirname, '../../builder/app/arrangement.json');
const OUTPUT_PATH = path.resolve(__dirname, '../../builder/app/arrangement-2d.json');

function convert3dTo2d(arr: Arrangement3D): Arrangement2D {
    const out: Arrangement2D = {};
    let radius = 0;

    // 1. Detect Radius
    for (const key in arr) {
        const [x, y, z] = arr[key].position;
        const r = Math.sqrt(x*x + y*y + z*z);
        if (r > radius) radius = r;
    }
    console.log(`Detected Sphere Radius: ${radius.toFixed(2)}`);

    // 2. Convert
    for (const [key, val] of Object.entries(arr)) {
        const [x, y, z] = val.position;
        
        // Normalize
        const nx = x / radius;
        const ny = y / radius; // Up
        const nz = z / radius;

        // Zenith is (0, 1, 0).
        // Calculate angle from Zenith (0 to PI/2 for hemisphere)
        // phi = acos(ny); // 0 at Zenith, PI/2 at Horizon
        
        // Azimuthal Equidistant Projection
        // Map zenith angle linearly to radius 0..1
        // r2d = phi / (PI/2)
        const phi = Math.acos(Math.max(-1, Math.min(1, ny)));
        const r2d = phi / (Math.PI / 2); // 0..1
        
        // Azimuth (angle around Y axis)
        const theta = Math.atan2(nz, nx);
        
        // 2D Coord
        const u = r2d * Math.cos(theta);
        const v = r2d * Math.sin(theta);
        
        // Scale to 1000 for cleaner integers (optional, or keep 0..1)
        // Let's keep 0..1 float for precision
        out[key] = { pos: [Number(u.toFixed(5)), Number(v.toFixed(5))] };
    }
    
    return out;
}

// Run
try {
    const raw = fs.readFileSync(INPUT_PATH, 'utf-8');
    const data = JSON.parse(raw) as Arrangement3D;
    const result = convert3dTo2d(data);
    
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
    console.log(`Converted ${Object.keys(result).length} nodes.`);
    console.log(`Saved to ${OUTPUT_PATH}`);
} catch (e) {
    console.error("Error:", e);
}
