import type { SceneModel, SceneNode, StarArrangement, StarMapConfig } from "../../types";

type TilePayload = {
  model: SceneModel;
  arrangement?: StarArrangement;
};

type BibleTileAdapterOptions = {
  maxLoadedTiles?: number;
  maxConcurrentLoads?: number;
  transitionFrames?: number;
  selector?: NonNullable<NonNullable<StarMapConfig["tileStreaming"]>["selector"]>;
};

type TileMeta = {
  centerYawRad: number;
  centerPitchRad: number;
  radiusRad: number;
  parent?: string;
};

const ROOT_TILE_ID = "tile:root";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function dirToYawPitch(x: number, y: number, z: number): { yawRad: number; pitchRad: number } {
  const yawRad = -Math.atan2(x, -z);
  const pitchRad = Math.atan2(y, Math.hypot(x, z));
  return { yawRad, pitchRad };
}

function angularDistance(yawA: number, pitchA: number, yawB: number, pitchB: number): number {
  let dYaw = (yawA - yawB) % (Math.PI * 2);
  if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  return Math.hypot(dYaw, pitchA - pitchB);
}

function hash01(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function fallbackPosition(id: string): [number, number, number] {
  const a = hash01(`${id}:a`) * Math.PI * 2;
  const b = (hash01(`${id}:b`) - 0.5) * Math.PI * 0.7;
  const cp = Math.cos(b);
  return [Math.sin(a) * cp, Math.sin(b), -Math.cos(a) * cp];
}

function idByLevel(model: SceneModel): {
  testaments: SceneNode[];
  divisions: SceneNode[];
  books: SceneNode[];
  chapters: SceneNode[];
  byId: Map<string, SceneNode>;
  childrenByParent: Map<string, SceneNode[]>;
} {
  const byId = new Map(model.nodes.map((n) => [n.id, n] as const));
  const childrenByParent = new Map<string, SceneNode[]>();
  for (const n of model.nodes) {
    if (!n.parent) continue;
    const list = childrenByParent.get(n.parent) ?? [];
    list.push(n);
    childrenByParent.set(n.parent, list);
  }
  return {
    testaments: model.nodes.filter((n) => n.level === 0),
    divisions: model.nodes.filter((n) => n.level === 1),
    books: model.nodes.filter((n) => n.level === 2),
    chapters: model.nodes.filter((n) => n.level >= 3),
    byId,
    childrenByParent,
  };
}

function buildSubset(
  model: SceneModel,
  nodeIds: Set<string>,
  arrangement?: StarArrangement,
): TilePayload {
  const nodes = model.nodes.filter((n) => nodeIds.has(n.id));
  const links = (model.links ?? []).filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));
  if (!arrangement) {
    return { model: { nodes, links } };
  }
  const out: StarArrangement = {};
  let hasAny = false;
  for (const id of nodeIds) {
    const p = arrangement[id];
    if (!p) continue;
    out[id] = p;
    hasAny = true;
  }
  return {
    model: { nodes, links },
    arrangement: hasAny ? out : undefined,
  };
}

function collectDescendants(startId: string, childrenByParent: Map<string, SceneNode[]>): Set<string> {
  const out = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    if (!id || out.has(id)) continue;
    out.add(id);
    for (const child of childrenByParent.get(id) ?? []) queue.push(child.id);
  }
  return out;
}

function pointsForIds(nodeIds: Iterable<string>, arrangement: StarArrangement | undefined): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (const id of nodeIds) {
    const p = arrangement?.[id]?.position;
    if (p) {
      const len = Math.hypot(p[0], p[1], p[2]) || 1;
      points.push([p[0] / len, p[1] / len, p[2] / len]);
    } else {
      points.push(fallbackPosition(id));
    }
  }
  return points;
}

function computeMeta(points: Array<[number, number, number]>, parent?: string): TileMeta {
  if (!points.length) {
    return { centerYawRad: 0, centerPitchRad: 0, radiusRad: 1.2, parent };
  }
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    sx += p[0];
    sy += p[1];
    sz += p[2];
  }
  const len = Math.hypot(sx, sy, sz) || 1;
  const cx = sx / len;
  const cy = sy / len;
  const cz = sz / len;
  const c = dirToYawPitch(cx, cy, cz);
  let radiusRad = 0.12;
  for (const p of points) {
    const a = dirToYawPitch(p[0], p[1], p[2]);
    radiusRad = Math.max(radiusRad, angularDistance(a.yawRad, a.pitchRad, c.yawRad, c.pitchRad));
  }
  radiusRad = clamp(radiusRad * 1.2, 0.08, Math.PI);
  return {
    centerYawRad: c.yawRad,
    centerPitchRad: c.pitchRad,
    radiusRad,
    parent,
  };
}

export function createBibleTileStreaming(
  model: SceneModel,
  arrangement?: StarArrangement,
  options: BibleTileAdapterOptions = {},
): NonNullable<StarMapConfig["tileStreaming"]> {
  const { testaments, divisions, books, childrenByParent } = idByLevel(model);
  const tilePayloadById = new Map<string, TilePayload>();
  const tileChildrenById = new Map<string, string[]>();
  const tileMetaById = new Map<string, TileMeta>();

  const allRootIds = new Set<string>();
  for (const t of testaments) allRootIds.add(t.id);
  if (!allRootIds.size) for (const d of divisions) allRootIds.add(d.id);
  if (!allRootIds.size) for (const b of books) allRootIds.add(b.id);

  // Root tile includes top-level navigation context.
  {
    const rootNodeIds = new Set<string>(allRootIds);
    for (const t of testaments) {
      for (const d of childrenByParent.get(t.id) ?? []) rootNodeIds.add(d.id);
    }
    tilePayloadById.set(ROOT_TILE_ID, buildSubset(model, rootNodeIds, arrangement));
    tileChildrenById.set(ROOT_TILE_ID, [...allRootIds]);
    tileMetaById.set(ROOT_TILE_ID, {
      centerYawRad: 0,
      centerPitchRad: 0,
      radiusRad: Math.PI,
    });
  }

  // Testament/division tiles include their descendants for meaningful fallback detail.
  for (const t of testaments) {
    const descendantIds = collectDescendants(t.id, childrenByParent);
    tilePayloadById.set(t.id, buildSubset(model, descendantIds, arrangement));
    tileChildrenById.set(
      t.id,
      (childrenByParent.get(t.id) ?? []).filter((n) => n.level === 1).map((n) => n.id),
    );
    tileMetaById.set(t.id, computeMeta(pointsForIds(descendantIds, arrangement), ROOT_TILE_ID));
  }

  for (const d of divisions) {
    const descendantIds = collectDescendants(d.id, childrenByParent);
    tilePayloadById.set(d.id, buildSubset(model, descendantIds, arrangement));
    tileChildrenById.set(
      d.id,
      (childrenByParent.get(d.id) ?? []).filter((n) => n.level === 2).map((n) => n.id),
    );
    tileMetaById.set(d.id, computeMeta(pointsForIds(descendantIds, arrangement), d.parent));
  }

  // Book tiles are chapter-dense leaves.
  for (const b of books) {
    const descendantIds = collectDescendants(b.id, childrenByParent);
    tilePayloadById.set(b.id, buildSubset(model, descendantIds, arrangement));
    tileChildrenById.set(b.id, []);
    tileMetaById.set(b.id, computeMeta(pointsForIds(descendantIds, arrangement), b.parent));
  }

  return {
    enabled: true,
    rootTileIds: [ROOT_TILE_ID],
    maxLoadedTiles: options.maxLoadedTiles ?? 24,
    maxConcurrentLoads: options.maxConcurrentLoads ?? 4,
    transitionFrames: options.transitionFrames ?? 10,
    selector: options.selector,
    getTile: async (tileId: string) => {
      const payload = tilePayloadById.get(tileId);
      if (!payload) {
        return { model: { nodes: [], links: [] } };
      }
      return payload;
    },
    getChildren: (tileId: string) => tileChildrenById.get(tileId) ?? [],
    getParent: (tileId: string) => tileMetaById.get(tileId)?.parent,
    getTileMeta: (tileId: string) => tileMetaById.get(tileId),
  };
}

