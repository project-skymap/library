import { perlin2, fbm } from "./noise";
import type { SkyGenParams, StarOutput, SkyMetrics, SkyField } from "./types";

// ---------------------------------------------------------------------------
// Stage A — density field
// ---------------------------------------------------------------------------

const GRID = 256;

export function computeDensityAt(
  x: number,
  y: number,
  params: SkyGenParams,
  seed: number,
): number {
  // Domain warp
  const warpSeed1 = seed + 1000;
  const warpSeed2 = seed + 2000;
  const wx = perlin2(x * params.warpScale, y * params.warpScale, warpSeed1) * params.warpStrength;
  const wy = perlin2(x * params.warpScale + 5.2, y * params.warpScale + 1.3, warpSeed2) * params.warpStrength;
  const wx2 = x + wx;
  const wy2 = y + wy;

  // Layered noise
  const low  = fbm(wx2 * params.lowScale,  wy2 * params.lowScale,  4, seed + 3000);
  const mid  = fbm(wx2 * params.midScale,  wy2 * params.midScale,  4, seed + 4000);
  const high = fbm(wx2 * params.highScale, wy2 * params.highScale, 4, seed + 5000);

  const base =
    params.lowWeight  * (low  * 0.5 + 0.5) +
    params.midWeight  * (mid  * 0.5 + 0.5) +
    params.highWeight * (high * 0.5 + 0.5);

  // Galactic band
  const cos = Math.cos(params.bandAngle);
  const sin = Math.sin(params.bandAngle);
  // Band warp via noise
  const bwarp = perlin2(x * 1.5 + 3.7, y * 1.5 + 8.1, seed + 6000) * params.bandWarp;
  const along = x * cos + y * sin + bwarp;
  const perp  = -x * sin + y * cos;
  // Use only perpendicular distance; along is the band direction
  void along;
  const bandShape = Math.exp(-0.5 * (perp * perp) / (params.bandWidth * params.bandWidth));
  const bandVal = params.bandStrength * bandShape;

  // Edge falloff
  const r = Math.sqrt(x * x + y * y);
  const t = Math.max(0, (r - params.edgeFalloffStart) / (1.0 - params.edgeFalloffStart));
  const edgeFalloff = 1 - t * t;

  return Math.max(0, (base + bandVal) * edgeFalloff);
}

export function buildDensityField(params: SkyGenParams): Float32Array {
  const field = new Float32Array(GRID * GRID);
  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      const x = (ix / (GRID - 1)) * 2 - 1;
      const y = (iy / (GRID - 1)) * 2 - 1;
      const r = Math.sqrt(x * x + y * y);
      if (r > 1) {
        field[iy * GRID + ix] = 0;
      } else {
        field[iy * GRID + ix] = computeDensityAt(x, y, params, params.seed);
      }
    }
  }
  return field;
}

export function buildCDF(field: Float32Array): Float32Array {
  const cdf = new Float32Array(field.length);
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += (field[i] as number);
    cdf[i] = sum;
  }
  // Normalize
  if (sum > 0) {
    for (let i = 0; i < cdf.length; i++) {
      cdf[i] = (cdf[i] as number) / sum;
    }
  }
  return cdf;
}

// ---------------------------------------------------------------------------
// Spatial grid for fast NN queries
// ---------------------------------------------------------------------------

class SpatialGrid {
  private cells: Map<number, number[]> = new Map();
  private cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    // Pack two integers into one — handles negative coords
    const ix = cx + 10000;
    const iy = cy + 10000;
    return ix * 100000 + iy;
  }

  private cellCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  add(idx: number, x: number, y: number): void {
    const [cx, cy] = this.cellCoords(x, y);
    const k = this.key(cx, cy);
    let cell = this.cells.get(k);
    if (!cell) { cell = []; this.cells.set(k, cell); }
    cell.push(idx);
  }

  nearestDistanceSq(
    x: number, y: number,
    xs: Float64Array, ys: Float64Array,
    searchRadius: number,
  ): number {
    const [cx, cy] = this.cellCoords(x, y);
    const cells = Math.ceil(searchRadius / this.cellSize) + 1;
    let minDsq = Infinity;

    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const k = this.key(cx + dx, cy + dy);
        const cell = this.cells.get(k);
        if (!cell) continue;
        for (const idx of cell) {
          const ddx = x - (xs[idx] as number);
          const ddy = y - (ys[idx] as number);
          const dsq = ddx * ddx + ddy * ddy;
          if (dsq < minDsq) minDsq = dsq;
        }
      }
    }
    return minDsq;
  }
}

// ---------------------------------------------------------------------------
// Stage B — magnitude sampling + dart throwing
// ---------------------------------------------------------------------------

// Mulberry32 seeded RNG for reproducibility
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleMagnitude(u: number): number {
  const E_MIN = Math.pow(10, 0.6 * 1.0);
  const E_MAX = Math.pow(10, 0.6 * 6.5);
  return Math.log10(u * (E_MAX - E_MIN) + E_MIN) / 0.6;
}

function exclusionRadius(mag: number, baseSep: number): number {
  if (mag < 2.5) return 5.0 * baseSep;
  if (mag < 3.5) return 3.0 * baseSep;
  if (mag < 4.5) return 1.8 * baseSep;
  if (mag < 5.5) return 1.0 * baseSep;
  return 0.6 * baseSep;
}

function sampleFromCDF(cdf: Float32Array, rng: () => number): number {
  const u = rng();
  // Binary search
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cdf[mid] as number) < u) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function diskXYFromCell(cellIdx: number, rng: () => number, jitter: number): [number, number] | null {
  const iy = Math.floor(cellIdx / GRID);
  const ix = cellIdx - iy * GRID;
  const x = ((ix + rng() * jitter - jitter * 0.5) / (GRID - 1)) * 2 - 1;
  const y = ((iy + rng() * jitter - jitter * 0.5) / (GRID - 1)) * 2 - 1;
  if (x * x + y * y > 1) return null;
  return [x, y];
}

function randomDisk(rng: () => number): [number, number] {
  for (;;) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    if (x * x + y * y <= 1) return [x, y];
  }
}

// 3D upper hemisphere from 2D disk coords
function diskTo3D(x: number, y: number): [number, number, number] {
  const r2 = x * x + y * y;
  const y3 = Math.sqrt(Math.max(0, 1 - r2));
  return [x, y3, y];
}

export function generateSky(
  params: SkyGenParams,
  onProgress?: (stage: "density" | "sampling" | "relaxing" | "metrics", pct: number) => void,
): SkyField {
  const rng = makeRng(params.seed);
  const STAR_COUNT = 1189;

  // Stage A
  onProgress?.("density", 0);
  const field = buildDensityField(params);
  const cdf = buildCDF(field);
  onProgress?.("density", 1);

  // Stage B — magnitudes
  onProgress?.("sampling", 0);

  // Sample magnitudes, sort ascending (brightest = lowest mag first)
  const magnitudes: number[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    magnitudes.push(sampleMagnitude(rng() * 0.9999 + 0.00005));
  }
  magnitudes.sort((a, b) => a - b);

  // Flag pair stars: pairFraction of stars with mag > 5.5
  const isPair: boolean[] = new Array(STAR_COUNT).fill(false);
  const dimIndices = magnitudes.reduce<number[]>((acc, m, i) => {
    if (m > 5.5) acc.push(i);
    return acc;
  }, []);
  const pairCount = Math.round(dimIndices.length * params.pairFraction);
  for (let i = 0; i < pairCount; i++) {
    const idx = Math.floor(rng() * dimIndices.length);
    const starIdx = dimIndices[idx];
    if (starIdx !== undefined) isPair[starIdx] = true;
  }

  // Dart throwing
  const xs = new Float64Array(STAR_COUNT);
  const ys = new Float64Array(STAR_COUNT);
  const grid = new SpatialGrid(params.baseSeparation);
  let placed = 0;

  for (let i = 0; i < STAR_COUNT; i++) {
    const mag = magnitudes[i] as number;
    const pair = isPair[i] as boolean;
    const excl = pair ? 0.2 * params.baseSeparation : exclusionRadius(mag, params.baseSeparation);
    const searchR = excl;

    let found = false;

    // Try up to 800 candidates from CDF
    for (let attempt = 0; attempt < 800; attempt++) {
      const cellIdx = sampleFromCDF(cdf, rng);
      const pt = diskXYFromCell(cellIdx, rng, 1.5);
      if (!pt) continue;
      const [cx, cy] = pt;

      const dsq = grid.nearestDistanceSq(cx, cy, xs, ys, searchR * 2);
      if (dsq >= excl * excl) {
        xs[placed] = cx;
        ys[placed] = cy;
        grid.add(placed, cx, cy);
        placed++;
        found = true;
        break;
      }
    }

    if (!found) {
      // Fallback: 50% exclusion
      const halfExcl = excl * 0.5;
      for (let attempt = 0; attempt < 200; attempt++) {
        const cellIdx = sampleFromCDF(cdf, rng);
        const pt = diskXYFromCell(cellIdx, rng, 1.5);
        if (!pt) continue;
        const [cx, cy] = pt;
        const dsq = grid.nearestDistanceSq(cx, cy, xs, ys, halfExcl * 2);
        if (dsq >= halfExcl * halfExcl) {
          xs[placed] = cx;
          ys[placed] = cy;
          grid.add(placed, cx, cy);
          placed++;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Absolute fallback: random disk position
      const [rx, ry] = randomDisk(rng);
      xs[placed] = rx;
      ys[placed] = ry;
      grid.add(placed, rx, ry);
      placed++;
    }

    onProgress?.("sampling", (i + 1) / STAR_COUNT);
  }

  // Stage C — relaxation
  const RELAX_R = params.baseSeparation * 0.85;
  const RELAX_R2 = RELAX_R * RELAX_R;
  const STEP_SIZE = 0.008;

  const fxBuf = new Float64Array(STAR_COUNT);
  const fyBuf = new Float64Array(STAR_COUNT);

  for (let iter = 0; iter < params.relaxIterations; iter++) {
    // Clear forces
    fxBuf.fill(0);
    fyBuf.fill(0);

    // O(n²) short-range repulsion
    for (let i = 0; i < STAR_COUNT; i++) {
      for (let j = i + 1; j < STAR_COUNT; j++) {
        const dx = (xs[i] as number) - (xs[j] as number);
        const dy = (ys[i] as number) - (ys[j] as number);
        const dsq = dx * dx + dy * dy;
        if (dsq < RELAX_R2 && dsq > 1e-12) {
          const d = Math.sqrt(dsq);
          const force = (RELAX_R - d) / RELAX_R;
          const nx = dx / d;
          const ny = dy / d;
          fxBuf[i] = (fxBuf[i] as number) + nx * force;
          fyBuf[i] = (fyBuf[i] as number) + ny * force;
          fxBuf[j] = (fxBuf[j] as number) - nx * force;
          fyBuf[j] = (fyBuf[j] as number) - ny * force;
        }
      }
    }

    // Apply forces and clamp to disk
    for (let i = 0; i < STAR_COUNT; i++) {
      let nx = (xs[i] as number) + (fxBuf[i] as number) * STEP_SIZE;
      let ny = (ys[i] as number) + (fyBuf[i] as number) * STEP_SIZE;
      const r = Math.sqrt(nx * nx + ny * ny);
      if (r > 0.98) {
        nx = (nx / r) * 0.98;
        ny = (ny / r) * 0.98;
      }
      xs[i] = nx;
      ys[i] = ny;
    }

    onProgress?.("relaxing", (iter + 1) / Math.max(1, params.relaxIterations));
  }

  // Build StarOutput array
  const stars: StarOutput[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    const [x3, y3, z3] = diskTo3D(x, y);
    stars.push({
      id: i,
      x,
      y,
      x3,
      y3,
      z3,
      magnitude: magnitudes[i] as number,
    });
  }

  // Metrics
  onProgress?.("metrics", 0);
  const metrics = computeMetrics(stars);
  onProgress?.("metrics", 1);

  return {
    version: 2,
    params,
    stars,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function computeMetrics(stars: StarOutput[]): SkyMetrics {
  const n = stars.length;

  // CDS — 7×7 hex-ish grid, max/mean cell count
  const HEX_ROWS = 7;
  const HEX_COLS = 7;
  const hexCounts = new Int32Array(HEX_ROWS * HEX_COLS);
  for (const s of stars) {
    const gx = Math.floor((s.x * 0.5 + 0.5) * HEX_COLS);
    const gy = Math.floor((s.y * 0.5 + 0.5) * HEX_ROWS);
    const clamped = Math.max(0, Math.min(HEX_COLS - 1, gx)) +
      Math.max(0, Math.min(HEX_ROWS - 1, gy)) * HEX_COLS;
    hexCounts[clamped] = (hexCounts[clamped] as number) + 1;
  }
  let maxCount = 0, sumCount = 0, filledCells = 0;
  for (let i = 0; i < hexCounts.length; i++) {
    const c = hexCounts[i] as number;
    sumCount += c;
    if (c > maxCount) maxCount = c;
    if (c > 0) filledCells++;
  }
  const meanCount = filledCells > 0 ? sumCount / filledCells : 1;
  const clusterDominanceScore = maxCount / Math.max(1, meanCount);

  // NN CV — O(n²) nearest neighbour distances
  const nnDists: number[] = [];
  for (let i = 0; i < n; i++) {
    let minDsq = Infinity;
    const si = stars[i] as StarOutput;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const sj = stars[j] as StarOutput;
      const dx = si.x - sj.x;
      const dy = si.y - sj.y;
      const dsq = dx * dx + dy * dy;
      if (dsq < minDsq) minDsq = dsq;
    }
    nnDists.push(Math.sqrt(minDsq));
  }
  const nnMean = nnDists.reduce((a, b) => a + b, 0) / n;
  const nnVar = nnDists.reduce((a, b) => a + (b - nnMean) ** 2, 0) / n;
  const nearestNeighbourCV = Math.sqrt(nnVar) / Math.max(1e-9, nnMean);

  // Edge gradient ratio — density at r<0.75 vs 0.75<r<0.95 (area-normalized)
  let innerCount = 0, outerCount = 0;
  const innerArea = Math.PI * 0.75 * 0.75;
  const outerArea = Math.PI * (0.95 * 0.95 - 0.75 * 0.75);
  for (const s of stars) {
    const r = Math.sqrt(s.x * s.x + s.y * s.y);
    if (r < 0.75) innerCount++;
    else if (r < 0.95) outerCount++;
  }
  const innerDensity = innerCount / innerArea;
  const outerDensity = outerCount / Math.max(1e-9, outerArea);
  const edgeGradientRatio = outerDensity / Math.max(1e-9, innerDensity);

  // Max void — 25×25 candidate grid
  let maxVoidRadius = 0;
  const VOID_GRID = 25;
  for (let gy = 0; gy < VOID_GRID; gy++) {
    for (let gx = 0; gx < VOID_GRID; gx++) {
      const cx = (gx / (VOID_GRID - 1)) * 2 - 1;
      const cy = (gy / (VOID_GRID - 1)) * 2 - 1;
      if (cx * cx + cy * cy > 1) continue;
      let minDsq = Infinity;
      for (const s of stars) {
        const dx = cx - s.x;
        const dy = cy - s.y;
        const dsq = dx * dx + dy * dy;
        if (dsq < minDsq) minDsq = dsq;
      }
      const d = Math.sqrt(minDsq);
      if (d > maxVoidRadius) maxVoidRadius = d;
    }
  }

  return {
    clusterDominanceScore,
    nearestNeighbourCV,
    maxVoidRadius,
    edgeGradientRatio,
  };
}
