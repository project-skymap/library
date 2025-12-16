import type { SceneModel, SceneNode } from "../types";

export function computeLayoutPositions(
    model: SceneModel,
    layout?: { mode?: "radial" | "grid" | "force"; radius?: number; chapterRingSpacing?: number }
): SceneModel {
    const mode = layout?.mode ?? "radial";
    if (mode !== "radial") {
        // v0: only radial; others later
    }

    const radius = layout?.radius ?? 60;
    const ring = layout?.chapterRingSpacing ?? 6;

    // group nodes by level
    const byLevel = new Map<number, SceneNode[]>();
    for (const n of model.nodes) {
        const arr = byLevel.get(n.level) ?? [];
        arr.push(n);
        byLevel.set(n.level, arr);
    }

    // deterministic order
    for (const [k, arr] of byLevel) {
        arr.sort((a, b) => a.id.localeCompare(b.id));
        byLevel.set(k, arr);
    }

    const updatedNodes = model.nodes.map((n) => ({ ...n, meta: { ...(n.meta ?? {}) } }));

    // Place each level on a ring; chapters further out
    for (const n of updatedNodes) {
        const levelNodes = byLevel.get(n.level) ?? [];
        const idx = levelNodes.findIndex((x) => x.id === n.id);
        const t = levelNodes.length ? idx / levelNodes.length : 0;

        const r = radius + n.level * ring;
        const angle = t * Math.PI * 2;

        (n.meta as any).x = Math.cos(angle) * r;
        (n.meta as any).y = Math.sin(angle) * r;
        (n.meta as any).z = 0;
    }

    return { ...model, nodes: updatedNodes };
}
