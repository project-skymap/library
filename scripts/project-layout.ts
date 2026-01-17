import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IN_2D_PATH = path.resolve(__dirname, '../../builder/app/arrangement-2d.json');
const IN_POLY_PATH = path.resolve(__dirname, '../../builder/app/arrangement-polygons.json');
const OUT_3D_PATH = path.resolve(__dirname, '../../builder/app/arrangement.json');

const RADIUS = 2000;

function project(u: number, v: number): [number, number, number] {
    // Azimuthal Equidistant Inverse
    // r2d = sqrt(u*u + v*v)
    // theta = atan2(v, u)
    // phi = r2d * (PI/2)
    
    let r2d = Math.sqrt(u*u + v*v);
    // Clamp to horizon
    if (r2d > 1) r2d = 1;

    const theta = Math.atan2(v, u);
    const phi = r2d * (Math.PI / 2); // Zenith angle

    // 3D Coords (Y is Up)
    const ny = Math.cos(phi);
    const r_plane = Math.sin(phi);
    const nx = r_plane * Math.cos(theta);
    const nz = r_plane * Math.sin(theta);
    
    return [nx * RADIUS, ny * RADIUS, nz * RADIUS];
}

async function run() {
    console.log("Reading 2D layout...");
    const raw2d = JSON.parse(fs.readFileSync(IN_2D_PATH, 'utf-8'));
    const rawPoly = JSON.parse(fs.readFileSync(IN_POLY_PATH, 'utf-8'));
    
    // 1. Project Stars
    const out3d: Record<string, { position: [number, number, number] }> = {};
    for (const [key, val] of Object.entries(raw2d as Record<string, { pos: [number, number] }>)) {
        out3d[key] = { position: project(val.pos[0], val.pos[1]) };
    }
    
    fs.writeFileSync(OUT_3D_PATH, JSON.stringify(out3d, null, 2));
    console.log(`Projected ${Object.keys(out3d).length} stars to ${OUT_3D_PATH}`);

    // 2. Project Polygons
    const poly3d: Record<string, [number, number, number][]> = {};
    for (const [key, val] of Object.entries(rawPoly as Record<string, [number, number][]>)) {
        // Close the loop if not closed
        const pts = val.map(p => project(p[0], p[1]));
        // Ensure closed loop for lines? THREE.LineSegments usually expects pairs or line strip?
        // THREE.LineLoop is better for polygons.
        // But the engine uses LineSegments.
        // I'll output just the points. The renderer will need to handle "Loop" logic.
        poly3d[key] = pts;
    }
    
    fs.writeFileSync(IN_POLY_PATH, JSON.stringify(poly3d, null, 2));
    console.log(`Projected ${Object.keys(poly3d).length} polygons to ${IN_POLY_PATH}`);
}

run().catch(console.error);
