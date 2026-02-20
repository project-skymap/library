import type { StarArrangement } from "../../types";

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function sphericalToCartesian(raDeg: number, decDeg: number, radius: number): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const x = radius * Math.cos(dec) * Math.cos(ra);
  const y = radius * Math.sin(dec);
  const z = radius * Math.cos(dec) * Math.sin(ra);
  return [x, y, z];
}

function fallbackPoint(id: string, radius: number): [number, number, number] {
  const u = hash01(`${id}:u`);
  const v = hash01(`${id}:v`);
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return [x, y, z];
}

export function resolvePosition(
  nodeId: string,
  nodeMeta: Record<string, unknown> | undefined,
  arrangement: StarArrangement | undefined,
  radius: number,
): [number, number, number] {
  const arranged = arrangement?.[nodeId]?.position;
  if (arranged) return [arranged[0], arranged[1], arranged[2]];

  const ra = typeof nodeMeta?.ra === "number" ? nodeMeta.ra : undefined;
  const dec = typeof nodeMeta?.dec === "number" ? nodeMeta.dec : undefined;
  if (ra !== undefined && dec !== undefined) {
    return sphericalToCartesian(ra, dec, radius);
  }

  return fallbackPoint(nodeId, radius);
}
