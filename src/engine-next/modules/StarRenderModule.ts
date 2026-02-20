import * as THREE from "three";
import type { HierarchyFilter, SceneModel, SceneNode, StarArrangement, StarMapConfig } from "../../types";
import type { EngineModule, FrameTiming, RenderContext } from "../types/contracts";
import type { CameraState } from "../types/navigation";
import { resolvePosition } from "./skyPosition";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class StarRenderModule implements EngineModule {
  readonly id = "stars-render";
  readonly updateOrder = 100;
  readonly renderOrder = 100;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly getCameraState: () => Readonly<CameraState>;

  private points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private arrangement: StarArrangement | undefined;
  private model: SceneModel | undefined;
  private chapterNodes: SceneNode[] = [];
  private labelEntries: { id: string; text: string; position: [number, number, number]; blend: number }[] = [];
  private nodesById = new Map<string, SceneNode>();
  private colorAttr: THREE.BufferAttribute | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private pulseT = 0;
  private magnitudes: number[] = [];
  private tileBlendWeights: number[] = [];
  private adaptationSuppression = 0;
  private lastPixelRatio = -1;
  private lastViewportWidth = -1;
  private lastViewportHeight = -1;

  private hoveredBookId: string | null = null;
  private focusedBookId: string | null = null;
  private selectedNodeId: string | null = null;
  private hierarchyFilter: HierarchyFilter | null = null;
  private orderRevealEnabled = true;
  private projectionMode: "perspective" | "stereographic" | "blended" = "perspective";

  constructor(opts: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    getCameraState: () => Readonly<CameraState>;
  }) {
    this.renderer = opts.renderer;
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.getCameraState = opts.getCameraState;
  }

  setConfig(config: StarMapConfig | undefined): void {
    this.arrangement = config?.arrangement;
    this.model = config?.model;
    this.projectionMode = config?.projection ?? this.projectionMode;
    this.rebuildPoints();
  }

  getArrangement(): StarArrangement | undefined {
    return this.arrangement;
  }

  getNodeById(nodeId: string): SceneNode | undefined {
    return this.nodesById.get(nodeId);
  }

  getWorldPositionById(nodeId: string): [number, number, number] | undefined {
    const node = this.nodesById.get(nodeId);
    if (!node) return undefined;
    return resolvePosition(node.id, node.meta, this.arrangement, 1000);
  }

  setHoveredBook(bookId: string | null): void {
    this.hoveredBookId = bookId;
    this.refreshColors();
  }

  setFocusedBook(bookId: string | null): void {
    this.focusedBookId = bookId;
    this.refreshColors();
  }

  setSelectedNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.refreshColors();
  }

  setHierarchyFilter(filter: HierarchyFilter | null): void {
    this.hierarchyFilter = filter;
    this.refreshColors();
  }

  setOrderRevealEnabled(enabled: boolean): void {
    this.orderRevealEnabled = enabled;
    this.refreshColors();
  }

  setProjectionMode(mode: "perspective" | "stereographic" | "blended"): void {
    this.projectionMode = mode;
    if (this.points) {
      this.points.material.size = mode === "stereographic" ? 3.5 : 3.0;
      this.points.material.needsUpdate = true;
    }
  }

  setAdaptationSuppression(value: number): void {
    const next = clamp(value, 0, 1);
    if (Math.abs(next - this.adaptationSuppression) < 0.01) return;
    this.adaptationSuppression = next;
    this.refreshColors();
  }

  getEstimatedLuminance(): number {
    const count = this.chapterNodes.length;
    if (!count) return 0.02;
    const s = this.getCameraState();
    const zoomFactor = clamp(50 / Math.max(1, s.fovDeg), 0.4, 2.4);
    const density = clamp(count / 1200, 0.05, 1.6);
    let brightWeight = 0;
    for (let i = 0; i < this.magnitudes.length; i++) {
      const m = this.magnitudes[i] ?? 4;
      brightWeight += clamp((7 - m) / 6, 0.05, 1.2);
    }
    brightWeight /= Math.max(1, this.magnitudes.length);
    const selectedBoost = this.selectedNodeId ? 1.08 : 1;
    return clamp(density * zoomFactor * brightWeight * selectedBoost, 0.02, 2.4);
  }

  getLabelEntries(): { id: string; text: string; position: [number, number, number]; blend: number }[] {
    return this.labelEntries;
  }

  pickAtScreen(x: number, y: number, viewportWidth: number, viewportHeight: number): SceneNode | undefined {
    if (!this.points) return undefined;
    const nx = (x / viewportWidth) * 2 - 1;
    const ny = -(y / viewportHeight) * 2 + 1;
    this.raycaster.params.Points = { threshold: 10 };
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.raycaster.intersectObject(this.points, false);
    if (!hits.length) return undefined;
    const i = hits[0].index;
    if (i === undefined) return undefined;
    return this.chapterNodes[i];
  }

  private rebuildPoints(): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
      this.colorAttr = null;
    }

    this.nodesById.clear();
    this.magnitudes = [];
    this.tileBlendWeights = [];
    this.labelEntries = [];
    const model = this.model;
    if (!model || !model.nodes.length) return;

    for (const n of model.nodes) this.nodesById.set(n.id, n);
    this.chapterNodes = model.nodes.filter((n) => {
      if (n.level < 3) return false;
      const rawBlend = typeof n.meta?.__tileBlend === "number" ? n.meta.__tileBlend : 1;
      return rawBlend > 0.02;
    });
    if (!this.chapterNodes.length) return;

    const radius = 1000;
    const positions = new Float32Array(this.chapterNodes.length * 3);
    const colors = new Float32Array(this.chapterNodes.length * 3);

    for (let i = 0; i < this.chapterNodes.length; i++) {
      const n = this.chapterNodes[i];
      const p = resolvePosition(n.id, n.meta, this.arrangement, radius);
      positions[i * 3 + 0] = p[0];
      positions[i * 3 + 1] = p[1];
      positions[i * 3 + 2] = p[2];
      colors[i * 3 + 0] = 0.95;
      colors[i * 3 + 1] = 0.95;
      colors[i * 3 + 2] = 1.0;
      const rawMag = typeof n.meta?.vmag === "number" ? n.meta.vmag : 4;
      this.magnitudes.push(clamp(rawMag, -2, 10));
      const rawBlend = typeof n.meta?.__tileBlend === "number" ? n.meta.__tileBlend : 1;
      this.tileBlendWeights.push(clamp(rawBlend, 0, 1));
      this.labelEntries.push({
        id: n.id,
        text: n.label,
        position: [p[0], p[1], p[2]],
        blend: this.tileBlendWeights[i] ?? 1,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    geo.setAttribute("color", this.colorAttr);

    const mat = new THREE.PointsMaterial({
      size: this.projectionMode === "stereographic" ? 3.5 : 3,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
    this.refreshColors();
  }

  private matchesFilter(node: SceneNode): boolean {
    const f = this.hierarchyFilter;
    if (!f) return true;
    const meta = node.meta ?? {};
    if (f.bookKey && meta.bookKey !== f.bookKey) return false;
    if (f.division && meta.division !== f.division) return false;
    if (f.testament && meta.testament !== f.testament) return false;
    return true;
  }

  private isDescendantOf(node: SceneNode, ancestorId: string | null): boolean {
    if (!ancestorId) return false;
    let current: SceneNode | undefined = node;
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parent ? this.nodesById.get(current.parent) : undefined;
    }
    return false;
  }

  private refreshColors(): void {
    if (!this.colorAttr) return;
    const n = this.chapterNodes.length;
    for (let i = 0; i < n; i++) {
      const node = this.chapterNodes[i];
      let b = 0.85;

      if (this.orderRevealEnabled) {
        b *= 0.8 + 0.2 * (i / Math.max(1, n - 1));
      }

      if (!this.matchesFilter(node)) {
        b *= 0.25;
      }

      const mag = this.magnitudes[i] ?? 4;
      const faintness = clamp((mag - 1.5) / 6.5, 0, 1);
      b *= 1 - this.adaptationSuppression * 0.55 * faintness;
      b *= this.tileBlendWeights[i] ?? 1;

      if (this.isDescendantOf(node, this.hoveredBookId)) {
        b = Math.max(b, 1.0);
      }

      if (this.isDescendantOf(node, this.focusedBookId)) {
        b = Math.max(b, 1.2);
      }

      if (node.id === this.selectedNodeId) {
        const pulse = 0.22 * (0.5 + 0.5 * Math.sin(this.pulseT * 5.5));
        b = Math.max(b, 1.35 + pulse);
      }

      const r = Math.min(1.0, 0.78 * b);
      const g = Math.min(1.0, 0.85 * b);
      const bl = Math.min(1.0, 1.0 * b);
      this.colorAttr.setXYZ(i, r, g, bl);
    }
    this.colorAttr.needsUpdate = true;
  }

  update(timing: FrameTiming): void {
    if (!this.selectedNodeId) return;
    this.pulseT = timing.nowMs / 1000;
    this.refreshColors();
  }

  render(ctx: RenderContext): void {
    const s = this.getCameraState();

    this.camera.fov = s.fovDeg;
    this.camera.aspect = ctx.viewportWidth / Math.max(ctx.viewportHeight, 1);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = s.yawRad;
    this.camera.rotation.x = s.pitchRad;
    this.camera.rotation.z = s.rollRad;
    this.camera.updateProjectionMatrix();

    if (this.points) {
      const base = this.projectionMode === "stereographic" ? 3.5 : 3;
      const zoomScale = clamp(Math.sqrt(50 / Math.max(1, s.fovDeg)), 0.75, 2.2);
      this.points.material.size = base * zoomScale;
    }

    if (Math.abs(ctx.pixelRatio - this.lastPixelRatio) > 1e-3) {
      this.renderer.setPixelRatio(ctx.pixelRatio);
      this.lastPixelRatio = ctx.pixelRatio;
    }
    if (ctx.viewportWidth !== this.lastViewportWidth || ctx.viewportHeight !== this.lastViewportHeight) {
      this.renderer.setSize(ctx.viewportWidth, ctx.viewportHeight, false);
      this.lastViewportWidth = ctx.viewportWidth;
      this.lastViewportHeight = ctx.viewportHeight;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
    this.colorAttr = null;
    this.lastPixelRatio = -1;
    this.lastViewportWidth = -1;
    this.lastViewportHeight = -1;
  }
}
