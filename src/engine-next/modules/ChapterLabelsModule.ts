import * as THREE from "three";
import type { EngineModule, RenderContext } from "../types/contracts";

export interface LabelEntry {
  id: string;
  text: string;
  position: [number, number, number];
  blend?: number;
}

type LabelRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function intersectsApprox(a: LabelRect, b: LabelRect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

export class ChapterLabelsModule implements EngineModule {
  readonly id = "chapter-labels";
  readonly updateOrder = 200;
  readonly renderOrder = 300;

  private readonly overlay: HTMLDivElement;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly getEntries: () => LabelEntry[];

  private visible = true;
  private selectedId: string | null = null;
  private labels = new Map<string, HTMLDivElement>();
  private lastRenderAtMs = 0;

  constructor(opts: {
    overlay: HTMLDivElement;
    camera: THREE.PerspectiveCamera;
    getEntries: () => LabelEntry[];
  }) {
    this.overlay = opts.overlay;
    this.camera = opts.camera;
    this.getEntries = opts.getEntries;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.overlay.style.display = visible ? "block" : "none";
  }

  setSelectedId(id: string | null): void {
    this.selectedId = id;
  }

  private getOrCreate(id: string, text: string): HTMLDivElement {
    const existing = this.labels.get(id);
    if (existing) {
      existing.textContent = text;
      return existing;
    }

    const el = document.createElement("div");
    el.dataset.id = id;
    el.textContent = text;
    el.style.position = "absolute";
    el.style.transform = "translate(-50%, -50%)";
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "11px";
    el.style.fontWeight = "500";
    el.style.letterSpacing = "0.02em";
    el.style.color = "rgba(220,230,255,0.85)";
    el.style.textShadow = "0 0 8px rgba(70,120,255,0.45)";
    this.overlay.appendChild(el);
    this.labels.set(id, el);
    return el;
  }

  render(ctx: RenderContext): void {
    if (!this.visible) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const entries = this.getEntries();
    const throttleMs = entries.length > 180 ? 66 : entries.length > 90 ? 33 : 16;
    if (now - this.lastRenderAtMs < throttleMs) return;
    this.lastRenderAtMs = now;
    const keep = new Set<string>();
    const accepted: LabelRect[] = [];

    const sorted = entries.slice().sort((a, b) => {
      if (a.id === this.selectedId) return -1;
      if (b.id === this.selectedId) return 1;
      const ba = a.blend ?? 1;
      const bb = b.blend ?? 1;
      if (ba !== bb) return bb - ba;
      return a.text.localeCompare(b.text);
    });

    for (const e of sorted) {
      const v = new THREE.Vector3(e.position[0], e.position[1], e.position[2]);
      v.project(this.camera);
      if (v.z < -1 || v.z > 1) continue;

      const x = (v.x * 0.5 + 0.5) * ctx.viewportWidth;
      const y = (-v.y * 0.5 + 0.5) * ctx.viewportHeight;
      if (x < 0 || y < 0 || x > ctx.viewportWidth || y > ctx.viewportHeight) continue;

      const el = this.getOrCreate(e.id, e.text);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const blend = Math.max(0, Math.min(1, e.blend ?? 1));
      const baseOpacity = e.id === this.selectedId ? 1 : 0.82;
      el.style.opacity = `${baseOpacity * blend}`;
      el.style.fontWeight = e.id === this.selectedId ? "700" : "500";
      el.style.color = e.id === this.selectedId ? "rgba(255,255,255,1)" : "rgba(220,230,255,0.85)";
      if (blend < 0.04 && e.id !== this.selectedId) {
        el.style.display = "none";
        continue;
      }

      const textLen = Math.max(1, e.text.length);
      const halfW = Math.min(180, 4 + textLen * 3.2);
      const halfH = 8;
      const box: LabelRect = {
        left: x - halfW,
        right: x + halfW,
        top: y - halfH,
        bottom: y + halfH,
      };
      let blocked = false;
      for (const a of accepted) {
        if (intersectsApprox(a, box)) {
          blocked = true;
          break;
        }
      }

      if (blocked && e.id !== this.selectedId) {
        el.style.display = "none";
        continue;
      }

      el.style.display = "block";
      accepted.push(box);
      keep.add(e.id);
    }

    for (const [id, el] of this.labels) {
      if (!keep.has(id)) {
        el.style.display = "none";
      }
    }
  }

  dispose(): void {
    for (const [, el] of this.labels) {
      el.remove();
    }
    this.labels.clear();
  }
}
