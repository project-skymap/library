import type { SceneModel, SceneNode } from "../types";

export function computeLayoutPositions(
    model: SceneModel,
    layout?: { mode?: "radial" | "grid" | "force"; radius?: number; chapterRingSpacing?: number }
): SceneModel {
    const radius = layout?.radius ?? 60;
    const ringSpacing = layout?.chapterRingSpacing ?? 15;

    const childrenMap = new Map<string, SceneNode[]>();
    const roots: SceneNode[] = [];

    // Build hierarchy
    for (const n of model.nodes) {
        if (n.parent) {
            const children = childrenMap.get(n.parent) ?? [];
            children.push(n);
            childrenMap.set(n.parent, children);
        } else {
            roots.push(n);
        }
    }

    // Compute leaf count for each node to allocate angles proportionally
    const leafCounts = new Map<string, number>();
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

    const updatedNodes = model.nodes.map((n) => ({ ...n, meta: { ...(n.meta ?? {}) } }));
    const updatedNodeMap = new Map(updatedNodes.map(n => [n.id, n]));

    function layoutHierarchy(nodes: SceneNode[], startAngle: number, totalAngle: number, level: number) {
        if (nodes.length === 0) return;

        // Sort by ID for deterministic order
        nodes.sort((a, b) => a.id.localeCompare(b.id));

        const totalLeaves = nodes.reduce((sum, n) => sum + (leafCounts.get(n.id) ?? 1), 0);
        let currentAngle = startAngle;

        const currentRadius = level === 0 ? 0 : (radius + (level - 1) * ringSpacing);

        for (const node of nodes) {
            const weight = leafCounts.get(node.id) ?? 1;
            const nodeAngleSpan = (weight / totalLeaves) * totalAngle;
            const midAngle = currentAngle + nodeAngleSpan / 2;

            const updatedNode = updatedNodeMap.get(node.id)!;
            
            // For roots (level 0), place in center or close to it
            // For others, place on ring
            const r = level === 0 ? 0 : currentRadius;
            
            (updatedNode.meta as any).x = Math.cos(midAngle) * r;
            (updatedNode.meta as any).y = Math.sin(midAngle) * r;
            (updatedNode.meta as any).z = 0;
            (updatedNode.meta as any).angle = midAngle;

            const children = childrenMap.get(node.id) ?? [];
            if (children.length > 0) {
                // Pass the allocated slice to children
                layoutHierarchy(children, currentAngle, nodeAngleSpan, level + 1);
            }

            currentAngle += nodeAngleSpan;
        }
    }

    layoutHierarchy(roots, 0, Math.PI * 2, 0);

    return { ...model, nodes: updatedNodes };
}
