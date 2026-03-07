import * as THREE from "three";
import type { LabelBehaviorConfig, LabelClassBehavior, LabelClassKey, SceneNode } from "../types";
import { Fader } from "./fader";

export type DynamicLabel = {
    obj: THREE.Mesh;
    node: SceneNode;
    initialScale: THREE.Vector2;
    maxFovBias?: number;
    chapterStarSizeNorm?: number;
    chapterStarBaseSize?: number;
    chapterStarWorldPos?: THREE.Vector3;
    chapterGlowRadiusPx?: number;
};

type LabelUniforms = {
    uSize: { value: THREE.Vector2 };
    uAlpha: { value: number };
    uAngle?: { value: number };
};

type ResolvedLabelClassBehavior = {
    minFov: number;
    maxFov: number;
    priority: number;
    mode: "floating" | "pinned";
    maxOverlapPx: number;
    radialFadeStart: number;
    radialFadeEnd: number;
    fadeDuration: number;
};

type ResolvedLabelBehavior = {
    hideBackFacing: boolean;
    overlapPaddingPx: number;
    reappearDelayMs: number;
    classes: Record<LabelClassKey, ResolvedLabelClassBehavior>;
};

type LabelRecord = {
    id: string;
    label: DynamicLabel;
    fader: Fader;
    classKey: LabelClassKey;
    lastRejectedAtMs: number;
    lastAccepted: boolean;
    targetAlpha: number;
};

type Candidate = {
    record: LabelRecord;
    behavior: ResolvedLabelClassBehavior;
    uniforms: LabelUniforms;
    sX: number;
    sY: number;
    w: number;
    h: number;
    ndcX: number;
    ndcY: number;
    priority: number;
    isPinned: boolean;
    isSpecial: boolean;
    centerDist: number;
};

type OccupiedRect = {
    x: number;
    y: number;
    w: number;
    h: number;
    priority: number;
};

export type LabelManagerToggles = {
    showBookLabels: boolean;
    showDivisionLabels: boolean;
    showChapterLabels: boolean;
    showGroupLabels: boolean;
};

export type LabelManagerContext = {
    nowMs: number;
    dt: number;
    fov: number;
    camera: THREE.Camera;
    projectionId: string;
    screenW: number;
    screenH: number;
    globalScale: number;
    aspect: number;
    hoverId: string | null;
    selectedId: string | null;
    focusedId?: string | null;
    isNodeFiltered: (node: SceneNode) => boolean;
    shouldFilter: boolean;
    toggles: LabelManagerToggles;
    config?: LabelBehaviorConfig;
    project: (world: THREE.Vector3) => { x: number; y: number; z: number };
};

const DEFAULT_LABEL_BEHAVIOR: ResolvedLabelBehavior = {
    hideBackFacing: true,
    overlapPaddingPx: 2,
    reappearDelayMs: 60,
    classes: {
        division: {
            minFov: 55,
            maxFov: 180,
            priority: 70,
            mode: "floating",
            maxOverlapPx: 10,
            radialFadeStart: 1.0,
            radialFadeEnd: 1.2,
            fadeDuration: 0.28,
        },
        book: {
            minFov: 0,
            maxFov: 22,
            priority: 60,
            mode: "pinned",
            maxOverlapPx: 999,
            radialFadeStart: 1.0,
            radialFadeEnd: 1.2,
            fadeDuration: 0.22,
        },
        group: {
            minFov: 0,
            maxFov: 22,
            priority: 42,
            mode: "pinned",
            maxOverlapPx: 999,
            radialFadeStart: 1.0,
            radialFadeEnd: 1.2,
            fadeDuration: 0.22,
        },
        chapter: {
            minFov: 0,
            maxFov: 22,
            priority: 30,
            mode: "pinned",
            maxOverlapPx: 999,
            radialFadeStart: 0.55,
            radialFadeEnd: 0.95,
            fadeDuration: 0.16,
        },
    },
};

function levelToClass(level: number): LabelClassKey {
    if (level === 1) return "division";
    if (level === 2) return "book";
    if (level === 2.5) return "group";
    return "chapter";
}

function isClassEnabled(classKey: LabelClassKey, toggles: LabelManagerToggles): boolean {
    if (classKey === "division") return toggles.showDivisionLabels;
    if (classKey === "book") return toggles.showBookLabels;
    if (classKey === "group") return toggles.showGroupLabels;
    return toggles.showChapterLabels;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function resolveLabelBehavior(config?: LabelBehaviorConfig): ResolvedLabelBehavior {
    const classes = { ...DEFAULT_LABEL_BEHAVIOR.classes };

    const mergeClass = (
        key: LabelClassKey,
        source?: LabelClassBehavior,
    ): ResolvedLabelClassBehavior => {
        const base = DEFAULT_LABEL_BEHAVIOR.classes[key];
        return {
            minFov: source?.minFov ?? base.minFov,
            maxFov: source?.maxFov ?? base.maxFov,
            priority: source?.priority ?? base.priority,
            mode: source?.mode ?? base.mode,
            maxOverlapPx: source?.maxOverlapPx ?? base.maxOverlapPx,
            radialFadeStart: source?.radialFadeStart ?? base.radialFadeStart,
            radialFadeEnd: source?.radialFadeEnd ?? base.radialFadeEnd,
            fadeDuration: source?.fadeDuration ?? base.fadeDuration,
        };
    };

    classes.division = mergeClass("division", config?.classes?.division);
    classes.book = mergeClass("book", config?.classes?.book);
    classes.group = mergeClass("group", config?.classes?.group);
    classes.chapter = mergeClass("chapter", config?.classes?.chapter);

    return {
        hideBackFacing: config?.hideBackFacing ?? DEFAULT_LABEL_BEHAVIOR.hideBackFacing,
        overlapPaddingPx: config?.overlapPaddingPx ?? DEFAULT_LABEL_BEHAVIOR.overlapPaddingPx,
        reappearDelayMs: config?.reappearDelayMs ?? DEFAULT_LABEL_BEHAVIOR.reappearDelayMs,
        classes,
    };
}

function boundsOverlapDepth(a: OccupiedRect, b: OccupiedRect): number {
    const ix0 = Math.max(a.x, b.x);
    const iy0 = Math.max(a.y, b.y);
    const ix1 = Math.min(a.x + a.w, b.x + b.w);
    const iy1 = Math.min(a.y + a.h, b.y + b.h);
    if (ix1 <= ix0 || iy1 <= iy0) return 0;
    return Math.min(ix1 - ix0, iy1 - iy0);
}

function boundsDistPoint(rect: OccupiedRect, px: number, py: number): number {
    const cx = rect.x + rect.w * 0.5;
    const cy = rect.y + rect.h * 0.5;
    const dx = Math.max(Math.abs(px - cx) - rect.w * 0.5, 0);
    const dy = Math.max(Math.abs(py - cy) - rect.h * 0.5, 0);
    return Math.sqrt(dx * dx + dy * dy);
}

function getLabelUniforms(obj: THREE.Mesh): LabelUniforms | null {
    const material = obj.material;
    if (!(material instanceof THREE.ShaderMaterial) || !material.uniforms) return null;
    const uniforms = material.uniforms as Record<string, { value: unknown }>;
    const uSize = uniforms.uSize;
    const uAlpha = uniforms.uAlpha;
    const uAngle = uniforms.uAngle;

    if (!uSize || !(uSize.value instanceof THREE.Vector2) || !uAlpha || typeof uAlpha.value !== "number") {
        return null;
    }

    return {
        uSize: { value: uSize.value },
        uAlpha: { value: uAlpha.value as number },
        uAngle: uAngle && typeof uAngle.value === "number" ? { value: uAngle.value } : undefined,
    };
}

function applyUniformAlpha(obj: THREE.Mesh, alpha: number, angle?: number): void {
    const material = obj.material;
    if (!(material instanceof THREE.ShaderMaterial) || !material.uniforms) return;
    const uniforms = material.uniforms as Record<string, { value: unknown }>;
    if (uniforms.uAlpha && typeof uniforms.uAlpha.value === "number") {
        uniforms.uAlpha.value = alpha;
    }
    if (typeof angle === "number" && uniforms.uAngle && typeof uniforms.uAngle.value === "number") {
        uniforms.uAngle.value = angle;
    }
}

export class LabelManager {
    private readonly records = new Map<string, LabelRecord>();

    setLabels(labels: DynamicLabel[]): void {
        const activeIds = new Set<string>();

        for (const label of labels) {
            activeIds.add(label.node.id);
            const existing = this.records.get(label.node.id);
            if (existing) {
                existing.label = label;
                existing.classKey = levelToClass(label.node.level);
                continue;
            }
            this.records.set(label.node.id, {
                id: label.node.id,
                label,
                fader: new Fader(0.2),
                classKey: levelToClass(label.node.level),
                lastRejectedAtMs: 0,
                lastAccepted: false,
                targetAlpha: 0,
            });
        }

        for (const [id] of this.records) {
            if (!activeIds.has(id)) {
                this.records.delete(id);
            }
        }
    }

    clear(): void {
        this.records.clear();
    }

    update(ctx: LabelManagerContext): void {
        const behavior = resolveLabelBehavior(ctx.config);
        const candidates: Candidate[] = [];

        const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion);

        for (const record of this.records.values()) {
            const classBehavior = behavior.classes[record.classKey];
            record.fader.duration = classBehavior.fadeDuration;

            const isEnabled = isClassEnabled(record.classKey, ctx.toggles);
            const isSpecial = record.id === ctx.selectedId || record.id === ctx.hoverId || record.id === ctx.focusedId;

            let targetAlpha = 0;
            let angleTarget: number | undefined;

            if (isEnabled) {
                const maxFov = classBehavior.maxFov + (record.label.maxFovBias ?? 0);
                const inFovRange = ctx.fov >= classBehavior.minFov && ctx.fov <= maxFov;
                if (inFovRange || isSpecial) {
                    const pWorld = record.label.obj.position;
                    const pProj = ctx.project(pWorld);
                    const frontVisible = pProj.z <= 0.2;

                    let backFacing = false;
                    if (behavior.hideBackFacing) {
                        const worldDir = pWorld.clone().normalize();
                        backFacing = worldDir.dot(cameraForward) < -0.2;
                    }

                    if (frontVisible && !backFacing) {
                        const ndcX = pProj.x * ctx.globalScale / ctx.aspect;
                        const ndcY = pProj.y * ctx.globalScale;
                        const sX = (ndcX * 0.5 + 0.5) * ctx.screenW;
                        const sY = (-ndcY * 0.5 + 0.5) * ctx.screenH;

                        const uniforms = getLabelUniforms(record.label.obj);
                        if (uniforms) {
                            const pixelH = uniforms.uSize.value.y * ctx.screenH * 0.8;
                            const pixelW = uniforms.uSize.value.x * ctx.screenH * 0.8;

                            targetAlpha = 1;

                            if (targetAlpha > 0 && record.classKey === "chapter" && !isSpecial) {
                                // Center-weighted reveal: wide/medium zoom favors center labels.
                                const dist = Math.sqrt(ndcX * ndcX + ndcY * ndcY);
                                const fovWeight = THREE.MathUtils.smoothstep(ctx.fov, 10, 40);
                                const focusOuter = THREE.MathUtils.lerp(0.82, 0.62, fovWeight);
                                const focusInner = THREE.MathUtils.lerp(0.24, 0.16, fovWeight);
                                const centerFocus = 1.0 - THREE.MathUtils.smoothstep(dist, focusInner, focusOuter);
                                const chapterVisibility = THREE.MathUtils.lerp(1.0, centerFocus, fovWeight);
                                targetAlpha *= chapterVisibility;
                                if (dist > focusOuter && ctx.fov > 12) {
                                    targetAlpha = 0;
                                }
                                if (dist < 0.18 && ctx.fov < 58) {
                                    targetAlpha = Math.max(targetAlpha, 0.55);
                                }
                            }

                            if (targetAlpha > 0 && (record.classKey === "book" || record.classKey === "group") && !isSpecial) {
                                // Center-weighted reveal, wider focus radius.
                                const dist = Math.sqrt(ndcX * ndcX + ndcY * ndcY);
                                const fovWeight = THREE.MathUtils.smoothstep(ctx.fov, 15, 58);
                                const focusOuter = THREE.MathUtils.lerp(0.95, 0.70, fovWeight);
                                const focusInner = THREE.MathUtils.lerp(0.35, 0.22, fovWeight);
                                const centerFocus = 1.0 - THREE.MathUtils.smoothstep(dist, focusInner, focusOuter);
                                const bookVisibility = THREE.MathUtils.lerp(1.0, centerFocus, fovWeight);
                                targetAlpha *= bookVisibility;
                                if (dist > focusOuter && ctx.fov > 20) {
                                    targetAlpha = 0;
                                }
                            }

                            if (targetAlpha > 0 && ctx.shouldFilter) {
                                const node = record.label.node;
                                if (node.level === 3) {
                                    targetAlpha = 0;
                                } else if (node.level === 2 || node.level === 2.5) {
                                    if (ctx.isNodeFiltered(node)) targetAlpha = 0;
                                }
                            }

                            if (targetAlpha > 0 && record.classKey === "chapter" && record.label.chapterStarWorldPos) {
                                const starProj = ctx.project(record.label.chapterStarWorldPos);
                                if (starProj.z <= 0.2) {
                                    const starNdcX = starProj.x * ctx.globalScale / ctx.aspect;
                                    const starNdcY = starProj.y * ctx.globalScale;
                                    const starSX = (starNdcX * 0.5 + 0.5) * ctx.screenW;
                                    const starSY = (-starNdcY * 0.5 + 0.5) * ctx.screenH;

                                    const rect: OccupiedRect = {
                                        x: sX - pixelW / 2,
                                        y: sY - pixelH / 2,
                                        w: pixelW,
                                        h: pixelH,
                                        priority: classBehavior.priority,
                                    };
                                    const glowRadiusPx = record.label.chapterGlowRadiusPx ?? 18;
                                    const clearancePx = Math.max(1, glowRadiusPx * 0.02);
                                    const distToLabel = boundsDistPoint(rect, starSX, starSY);
                                    if (glowRadiusPx >= 70) {
                                        const threshold = glowRadiusPx + clearancePx;
                                        const visibility = THREE.MathUtils.smoothstep(distToLabel, threshold - 4, threshold + 2);
                                        const lowFovRelief = 1.0 - THREE.MathUtils.smoothstep(ctx.fov, 8, 18);
                                        const boostedVisibility = isSpecial ? Math.max(visibility, 0.92) : Math.max(visibility, lowFovRelief * 0.85);
                                        targetAlpha *= boostedVisibility;
                                    }
                                }
                            }

                            if (record.classKey === "division" && uniforms.uAngle) {
                                angleTarget = 0;
                                if (ctx.projectionId !== "perspective") {
                                    const dx = sX - ctx.screenW / 2;
                                    const dy = sY - ctx.screenH / 2;
                                    angleTarget = Math.atan2(-dy, -dx) - Math.PI / 2;
                                }
                            }

                            if (targetAlpha > 0) {
                                const priorityBoost = isSpecial ? (record.id === ctx.selectedId ? 400 : 300) : 0;
                                candidates.push({
                                    record,
                                    behavior: classBehavior,
                                    uniforms,
                                    sX,
                                    sY,
                                    w: pixelW,
                                    h: pixelH,
                                    ndcX,
                                    ndcY,
                                    priority: classBehavior.priority + priorityBoost,
                                    isPinned: isSpecial || classBehavior.mode === "pinned",
                                    isSpecial,
                                    centerDist: Math.sqrt((sX - ctx.screenW * 0.5) ** 2 + (sY - ctx.screenH * 0.5) ** 2),
                                });
                            }
                        }
                    }
                }
            }

            if (typeof angleTarget === "number") {
                const material = record.label.obj.material;
                if (material instanceof THREE.ShaderMaterial && material.uniforms.uAngle && typeof material.uniforms.uAngle.value === "number") {
                    const current = material.uniforms.uAngle.value as number;
                    material.uniforms.uAngle.value = lerp(current, angleTarget, 0.1);
                }
            }

            record.targetAlpha = targetAlpha;
        }

        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            if (a.record.lastAccepted !== b.record.lastAccepted) return a.record.lastAccepted ? -1 : 1;
            return a.centerDist - b.centerDist;
        });

        let guaranteedCenterChapterId: string | null = null;
        if (ctx.toggles.showChapterLabels && ctx.fov <= behavior.classes.chapter.maxFov + 15) {
            const centerChapter = candidates
                .filter((c) => c.record.classKey === "chapter" && c.record.targetAlpha > 0)
                .sort((a, b) => a.centerDist - b.centerDist)[0];
            if (centerChapter) {
                guaranteedCenterChapterId = centerChapter.record.id;
                centerChapter.record.targetAlpha = Math.max(centerChapter.record.targetAlpha, 0.85);
            }
        }

        const occupied: OccupiedRect[] = [];
        const accepted = new Set<string>();

        for (const c of candidates) {
            if (c.record.targetAlpha <= 0) continue;

            const rect: OccupiedRect = {
                x: c.sX - c.w / 2 - behavior.overlapPaddingPx,
                y: c.sY - c.h / 2 - behavior.overlapPaddingPx,
                w: c.w + behavior.overlapPaddingPx * 2,
                h: c.h + behavior.overlapPaddingPx * 2,
                priority: c.priority,
            };

            let rejected = false;

            const isGuaranteedCenterChapter = c.record.id === guaranteedCenterChapterId;
            if (!c.isPinned && !isGuaranteedCenterChapter) {
                if (!c.record.lastAccepted && !c.isSpecial && c.record.lastRejectedAtMs > 0) {
                    const sinceReject = ctx.nowMs - c.record.lastRejectedAtMs;
                    if (sinceReject < behavior.reappearDelayMs) {
                        rejected = true;
                    }
                }

                if (!rejected) {
                    for (const other of occupied) {
                        if (other.priority < c.priority) continue;
                        const overlapDepth = boundsOverlapDepth(rect, other);
                        if (overlapDepth > c.behavior.maxOverlapPx) {
                            rejected = true;
                            break;
                        }
                    }
                }
            }

            if (rejected) {
                c.record.lastAccepted = false;
                c.record.lastRejectedAtMs = ctx.nowMs;
                continue;
            }

            occupied.push(rect);
            accepted.add(c.record.id);
            c.record.lastAccepted = true;
        }

        for (const record of this.records.values()) {
            const acceptedThisFrame = accepted.has(record.id) && record.targetAlpha > 0;
            record.fader.target = acceptedThisFrame;
            record.fader.update(ctx.dt);
            // When a label was focus-faded to 0 (not accepted AND targetAlpha=0), use
            // baseAlpha=0 so the fader doesn't cause a pop back to full opacity.
            // When rejected by the overlap system (targetAlpha>0 but not accepted),
            // use 1.0 so the fader drives a smooth fade-out as before.
            const baseAlpha = acceptedThisFrame ? record.targetAlpha : (record.targetAlpha > 0 ? 1.0 : 0.0);
            const alpha = record.fader.eased * baseAlpha;
            applyUniformAlpha(record.label.obj, alpha);
            record.label.obj.visible = alpha > 0.01;

            if (!acceptedThisFrame) {
                record.lastAccepted = false;
            }
        }
    }
}
