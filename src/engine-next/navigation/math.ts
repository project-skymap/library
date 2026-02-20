export type Vec3 = readonly [number, number, number];

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function applyYawPitch(v: Vec3, yaw: number, pitch: number): Vec3 {
  // Yaw around Y axis.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = v[0] * cy + v[2] * sy;
  const y1 = v[1];
  const z1 = -v[0] * sy + v[2] * cy;

  // Pitch around X axis.
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x2 = x1;
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  return [x2, y2, z2];
}

export function screenToWorldDir(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  fovDeg: number,
  yawRad: number,
  pitchRad: number,
): Vec3 {
  const nx = (2 * x) / viewportWidth - 1;
  const ny = 1 - (2 * y) / viewportHeight;
  const aspect = viewportWidth / viewportHeight;
  const fovRad = (fovDeg * Math.PI) / 180;
  const tanHalfY = Math.tan(fovRad / 2);
  const tanHalfX = tanHalfY * aspect;

  const camDir = normalize([nx * tanHalfX, ny * tanHalfY, -1]);
  return normalize(applyYawPitch(camDir, yawRad, pitchRad));
}

export function dirToYawPitch(dir: Vec3): { yaw: number; pitch: number } {
  const yaw = -Math.atan2(dir[0], -dir[2]);
  const pitch = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
  return { yaw, pitch };
}
