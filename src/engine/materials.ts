import * as THREE from "three";
import type { SceneModel, StarMapConfig } from "../types";

function matches(node: any, when: Record<string, unknown>) {
    for (const [k, v] of Object.entries(when)) {
        if (node[k] !== v) return false;
    }
    return true;
}

export function applyVisuals({
                                 model,
                                 cfg,
                                 meshById
                             }: {
    model: SceneModel;
    cfg: StarMapConfig;
    meshById: Map<string, THREE.Object3D>;
}) {
    const colorRules = cfg.visuals?.colorBy ?? [];
    const sizeRules = cfg.visuals?.sizeBy ?? [];

    // precompute min/max for weight scaling
    const weights = model.nodes.map((n) => n.weight).filter((x): x is number => typeof x === "number");
    const minW = weights.length ? Math.min(...weights) : 0;
    const maxW = weights.length ? Math.max(...weights) : 1;
    const range = Math.max(0, maxW - minW);

    for (const node of model.nodes) {
        const mesh = meshById.get(node.id) as THREE.Mesh | undefined;
        if (!mesh) continue;

        // color
        let color: string | undefined;
        for (const rule of colorRules) {
            if (matches(node, rule.when)) {
                color = rule.value;
                break;
            }
        }
        if (color && (mesh.material as any)?.color) {
            (mesh.material as THREE.MeshBasicMaterial).color = new THREE.Color(color);
        }

        // size by weight
        for (const rule of sizeRules) {
            if (!matches(node, rule.when)) continue;
            const w = node[rule.field];
            if (typeof w !== "number") continue;

            const t = range === 0 ? 0.5 : (w - minW) / range;
            const clamped = Math.min(1, Math.max(0, t));
            const s = rule.scale[0] + t * (rule.scale[1] - rule.scale[0]);
            mesh.scale.setScalar(clamped === t ? s : rule.scale[0] + clamped * (rule.scale[1] - rule.scale[0]));
            break;
        }
    }
}
