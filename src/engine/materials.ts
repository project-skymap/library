import * as THREE from "three";
import type { SceneModel, StarMapConfig } from "../types";

function matches(node: any, when: Record<string, unknown>) {
    for (const [k, v] of Object.entries(when)) {
        const val = node[k] !== undefined ? node[k] : node.meta?.[k];
        if (val !== v) return false;
    }
    return true;
}

type ColorRule = { when: Record<string, unknown>; color: string; opacity?: number };
type SizeRule = {
    when: Record<string, unknown>;
    field: string;
    domain?: [number, number];
    scale: [number, number];
};

export type VisualResolver = {
    color(node: any): { color: THREE.Color; opacity: number };
    scale(node: any): number | undefined;
    weightT(node: any): number | undefined;
};

// ---- Compatibility: cfg.style.* OR cfg.visuals.* ----
function getColorRules(cfg: StarMapConfig): ColorRule[] {
    const anyCfg = cfg as any;

    // New/engine shape
    const styleColors = anyCfg?.style?.colors;
    if (Array.isArray(styleColors)) return styleColors as ColorRule[];

    // Existing app shape (page.tsx)
    const visualsColorBy = anyCfg?.visuals?.colorBy;
    if (Array.isArray(visualsColorBy)) {
        return visualsColorBy.map((r: any) => ({
            when: r.when ?? {},
            color: r.value,
            opacity: r.opacity
        })) as ColorRule[];
    }

    return [];
}

function getSizeRules(cfg: StarMapConfig): SizeRule[] {
    const anyCfg = cfg as any;

    const styleSizes = anyCfg?.style?.sizes;
    if (Array.isArray(styleSizes)) return styleSizes as SizeRule[];

    const visualsSizeBy = anyCfg?.visuals?.sizeBy;
    if (Array.isArray(visualsSizeBy)) return visualsSizeBy as SizeRule[];

    return [];
}

export function createVisualResolver(model: SceneModel, cfg: StarMapConfig): VisualResolver {
    const colorRules = getColorRules(cfg);
    const sizeRules = getSizeRules(cfg);

    const domainByRule = new Map<SizeRule, { min: number; max: number; range: number }>();

    for (const rule of sizeRules) {
        if (rule.domain && rule.domain.length === 2) {
            const [min, max] = rule.domain;
            domainByRule.set(rule, { min, max, range: max - min });
            continue;
        }

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        for (const n of model.nodes as any[]) {
            if (!matches(n, rule.when)) continue;
            const v = (n as any)[rule.field] ?? (n as any).meta?.[rule.field];
            if (typeof v !== "number" || !Number.isFinite(v)) continue;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }

        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            min = 0;
            max = 1;
        }
        domainByRule.set(rule, { min, max, range: max - min });
    }

    function weightT(node: any): number | undefined {
        for (const rule of sizeRules) {
            if (!matches(node, rule.when)) continue;

            const v = node[rule.field] ?? node.meta?.[rule.field];
            if (typeof v !== "number" || !Number.isFinite(v)) return undefined;

            const dom = domainByRule.get(rule)!;
            const t = dom.range === 0 ? 0.5 : (v - dom.min) / dom.range;
            return Math.min(1, Math.max(0, t));
        }
        return undefined;
    }

    function scale(node: any): number | undefined {
        for (const rule of sizeRules) {
            if (!matches(node, rule.when)) continue;

            const t = weightT(node);
            if (t === undefined) return undefined;

            return rule.scale[0] + t * (rule.scale[1] - rule.scale[0]);
        }
        return undefined;
    }

    function color(node: any): { color: THREE.Color; opacity: number } {
        for (const rule of colorRules) {
            if (!matches(node, rule.when)) continue;
            return { color: new THREE.Color(rule.color), opacity: rule.opacity ?? 1 };
        }
        return { color: new THREE.Color("#ffffff"), opacity: 1 };
    }

    return { color, scale, weightT };
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
    const colorRules = getColorRules(cfg);
    const sizeRules = getSizeRules(cfg);

    const domains: Record<string, { min: number; max: number }> = {};
    for (const rule of sizeRules) {
        const key = JSON.stringify(rule.when) + "|" + rule.field;
        if (domains[key]) continue;

        if (rule.domain) {
            domains[key] = { min: rule.domain[0], max: rule.domain[1] };
            continue;
        }

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;

        for (const n of model.nodes as any[]) {
            if (!matches(n, rule.when)) continue;
            const v = (n as any)[rule.field] ?? (n as any).meta?.[rule.field];
            if (typeof v !== "number" || !Number.isFinite(v)) continue;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }

        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            min = 0;
            max = 1;
        }
        domains[key] = { min, max };
    }

    for (const node of model.nodes as any[]) {
        const mesh = meshById.get(node.id);
        if (!mesh) continue;

        // color
        for (const rule of colorRules) {
            if (!matches(node, rule.when)) continue;
            mesh.traverse((obj: any) => {
                if (!obj.material) return;
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const m of mats) {
                    if (m?.color) m.color = new THREE.Color(rule.color);
                    m.transparent = true;
                    m.opacity = rule.opacity ?? 1;
                }
            });
            break;
        }

        // size
        for (const rule of sizeRules) {
            if (!matches(node, rule.when)) continue;
            const w = node[rule.field] ?? node.meta?.[rule.field];
            if (typeof w !== "number" || !Number.isFinite(w)) continue;

            const key = JSON.stringify(rule.when) + "|" + rule.field;
            const { min, max } = domains[key];
            const range = max - min;

            const t = range === 0 ? 0.5 : (w - min) / range;
            const clamped = Math.min(1, Math.max(0, t));
            const s = rule.scale[0] + clamped * (rule.scale[1] - rule.scale[0]);

            mesh.scale.setScalar(s);
            break;
        }
    }
}
