import * as THREE from "three";
import type { SceneModel, SceneNode } from "../types";
import { getConstellationLayout, Point3D } from "./constellations";

// Helper: Rotate point P to look at Target T (from 0,0,0)
function lookAt(point: Point3D, target: THREE.Vector3, up: THREE.Vector3): Point3D {
    // We create a rotation matrix that rotates (0,0,1) to 'target'
    // and apply it to 'point' (which is defined in a local XY plane usually)
    
    // For simplicity: We want to place the constellation (defined flat on XY or XZ)
    // tangent to the sphere surface at 'target'.
    
    const zAxis = target.clone().normalize(); // The "Normal" of the book center
    
    // Robust xAxis calculation: if zAxis is aligned with 'up', use alternative axis
    let xAxis = new THREE.Vector3().crossVectors(up, zAxis);
    if (xAxis.lengthSq() < 0.0001) {
        xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), zAxis);
    }
    xAxis.normalize();
    
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const v = new THREE.Vector3(point.x, point.y, point.z);
    v.applyMatrix4(m); // Rotate
    v.add(target); // Translate
    
    return { x: v.x, y: v.y, z: v.z };
}

export function computeLayoutPositions(
    model: SceneModel,
    layout?: { mode?: "radial" | "grid" | "force" | "spherical" | "manual"; radius?: number; chapterRingSpacing?: number }
): SceneModel {
    let mode = layout?.mode;
    
    // Auto-detect: If no mode specified, but nodes have positions, default to manual.
    if (!mode && model.nodes.length > 0) {
        const sample = model.nodes[0];
        if (sample?.meta && typeof sample.meta.x === 'number' && typeof sample.meta.y === 'number' && typeof sample.meta.z === 'number') {
            mode = "manual";
        }
    }
    
    mode = mode ?? "spherical";
    
    // If manual, assume positions are already in meta
    if (mode === "manual") {
        return model;
    }

    const radius = layout?.radius ?? 2000;
    const ringSpacing = layout?.chapterRingSpacing ?? 15;

    const childrenMap = new Map<string, SceneNode[]>();
    const roots: SceneNode[] = [];
    const books: SceneNode[] = [];

    // Build hierarchy
    for (const n of model.nodes) {
        if (n.level === 2) books.push(n); // Collect books for spherical layout
        if (n.parent) {
            const children = childrenMap.get(n.parent) ?? [];
            children.push(n);
            childrenMap.set(n.parent, children);
        } else {
            roots.push(n);
        }
    }

    const updatedNodes = model.nodes.map((n) => ({ ...n, meta: { ...(n.meta ?? {}) } }));
    const updatedNodeMap = new Map(updatedNodes.map(n => [n.id, n]));
    const leafCounts = new Map<string, number>();

    // Helper: Count leaves (for Radial Layout)
    function getLeafCount(node: SceneNode): number {
        const children = childrenMap.get(node.id) ?? [];
        if (children.length === 0) {
            leafCounts.set(node.id, 1);
            return 1;
        }
        let count = 0;
        for (const c of children) count += getLeafCount(c);
        leafCounts.set(node.id, count);
        return count;
    }
    roots.forEach(getLeafCount);

    // Helper: Count leaves and sum weights
    const weights = new Map<string, number>();
    function getWeight(node: SceneNode): number {
        const children = childrenMap.get(node.id) ?? [];
        if (children.length === 0) {
            // Leaf node (Chapter) or empty book
            const w = node.weight ?? 1; 
            weights.set(node.id, w);
            return w;
        }
        let sum = 0;
        for (const c of children) sum += getWeight(c);
        weights.set(node.id, sum);
        return sum;
    }
    roots.forEach(getWeight);

    // --- SPHERICAL MODE ---
    if (mode === "spherical") {
        const totalWeight = roots.reduce((acc, r) => acc + (weights.get(r.id) ?? 0), 0);
        let currentAngle = 0;
        const divisionBoundaries: number[] = [];

        // Traverse hierarchy to keep biblical order: Testament -> Division -> Book
        const sortedTestaments = roots; // Roots are testaments
        
        sortedTestaments.forEach(testament => {
            const divisions = childrenMap.get(testament.id) ?? [];
            
            divisions.forEach(division => {
                const divWeight = weights.get(division.id) ?? 0;
                if (divWeight === 0) return;

                const angleSpan = (divWeight / totalWeight) * Math.PI * 2;
                const startAngle = currentAngle;
                const endAngle = currentAngle + angleSpan;
                const midAngle = startAngle + (angleSpan / 2);

                // Store boundary line angle
                divisionBoundaries.push(startAngle);

                // Position the Division Label (L1) just above horizon
                const uDivision = updatedNodeMap.get(division.id);
                if (uDivision) {
                    const y = 0.08; // Just above horizon (0.05)
                    const radiusAtY = Math.sqrt(1 - y * y);
                    
                    const x = Math.cos(midAngle) * radiusAtY;
                    const z = Math.sin(midAngle) * radiusAtY;
                    
                    const labelPos = new THREE.Vector3(x, y, z).multiplyScalar(radius);
                    
                    (uDivision.meta as any).x = labelPos.x;
                    (uDivision.meta as any).y = labelPos.y;
                    (uDivision.meta as any).z = labelPos.z;
                }

                const divBooks = childrenMap.get(division.id) ?? [];
                const numBooks = divBooks.length;
                
                // Distribute books within the wedge
                divBooks.forEach((book, i) => {
                    const uBook = updatedNodeMap.get(book.id)!;
                    const bookKey = (uBook.meta as any).bookKey as string;

                    // Normalized Index (0 to 1), avoiding 0 and 1 edges slightly
                    const t = (i + 1) / (numBooks + 1); 
                    
                    // Radius from Zenith (0 = Top, 1 = Horizon)
                    // Using sqrt to preserve area density
                    const r = Math.sqrt(t); 
                    
                    // Map r to y (1.0 to 0.05)
                    // Area preserving mapping: y = 1 - r^2 * (1 - min_y) is typical, 
                    // but here r itself is already sqrt(t). 
                    // Let's use simple linear mapping on the area-space variable 't'.
                    // y: Map from Horizon (0.1) to Mid-Sky (0.75) to avoid Zenith crowding
                    // t goes 0..1. i=0 (Genesis) -> Bottom (Wide area).
                    const y = 0.1 + t * 0.65;
                    const radiusAtY = Math.sqrt(1 - y * y);

                    // Theta: Sequential within [startAngle, endAngle]
                    // Diagonal fill (Bottom-Left to Top-Right) for separation
                    const theta = startAngle + t * (angleSpan);

                    const x = Math.cos(theta) * radiusAtY;
                    const z = Math.sin(theta) * radiusAtY;

                    const bookPos = new THREE.Vector3(x, y, z).multiplyScalar(radius);
                    
                    // Position the Book Label slightly "above" the constellation (towards Zenith)
                    // We offset the y-coordinate (up) and re-project to sphere surface
                    const labelPos = bookPos.clone();
                    labelPos.y += radius * 0.025; // Shift up
                    labelPos.setLength(radius); // Snap back to sphere

                    (uBook.meta as any).x = labelPos.x;
                    (uBook.meta as any).y = labelPos.y;
                    (uBook.meta as any).z = labelPos.z;

                    // 2. Layout Chapters (Constellation)
                    const chapters = childrenMap.get(book.id) ?? [];
                    if (chapters.length > 0) {
                        // Adjust territory
                        const territoryRadius = (radius * 2) / Math.sqrt(books.length * 2) * 0.7; 
                        const localPoints = getConstellationLayout(bookKey, chapters.length, territoryRadius);
                        const up = new THREE.Vector3(0, 1, 0); 
                        
                        chapters.forEach((chap, idx) => {
                            const uChap = updatedNodeMap.get(chap.id)!;
                            const lp = localPoints[idx];
                            if (!lp) return;

                            const wp = lookAt(lp, bookPos, up);

                            (uChap.meta as any).x = wp.x;
                            (uChap.meta as any).y = wp.y;
                            (uChap.meta as any).z = wp.z;
                        });
                    }
                });

                currentAngle += angleSpan;
            });
        });

        // 2. Testaments (L0)
        const testaments = model.nodes.filter(n => n.level === 0);
        testaments.forEach(t => {
            const children = childrenMap.get(t.id) ?? [];
            if (children.length === 0) return;

            const centroid = new THREE.Vector3();
            children.forEach(c => {
                 const u = updatedNodeMap.get(c.id)!;
                 centroid.add(new THREE.Vector3((u.meta as any).x, (u.meta as any).y, (u.meta as any).z));
            });
            centroid.divideScalar(children.length);

            if (centroid.length() > 0.1) {
                centroid.setLength(radius * 0.75); // Float further inside
                const uNode = updatedNodeMap.get(t.id)!;
                (uNode.meta as any).x = centroid.x;
                (uNode.meta as any).y = centroid.y;
                (uNode.meta as any).z = centroid.z;
            }
        });

        return { ...model, nodes: updatedNodes, meta: { ...model.meta, divisionBoundaries } };
    }

    // --- RADIAL MODE (Existing) ---
    function layoutRadial(nodes: SceneNode[], startAngle: number, totalAngle: number, level: number) {
        if (nodes.length === 0) return;
        nodes.sort((a, b) => a.id.localeCompare(b.id)); // Deterministic

        const totalLeaves = nodes.reduce((sum, n) => sum + (leafCounts.get(n.id) ?? 1), 0);
        let currentAngle = startAngle;
        const currentRadius = level === 0 ? 0 : (radius + (level - 1) * ringSpacing);

        for (const node of nodes) {
            const weight = leafCounts.get(node.id) ?? 1;
            const nodeAngleSpan = (weight / totalLeaves) * totalAngle;
            const midAngle = currentAngle + nodeAngleSpan / 2;

            const updatedNode = updatedNodeMap.get(node.id)!;
            const r = level === 0 ? 0 : currentRadius;
            
            (updatedNode.meta as any).x = Math.cos(midAngle) * r;
            (updatedNode.meta as any).y = Math.sin(midAngle) * r;
            (updatedNode.meta as any).z = 0;
            (updatedNode.meta as any).angle = midAngle;

            const children = childrenMap.get(node.id) ?? [];
            if (children.length > 0) {
                layoutRadial(children, currentAngle, nodeAngleSpan, level + 1);
            }
            currentAngle += nodeAngleSpan;
        }
    }

    layoutRadial(roots, 0, Math.PI * 2, 0);

    return { ...model, nodes: updatedNodes };
}