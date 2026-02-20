import * as THREE from "three";
import type { SceneModel, StarArrangement, StarMapConfig } from "../../types";
import type { EngineModule, FrameTiming } from "../types/contracts";
import { resolvePosition } from "./skyPosition";

export class ConstellationLinesModule implements EngineModule {
  readonly id = "constellation-lines";
  readonly updateOrder = 120;
  readonly renderOrder = 90;

  private readonly scene: THREE.Scene;
  private lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private model: SceneModel | undefined;
  private arrangement: StarArrangement | undefined;
  private visible = true;
  private selectedNodeId: string | null = null;
  private pulseT = 0;
  private linePairs: Array<{ source: string; target: string }> = [];
  private colorAttr: THREE.BufferAttribute | null = null;
  private nodeBlendById = new Map<string, number>();

  constructor(opts: { scene: THREE.Scene }) {
    this.scene = opts.scene;
  }

  setConfig(config: StarMapConfig | undefined): void {
    this.model = config?.model;
    this.arrangement = config?.arrangement;
    this.visible = config?.showConstellationLines ?? true;
    this.nodeBlendById.clear();
    for (const n of config?.model?.nodes ?? []) {
      const raw = typeof n.meta?.__tileBlend === "number" ? n.meta.__tileBlend : 1;
      this.nodeBlendById.set(n.id, Math.min(1, Math.max(0, raw)));
    }
    this.rebuild();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.lines) this.lines.visible = visible;
  }

  setSelectedNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.refreshColors();
  }

  private rebuild(): void {
    if (this.lines) {
      this.scene.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines.material.dispose();
      this.lines = null;
    }

    if (!this.visible) return;
    if (!this.model?.links?.length) return;

    const nodeById = new Map(this.model.nodes.map((n) => [n.id, n] as const));
    const coords: number[] = [];
    this.linePairs = [];
    const radius = 1000;

    for (const link of this.model.links) {
      const a = nodeById.get(link.source);
      const b = nodeById.get(link.target);
      if (!a || !b) continue;

      const pa = resolvePosition(a.id, a.meta, this.arrangement, radius);
      const pb = resolvePosition(b.id, b.meta, this.arrangement, radius);
      coords.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
      this.linePairs.push({ source: a.id, target: b.id });
    }

    if (!coords.length) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    const colors = new Float32Array((coords.length / 3) * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i + 0] = 0.48;
      colors[i + 1] = 0.65;
      colors[i + 2] = 1.0;
    }
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute("color", this.colorAttr);

    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.visible = this.visible;
    this.scene.add(this.lines);
    this.refreshColors();
  }

  private refreshColors(): void {
    if (!this.colorAttr) return;
    for (let i = 0; i < this.linePairs.length; i++) {
      const pair = this.linePairs[i];
      const aBlend = this.nodeBlendById.get(pair.source) ?? 1;
      const bBlend = this.nodeBlendById.get(pair.target) ?? 1;
      const linkBlend = (aBlend + bBlend) * 0.5;
      const highlighted =
        this.selectedNodeId !== null &&
        (pair.source === this.selectedNodeId || pair.target === this.selectedNodeId);
      const pulse = highlighted ? 0.18 * (0.5 + 0.5 * Math.sin(this.pulseT * 5.5)) : 0;
      const b = (highlighted ? 1.0 + pulse : 0.62) * linkBlend;
      const r = Math.min(1, 0.48 * b);
      const g = Math.min(1, 0.65 * b);
      const bl = Math.min(1, 1.0 * b);
      this.colorAttr.setXYZ(i * 2 + 0, r, g, bl);
      this.colorAttr.setXYZ(i * 2 + 1, r, g, bl);
    }
    this.colorAttr.needsUpdate = true;
    if (this.lines) {
      this.lines.material.opacity = this.selectedNodeId ? 0.45 : 0.28;
      this.lines.material.needsUpdate = true;
    }
  }

  update(timing: FrameTiming): void {
    if (!this.selectedNodeId) return;
    this.pulseT = timing.nowMs / 1000;
    this.refreshColors();
  }

  dispose(): void {
    if (!this.lines) return;
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.lines = null;
    this.colorAttr = null;
    this.linePairs = [];
  }
}
