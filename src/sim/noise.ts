// Seeded 2D gradient noise utilities

const GRADS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707],
];

function ihash(ix: number, iy: number, seed: number): number {
  let h = ((ix * 1619 + iy * 31337 + seed * 6971) | 0);
  h = Math.imul(h ^ (h >>> 13), 0x4C5FE387) ^ (h >>> 17);
  return ((h ^ (h >>> 16)) >>> 0) & 7;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(ix: number, iy: number, seed: number, fx: number, fy: number): number {
  const g = GRADS[ihash(ix, iy, seed)] as [number, number];
  return g[0] * fx + g[1] * fy;
}

export function perlin2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx0 = x - x0;
  const fy0 = y - y0;
  const fx1 = fx0 - 1;
  const fy1 = fy0 - 1;

  const u = fade(fx0);
  const v = fade(fy0);

  const n00 = grad(x0, y0, seed, fx0, fy0);
  const n10 = grad(x1, y0, seed, fx1, fy0);
  const n01 = grad(x0, y1, seed, fx0, fy1);
  const n11 = grad(x1, y1, seed, fx1, fy1);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

export function fbm(x: number, y: number, octaves: number, seed: number): number {
  let value = 0;
  let amplitude = 1;
  let totalAmplitude = 0;
  let freq = 1;

  for (let i = 0; i < octaves; i++) {
    value += perlin2(x * freq, y * freq, seed + i * 137) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    freq *= 2;
  }

  return value / totalAmplitude;
}
