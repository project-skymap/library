import * as THREE from "three";
import type { ConstellationConfig, ConstellationItem, StarArrangement, StarMapConfig } from "../../types";
import type { EngineModule, FrameTiming } from "../types/contracts";
import type { CameraState } from "../types/navigation";
import { resolvePosition } from "./skyPosition";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

type ArtItem = {
  config: ConstellationItem;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  center: THREE.Vector3;
  baseOpacity: number;
  currentOpacity: number;
};

function asConstellationConfig(value: unknown): ConstellationConfig | null {
  if (!value || typeof value !== "object") return null;
  const cfg = value as Partial<ConstellationConfig>;
  if (!Array.isArray(cfg.constellations)) return null;
  if (typeof cfg.atlasBasePath !== "string") return null;
  return cfg as ConstellationConfig;
}

export class ConstellationArtModule implements EngineModule {
  readonly id = "constellation-art";
  readonly updateOrder = 140;
  readonly renderOrder = 95;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly getCameraState: () => Readonly<CameraState>;
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly raycaster = new THREE.Raycaster();
  private readonly root = new THREE.Group();

  private items: ArtItem[] = [];
  private arrangement: StarArrangement | undefined;
  private visible = false;
  private runtimeVisible = true;
  private hoveredId: string | null = null;
  private requestedHoveredId: string | null = null;
  private hoverRequestedAtMs = 0;
  private lastNowMs = 0;
  private focusedId: string | null = null;
  private nodeBlendById = new Map<string, number>();
  private brightenSpeed = 6.5;
  private dimSpeed = 9.5;
  private hoverEnterDelayMs = 45;
  private hoverLeaveDelayMs = 90;

  constructor(opts: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    getCameraState: () => Readonly<CameraState>;
  }) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.getCameraState = opts.getCameraState;
    this.textureLoader.crossOrigin = "anonymous";
    this.root.renderOrder = 85;
    this.scene.add(this.root);
  }

  setConfig(config: StarMapConfig | undefined): void {
    this.visible = config?.showConstellationArt ?? false;
    this.arrangement = config?.arrangement;
    this.hoverEnterDelayMs = clamp(config?.constellationArt?.hoverEnterDelayMs ?? 45, 0, 500);
    this.hoverLeaveDelayMs = clamp(config?.constellationArt?.hoverLeaveDelayMs ?? 90, 0, 800);
    this.nodeBlendById.clear();
    for (const n of config?.model?.nodes ?? []) {
      const rawBlend = typeof n.meta?.__tileBlend === "number" ? n.meta.__tileBlend : 1;
      this.nodeBlendById.set(n.id, clamp(rawBlend, 0, 1));
    }

    const parsed = asConstellationConfig(config?.constellations);
    this.rebuild(parsed, config);
  }

  setHovered(id: string | null): void {
    if (id === this.requestedHoveredId) return;
    this.requestedHoveredId = id;
    this.hoverRequestedAtMs = this.lastNowMs;
  }

  setFocused(id: string | null): void {
    this.focusedId = id;
  }

  setRuntimeVisible(visible: boolean): void {
    this.runtimeVisible = visible;
    this.root.visible = this.visible && this.runtimeVisible;
  }

  pickAtScreen(x: number, y: number, viewportWidth: number, viewportHeight: number): string | undefined {
    if (!this.visible || !this.runtimeVisible) return undefined;
    const nx = (x / viewportWidth) * 2 - 1;
    const ny = -(y / viewportHeight) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.raycaster.intersectObjects(this.root.children, false);
    if (!hits.length) return undefined;
    const id = (hits[0].object as THREE.Mesh).userData?.id;
    return typeof id === "string" ? id : undefined;
  }

  update(_timing: FrameTiming): void {
    this.lastNowMs = _timing.nowMs;
    const dt = Math.max(0.001, Math.min(0.1, _timing.dtSeconds));
    const effectiveVisible = this.visible && this.runtimeVisible;
    this.root.visible = effectiveVisible;
    if (!effectiveVisible) return;
    this.reconcileHoveredId(_timing.nowMs);

    const s = this.getCameraState();
    const fov = s.fovDeg;
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    for (const item of this.items) {
      const fade = item.config.fade;
      let opacity = fade.maxOpacity;
      if (fov <= fade.zoomInEnd) {
        opacity = fade.minOpacity;
      } else if (fov < fade.zoomInStart) {
        const t = (fade.zoomInStart - fov) / Math.max(1e-6, fade.zoomInStart - fade.zoomInEnd);
        opacity = THREE.MathUtils.lerp(fade.maxOpacity, fade.minOpacity, t);
      }

      if (item.config.id === this.hoveredId || item.config.id === this.focusedId) {
        opacity = Math.min(1, opacity * Math.max(1, fade.hoverBoost));
      }

      const centerDir = item.center.clone().normalize();
      const dot = cameraForward.dot(centerDir);
      const visFade = THREE.MathUtils.smoothstep(dot, 0.087, 0.342);

      const blend = this.getBlendForItem(item.config);
      const targetOpacity = clamp(opacity * visFade * item.baseOpacity * blend, 0, 1);
      const speed = targetOpacity > item.currentOpacity ? this.brightenSpeed : this.dimSpeed;
      const alpha = 1 - Math.exp(-speed * dt);
      item.currentOpacity += (targetOpacity - item.currentOpacity) * alpha;
      item.currentOpacity = clamp(item.currentOpacity, 0, 1);

      item.mesh.material.opacity = item.currentOpacity;
      item.mesh.visible = item.currentOpacity > 0.002;
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
  }

  private rebuild(parsed: ConstellationConfig | null, config: StarMapConfig | undefined): void {
    this.clear();
    if (!parsed) return;

    const basePath = parsed.atlasBasePath.replace(/\/$/, "");
    const nodeById = new Map((config?.model?.nodes ?? []).map((n) => [n.id, n] as const));

    for (const c of parsed.constellations) {
      const center = this.resolveCenter(c, nodeById, this.arrangement, 1000);
      if (!center) continue;

      const radius = center.length() || 1000;
      const size = c.radius <= 1 ? c.radius * radius * 2 : c.radius * 2;
      const aspect = c.aspectRatio ?? 1;

      const geo = new THREE.PlaneGeometry(size * aspect, size, 1, 1);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        color: 0xa9bce6,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: c.blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
      });

      const texPath = `${basePath}/${c.image}`;
      if (typeof document !== "undefined") {
        mat.map = this.textureLoader.load(
          texPath,
          (tex) => {
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.needsUpdate = true;
          },
          undefined,
          () => {
            // Keep module resilient if single atlas item fails.
          },
        );
      }
      mat.needsUpdate = true;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(center);
      mesh.lookAt(0, 0, 0);
      if (c.rotationDeg) {
        mesh.rotateZ(THREE.MathUtils.degToRad(c.rotationDeg));
      }
      mesh.renderOrder = 84;
      mesh.userData = { id: c.id, type: "constellation-art" };
      this.root.add(mesh);
      this.items.push({
        config: c,
        mesh,
        center: center.clone(),
        baseOpacity: clamp(c.opacity, 0, 1),
        currentOpacity: 0,
      });
    }
  }

  private resolveCenter(
    c: ConstellationItem,
    nodeById: Map<string, { id: string; meta?: Record<string, unknown> }>,
    arrangement: StarArrangement | undefined,
    radius: number,
  ): THREE.Vector3 | null {
    const anchorPositions: [number, number, number][] = [];
    for (const anchor of c.anchors ?? []) {
      const n = nodeById.get(anchor);
      const p = resolvePosition(anchor, n?.meta, arrangement, radius);
      anchorPositions.push(p);
    }
    if (anchorPositions.length) {
      const sum = new THREE.Vector3();
      for (const p of anchorPositions) sum.add(new THREE.Vector3(p[0], p[1], p[2]));
      if (sum.lengthSq() > 1e-6) return sum.normalize().multiplyScalar(radius);
    }

    const selfNode = nodeById.get(c.id);
    if (selfNode) {
      const p = resolvePosition(c.id, selfNode.meta, arrangement, radius);
      return new THREE.Vector3(p[0], p[1], p[2]).normalize().multiplyScalar(radius);
    }

    if (Array.isArray(c.center) && c.center.length === 2) {
      const v = new THREE.Vector3(c.center[0], c.center[1], -radius);
      if (v.lengthSq() > 1e-6) return v.normalize().multiplyScalar(radius);
    }
    return null;
  }

  private getBlendForItem(c: ConstellationItem): number {
    if (c.anchors?.length) {
      let s = 0;
      let n = 0;
      for (const anchor of c.anchors) {
        const b = this.nodeBlendById.get(anchor);
        if (b === undefined) continue;
        s += b;
        n += 1;
      }
      if (n > 0) return clamp(s / n, 0, 1);
    }
    const idBlend = this.nodeBlendById.get(c.id);
    return clamp(idBlend ?? 1, 0, 1);
  }

  private clear(): void {
    for (const item of this.items) {
      this.root.remove(item.mesh);
      item.mesh.geometry.dispose();
      item.mesh.material.map?.dispose();
      item.mesh.material.dispose();
    }
    this.items = [];
  }

  private reconcileHoveredId(nowMs: number): void {
    if (this.requestedHoveredId === this.hoveredId) return;
    const delay = this.requestedHoveredId ? this.hoverEnterDelayMs : this.hoverLeaveDelayMs;
    if (nowMs - this.hoverRequestedAtMs < delay) return;
    this.hoveredId = this.requestedHoveredId;
  }
}
