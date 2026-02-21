import type { SceneLink, SceneModel, SceneNode, StarArrangement, StarMapConfig } from "../../types";
import type { CameraState } from "../types/navigation";

type TilePayload = {
  model: SceneModel;
  arrangement?: StarArrangement;
};

type LoadedTile = {
  id: string;
  payload: TilePayload;
  lastUsedFrame: number;
};

type TileStreamingState = NonNullable<StarMapConfig["tileStreaming"]>;

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  if (s.size !== b.length) return false;
  for (const id of b) {
    if (!s.has(id)) return false;
  }
  return true;
}

function mergeTiles(weights: ReadonlyMap<string, number>, loaded: Map<string, LoadedTile>): {
  model: SceneModel;
  arrangement?: StarArrangement;
} {
  const nodes = new Map<string, SceneNode>();
  const links = new Map<string, SceneLink>();
  const arrangement: StarArrangement = {};
  const arrangementWeight = new Map<string, number>();
  let hasArrangement = false;

  for (const [id, w] of weights.entries()) {
    const tile = loaded.get(id);
    if (!tile) continue;
    const blendWeight = clamp(w, 0, 1);
    for (const n of tile.payload.model.nodes) {
      const existing = nodes.get(n.id);
      const existingBlend =
        typeof existing?.meta?.__tileBlend === "number" ? (existing.meta.__tileBlend as number) : -1;
      if (!existing || blendWeight >= existingBlend) {
        nodes.set(n.id, {
          ...n,
          meta: { ...(n.meta ?? {}), __tileBlend: blendWeight },
        });
      }
    }
    for (const l of tile.payload.model.links ?? []) {
      const key = `${l.source}->${l.target}`;
      if (!links.has(key)) links.set(key, l);
    }
    if (tile.payload.arrangement) {
      hasArrangement = true;
      for (const [nodeId, pos] of Object.entries(tile.payload.arrangement)) {
        const prev = arrangementWeight.get(nodeId) ?? -1;
        if (blendWeight >= prev) {
          arrangement[nodeId] = pos;
          arrangementWeight.set(nodeId, blendWeight);
        }
      }
    }
  }

  return {
    model: {
      nodes: [...nodes.values()],
      links: [...links.values()],
    },
    arrangement: hasArrangement ? arrangement : undefined,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function shortestAngleDelta(current: number, target: number): number {
  const twoPi = Math.PI * 2;
  let d = (target - current) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
}

function angularDistance(yawA: number, pitchA: number, yawB: number, pitchB: number): number {
  const dy = shortestAngleDelta(yawA, yawB);
  const dp = pitchA - pitchB;
  return Math.hypot(dy, dp);
}

export class TileStreamingController {
  private cfg: TileStreamingState | null = null;
  private loaded = new Map<string, LoadedTile>();
  private inFlight = new Set<string>();
  private queue: string[] = [];
  private desiredTileIds: string[] = [];
  private resolvedTileIds: string[] = [];
  private activeTileIds: string[] = [];
  private transitionFromIds: string[] = [];
  private transitionToIds: string[] = [];
  private transitionStartFrame = 0;
  private transitioning = false;
  private merged: { model: SceneModel; arrangement?: StarArrangement } | null = null;
  private lastBlendSignature = "";
  private revision = 0;
  private disposed = false;
  private frameIndex = 0;

  setConfig(config: StarMapConfig["tileStreaming"]): void {
    this.cfg = config?.enabled === false || !config ? null : config;
    this.loaded.clear();
    this.inFlight.clear();
    this.queue = [];
    this.desiredTileIds = [];
    this.resolvedTileIds = [];
    this.activeTileIds = [];
    this.transitionFromIds = [];
    this.transitionToIds = [];
    this.transitionStartFrame = 0;
    this.transitioning = false;
    this.merged = null;
    this.lastBlendSignature = "";
    this.revision += 1;
  }

  update(camera: Readonly<CameraState>, frameIndex: number): boolean {
    if (!this.cfg || this.disposed) return false;
    this.frameIndex = frameIndex;

    const desired = this.pickDesired(camera);
    for (const root of this.cfg.rootTileIds) this.enqueueLoad(root);
    for (const id of desired) this.enqueueLoad(id);
    this.pumpQueue();

    const resolved = this.resolveWithParentFallback(desired);
    const changed = !arraysEqualUnordered(resolved, this.resolvedTileIds);
    if (changed) {
      this.beginTransition(resolved);
      this.resolvedTileIds = resolved;
    }

    if (this.refreshMergedFromActiveWeights()) {
      this.revision += 1;
    }

    this.evictIfNeeded();
    return changed;
  }

  getMergedScene(): { model: SceneModel; arrangement?: StarArrangement } | null {
    return this.merged;
  }

  getRevision(): number {
    return this.revision;
  }

  getDebugStats(): {
    enabled: boolean;
    desiredCount: number;
    resolvedCount: number;
    activeCount: number;
    loadedCount: number;
    inFlightCount: number;
    queueCount: number;
    transitioning: boolean;
  } {
    return {
      enabled: !!this.cfg && !this.disposed,
      desiredCount: this.desiredTileIds.length,
      resolvedCount: this.resolvedTileIds.length,
      activeCount: this.activeTileIds.length || this.resolvedTileIds.length,
      loadedCount: this.loaded.size,
      inFlightCount: this.inFlight.size,
      queueCount: this.queue.length,
      transitioning: this.transitioning,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.loaded.clear();
    this.inFlight.clear();
    this.queue = [];
    this.desiredTileIds = [];
    this.resolvedTileIds = [];
    this.activeTileIds = [];
    this.transitionFromIds = [];
    this.transitionToIds = [];
    this.transitioning = false;
    this.merged = null;
    this.lastBlendSignature = "";
  }

  private pickDesired(camera: Readonly<CameraState>): string[] {
    if (!this.cfg) return [];
    const roots = this.cfg.rootTileIds ?? [];
    const selected =
      this.cfg.selectTiles?.({
        yawRad: camera.yawRad,
        pitchRad: camera.pitchRad,
        fovDeg: camera.fovDeg,
        rootTileIds: roots,
      }) ?? this.selectByBuiltInStrategy(camera, roots);
    this.desiredTileIds = [...new Set(selected)];
    return this.desiredTileIds;
  }

  private selectByBuiltInStrategy(camera: Readonly<CameraState>, roots: string[]): string[] {
    if (!this.cfg) return roots;
    if (!this.cfg.getTileMeta) return roots;
    if (this.cfg.selector?.enabled === false) return roots;

    const maxDepth = Math.max(0, this.cfg.selector?.maxDepth ?? 6);
    const maxSelectedTiles = Math.max(1, this.cfg.selector?.maxSelectedTiles ?? 12);
    const refinementFovDeg = clamp(this.cfg.selector?.refinementFovDeg ?? 65, 10, 180);

    const selected = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
    const fovRad = (camera.fovDeg * Math.PI) / 180;

    while (queue.length > 0 && selected.size < maxSelectedTiles) {
      const next = queue.shift();
      if (!next) break;
      const meta = this.cfg.getTileMeta(next.id);
      if (!meta) {
        selected.add(next.id);
        continue;
      }
      const dist = angularDistance(camera.yawRad, camera.pitchRad, meta.centerYawRad, meta.centerPitchRad);
      const visibleLimit = fovRad * 0.5 + meta.radiusRad * 1.35;
      const visible = dist <= visibleLimit;
      if (!visible) continue;

      const children = this.cfg.getChildren?.(next.id) ?? [];
      const refineThreshold = (refinementFovDeg * Math.PI) / 180 / Math.pow(2, next.depth);
      const shouldRefine = children.length > 0 && next.depth < maxDepth && fovRad <= refineThreshold;
      if (shouldRefine) {
        for (const childId of children) queue.push({ id: childId, depth: next.depth + 1 });
      } else {
        selected.add(next.id);
      }
    }

    if (!selected.size) {
      for (const root of roots) selected.add(root);
    }
    return [...selected];
  }

  private enqueueLoad(tileId: string): void {
    if (!this.cfg) return;
    if (this.loaded.has(tileId)) {
      const tile = this.loaded.get(tileId);
      if (tile) tile.lastUsedFrame = this.frameIndex;
      return;
    }
    if (this.inFlight.has(tileId)) return;
    if (this.queue.includes(tileId)) return;
    this.queue.push(tileId);
  }

  private pumpQueue(): void {
    if (!this.cfg) return;
    const maxConcurrent = Math.max(1, this.cfg.maxConcurrentLoads ?? 3);
    while (this.inFlight.size < maxConcurrent && this.queue.length > 0) {
      const tileId = this.queue.shift();
      if (!tileId) break;
      if (this.loaded.has(tileId) || this.inFlight.has(tileId)) continue;
      this.inFlight.add(tileId);
      this.cfg
        .getTile(tileId)
        .then((payload) => {
          if (this.disposed || !this.cfg) return;
          this.loaded.set(tileId, {
            id: tileId,
            payload,
            lastUsedFrame: this.frameIndex,
          });
          const children = this.cfg.getChildren?.(tileId) ?? [];
          for (const childId of children) this.enqueueLoad(childId);
          const resolved = this.resolveWithParentFallback(this.desiredTileIds);
          if (!arraysEqualUnordered(resolved, this.resolvedTileIds)) {
            this.beginTransition(resolved);
            this.resolvedTileIds = resolved;
          }
          if (this.refreshMergedFromActiveWeights()) {
            this.revision += 1;
          }
          this.evictIfNeeded();
        })
        .catch(() => {
          // Keep stream alive on tile failures; fallback/other tiles still render.
        })
        .finally(() => {
          this.inFlight.delete(tileId);
          this.pumpQueue();
        });
    }
  }

  private resolveWithParentFallback(ids: string[]): string[] {
    if (!this.cfg) return [];
    const out = new Set<string>();
    const getParent = (tileId: string): string | undefined =>
      this.cfg?.getParent?.(tileId) ?? this.cfg?.getTileMeta?.(tileId)?.parent;

    for (const wanted of ids) {
      let cur: string | undefined = wanted;
      while (cur) {
        const hit = this.loaded.get(cur);
        if (hit) {
          hit.lastUsedFrame = this.frameIndex;
          out.add(cur);
          break;
        }
        cur = getParent?.(cur);
      }
    }

    if (!out.size) {
      for (const root of this.cfg.rootTileIds) {
        if (this.loaded.has(root)) {
          const hit = this.loaded.get(root);
          if (hit) hit.lastUsedFrame = this.frameIndex;
          out.add(root);
        }
      }
    }

    return [...out];
  }

  private evictIfNeeded(): void {
    if (!this.cfg) return;
    const cap = Math.max(1, this.cfg.maxLoadedTiles ?? 16);
    if (this.loaded.size <= cap) return;

    const protectedIds = new Set([...this.resolvedTileIds, ...this.activeTileIds, ...this.transitionFromIds, ...this.transitionToIds]);
    const candidates = [...this.loaded.values()]
      .filter((t) => !protectedIds.has(t.id))
      .sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);

    while (this.loaded.size > cap && candidates.length > 0) {
      const victim = candidates.shift();
      if (!victim) break;
      this.loaded.delete(victim.id);
    }
  }

  private beginTransition(nextResolvedIds: string[]): void {
    const fromIds = this.activeTileIds.length ? this.activeTileIds : this.resolvedTileIds;
    const frames = Math.max(0, this.cfg?.transitionFrames ?? 12);
    if (!fromIds.length || frames === 0 || arraysEqualUnordered(fromIds, nextResolvedIds)) {
      this.transitioning = false;
      this.transitionFromIds = [];
      this.transitionToIds = [];
      this.activeTileIds = [...new Set(nextResolvedIds)];
      return;
    }

    this.transitioning = true;
    this.transitionStartFrame = this.frameIndex;
    this.transitionFromIds = [...new Set(fromIds)];
    this.transitionToIds = [...new Set(nextResolvedIds)];
    this.activeTileIds = [...new Set([...this.transitionFromIds, ...this.transitionToIds])];
  }

  private refreshMergedFromActiveWeights(): boolean {
    const weights = this.computeActiveWeights();
    const signature = [...weights.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, w]) => `${id}:${w.toFixed(3)}`)
      .join("|");
    if (this.merged && signature === this.lastBlendSignature) {
      return false;
    }
    const nextMerged = mergeTiles(weights, this.loaded);
    this.merged = nextMerged;
    this.lastBlendSignature = signature;
    return true;
  }

  private computeActiveWeights(): Map<string, number> {
    const out = new Map<string, number>();
    if (!this.transitioning) {
      for (const id of this.activeTileIds.length ? this.activeTileIds : this.resolvedTileIds) {
        out.set(id, 1);
      }
      return out;
    }

    const frames = Math.max(1, this.cfg?.transitionFrames ?? 12);
    const p = clamp((this.frameIndex - this.transitionStartFrame) / frames, 0, 1);

    for (const id of this.transitionFromIds) {
      if (this.transitionToIds.includes(id)) out.set(id, 1);
      else out.set(id, 1 - p);
    }
    for (const id of this.transitionToIds) {
      if (this.transitionFromIds.includes(id)) out.set(id, 1);
      else out.set(id, Math.max(out.get(id) ?? 0, p));
    }

    if (p >= 1) {
      this.transitioning = false;
      this.activeTileIds = [...new Set(this.transitionToIds)];
      this.transitionFromIds = [];
      this.transitionToIds = [];
      out.clear();
      for (const id of this.activeTileIds) out.set(id, 1);
    }

    for (const [id, w] of [...out.entries()]) {
      if (w <= 0.001) out.delete(id);
    }
    return out;
  }
}
