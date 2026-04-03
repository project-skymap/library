export interface SkyGenParams {
  seed: number;
  warpStrength: number;  // 0–0.8, default 0.45
  warpScale: number;     // 0.4–2.0, default 0.9
  lowScale: number;      // 0.3–1.2, default 0.7
  midScale: number;      // 1.5–5.0, default 2.8
  highScale: number;     // 4–12, default 7.5
  lowWeight: number;     // default 0.45
  midWeight: number;     // default 0.40
  highWeight: number;    // default 0.15
  bandStrength: number;  // 0–0.3, default 0.12
  bandAngle: number;     // 0–π, default 0.9
  bandWidth: number;     // 0.15–0.45, default 0.28
  bandWarp: number;      // 0–0.6, default 0.3
  edgeFalloffStart: number;  // 0.55–1.0, default 0.80
  baseSeparation: number;    // 0.018–0.04, default 0.028
  pairFraction: number;      // 0–0.15, default 0.08
  relaxIterations: number;   // 0–40, default 15
  spacingJitter: number;     // 0–1, default 0.4 — ±40% per-star exclusion radius variation
  voidCount: number;         // 0–4, default 2 — explicit low-density voids
  voidStrength: number;      // 0–1, default 0.5 — depth of voids (0=none, 1=full black)
  contrastGamma: number;     // 1–3, default 1.8 — density contrast exponent
}

export const DEFAULT_SKY_PARAMS: SkyGenParams = {
  seed: 42,
  warpStrength: 0.45, warpScale: 0.9,
  lowScale: 0.7, midScale: 2.8, highScale: 7.5,
  lowWeight: 0.45, midWeight: 0.40, highWeight: 0.15,
  bandStrength: 0.12, bandAngle: 0.9, bandWidth: 0.28, bandWarp: 0.3,
  edgeFalloffStart: 0.80,
  baseSeparation: 0.028, pairFraction: 0.08,
  relaxIterations: 15,
  spacingJitter: 0.4, voidCount: 2, voidStrength: 0.65, contrastGamma: 1.8,
};

export interface StarOutput {
  id: number;
  x: number; y: number;             // 2D unit disk position
  x3: number; y3: number; z3: number; // 3D upper hemisphere (y3 = up)
  magnitude: number;                // 1.0–6.5
}

export interface SkyMetrics {
  clusterDominanceScore: number;
  nearestNeighbourCV: number;
  maxVoidRadius: number;
  edgeGradientRatio: number;
}

export interface SkyField {
  version: 2;
  params: SkyGenParams;
  stars: StarOutput[];
  metrics: SkyMetrics;
}
