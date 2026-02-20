import { DEFAULT_NAVIGATION_CONFIG } from "../config/defaults";
import type { CameraState, NavigationConfig, PanInput, ZoomInput } from "../types/navigation";
import { dirToYawPitch, screenToWorldDir, type Vec3 } from "./math";

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

type SmoothingConfig = {
  enabled: boolean;
  followHz: number;
};

const DEFAULT_REFERENCE_FOV_DEG = 50;
const ROTATION_LOCK_START_FOV_DEG = 100;

export class NavigationService {
  private readonly config: NavigationConfig;
  private readonly state: CameraState;
  private readonly targetState: CameraState;
  private smoothing: SmoothingConfig = {
    enabled: false,
    followHz: 14,
  };

  constructor(initial?: Partial<CameraState>, config?: Partial<NavigationConfig>) {
    this.config = { ...DEFAULT_NAVIGATION_CONFIG, ...config };
    this.state = {
      yawRad: initial?.yawRad ?? 0,
      pitchRad: initial?.pitchRad ?? 0,
      rollRad: initial?.rollRad ?? 0,
      fovDeg: clamp(initial?.fovDeg ?? 50, this.config.minFovDeg, this.config.maxFovDeg),
    };
    this.targetState = { ...this.state };
  }

  applyPan(input: PanInput): void {
    const base = this.smoothing.enabled ? this.targetState : this.state;
    const speedScale = base.fovDeg / DEFAULT_REFERENCE_FOV_DEG;
    const rotLock = this.config.maxFovDeg > ROTATION_LOCK_START_FOV_DEG
      ? clamp(
        (base.fovDeg - ROTATION_LOCK_START_FOV_DEG) / (this.config.maxFovDeg - ROTATION_LOCK_START_FOV_DEG),
        0,
        1,
      )
      : 0;
    const latNorm = clamp(Math.abs(base.pitchRad) / (Math.PI / 2), 0, 1);
    const latFactor = 1 - rotLock * latNorm;
    const sensitivity = this.config.panSensitivity * speedScale;
    base.yawRad -= input.deltaX * sensitivity;
    base.pitchRad = clamp(
      base.pitchRad - input.deltaY * sensitivity * latFactor,
      -Math.PI / 2,
      Math.PI / 2,
    );
    if (!this.smoothing.enabled) {
      this.targetState.yawRad = this.state.yawRad;
      this.targetState.pitchRad = this.state.pitchRad;
    }
  }

  applyZoom(input: ZoomInput): void {
    const base = this.smoothing.enabled ? this.targetState : this.state;
    const rawFactor = input.zoomFactor <= 0 ? 1 : input.zoomFactor;
    const fovNorm = clamp(
      (base.fovDeg - this.config.minFovDeg) / Math.max(1, this.config.maxFovDeg - this.config.minFovDeg),
      0,
      1,
    );
    const zoomResponse = 0.72 + 0.58 * fovNorm;
    const factor = Math.pow(rawFactor, this.config.zoomSpeed * zoomResponse);
    const next = base.fovDeg / factor;
    base.fovDeg = clamp(next, this.config.minFovDeg, this.config.maxFovDeg);
    if (!this.smoothing.enabled) {
      this.targetState.fovDeg = this.state.fovDeg;
    }
  }

  applyZoomAnchored(input: ZoomInput & {
    anchorX: number;
    anchorY: number;
    viewportWidth: number;
    viewportHeight: number;
  }): void {
    const base = this.smoothing.enabled ? this.targetState : this.state;
    const target = screenToWorldDir(
      input.anchorX,
      input.anchorY,
      input.viewportWidth,
      input.viewportHeight,
      base.fovDeg,
      base.yawRad,
      base.pitchRad,
    );

    const rawFactor = input.zoomFactor <= 0 ? 1 : input.zoomFactor;
    const fovNorm = clamp(
      (base.fovDeg - this.config.minFovDeg) / Math.max(1, this.config.maxFovDeg - this.config.minFovDeg),
      0,
      1,
    );
    const zoomResponse = 0.72 + 0.58 * fovNorm;
    const factor = Math.pow(rawFactor, this.config.zoomSpeed * zoomResponse);
    const nextFov = clamp(base.fovDeg / factor, this.config.minFovDeg, this.config.maxFovDeg);
    base.fovDeg = nextFov;

    // Iterative correction is more stable with coupled yaw/pitch geometry.
    for (let i = 0; i < 5; i++) {
      const current = screenToWorldDir(
        input.anchorX,
        input.anchorY,
        input.viewportWidth,
        input.viewportHeight,
        base.fovDeg,
        base.yawRad,
        base.pitchRad,
      );

      const targetAngles = dirToYawPitch(target);
      const currentAngles = dirToYawPitch(current);
      base.yawRad += shortestAngleDelta(currentAngles.yaw, targetAngles.yaw);
      base.pitchRad = clamp(
        base.pitchRad + (targetAngles.pitch - currentAngles.pitch),
        -Math.PI / 2,
        Math.PI / 2,
      );
    }
    if (!this.smoothing.enabled) {
      this.targetState.yawRad = this.state.yawRad;
      this.targetState.pitchRad = this.state.pitchRad;
      this.targetState.fovDeg = this.state.fovDeg;
    }
  }

  applyEvent(event: { type: "pan"; deltaX: number; deltaY: number } | {
    type: "zoom";
    factor: number;
    anchorX: number;
    anchorY: number;
    viewportWidth: number;
    viewportHeight: number;
  }): void {
    if (event.type === "pan") {
      this.applyPan({ deltaX: event.deltaX, deltaY: event.deltaY });
      return;
    }
    this.applyZoomAnchored({
      zoomFactor: event.factor,
      anchorX: event.anchorX,
      anchorY: event.anchorY,
      viewportWidth: event.viewportWidth,
      viewportHeight: event.viewportHeight,
    });
  }

  setFov(fovDeg: number): void {
    this.state.fovDeg = clamp(fovDeg, this.config.minFovDeg, this.config.maxFovDeg);
    this.targetState.fovDeg = this.state.fovDeg;
  }

  setTargetFov(fovDeg: number): void {
    this.targetState.fovDeg = clamp(fovDeg, this.config.minFovDeg, this.config.maxFovDeg);
    if (!this.smoothing.enabled) {
      this.state.fovDeg = this.targetState.fovDeg;
    }
  }

  setOrientation(yawRad: number, pitchRad: number, rollRad = this.state.rollRad): void {
    this.state.yawRad = yawRad;
    this.state.pitchRad = clamp(pitchRad, -Math.PI / 2, Math.PI / 2);
    this.state.rollRad = rollRad;
    this.targetState.yawRad = this.state.yawRad;
    this.targetState.pitchRad = this.state.pitchRad;
    this.targetState.rollRad = this.state.rollRad;
  }

  setTargetOrientation(yawRad: number, pitchRad: number, rollRad = this.targetState.rollRad): void {
    this.targetState.yawRad = yawRad;
    this.targetState.pitchRad = clamp(pitchRad, -Math.PI / 2, Math.PI / 2);
    this.targetState.rollRad = rollRad;
    if (!this.smoothing.enabled) {
      this.state.yawRad = this.targetState.yawRad;
      this.state.pitchRad = this.targetState.pitchRad;
      this.state.rollRad = this.targetState.rollRad;
    }
  }

  lookAtDirection(dir: Vec3): void {
    const a = dirToYawPitch(dir);
    this.setOrientation(a.yaw, a.pitch, this.state.rollRad);
  }

  update(dtSeconds: number): void {
    if (!this.smoothing.enabled) return;
    const dt = Math.max(0.001, Math.min(0.1, dtSeconds));
    const alpha = 1 - Math.exp(-this.smoothing.followHz * dt);
    this.state.yawRad += shortestAngleDelta(this.state.yawRad, this.targetState.yawRad) * alpha;
    this.state.pitchRad += (this.targetState.pitchRad - this.state.pitchRad) * alpha;
    this.state.rollRad += shortestAngleDelta(this.state.rollRad, this.targetState.rollRad) * alpha;
    this.state.fovDeg += (this.targetState.fovDeg - this.state.fovDeg) * alpha;
    this.state.pitchRad = clamp(this.state.pitchRad, -Math.PI / 2, Math.PI / 2);
    this.state.fovDeg = clamp(this.state.fovDeg, this.config.minFovDeg, this.config.maxFovDeg);
  }

  setSmoothing(enabled: boolean, options?: { followHz?: number }): void {
    const wasEnabled = this.smoothing.enabled;
    this.smoothing.enabled = enabled;
    if (options?.followHz !== undefined) {
      this.smoothing.followHz = Math.max(1, options.followHz);
    }
    if (!enabled) {
      this.state.yawRad = this.targetState.yawRad;
      this.state.pitchRad = this.targetState.pitchRad;
      this.state.rollRad = this.targetState.rollRad;
      this.state.fovDeg = this.targetState.fovDeg;
      return;
    }
    if (wasEnabled) return;
    this.targetState.yawRad = this.state.yawRad;
    this.targetState.pitchRad = this.state.pitchRad;
    this.targetState.rollRad = this.state.rollRad;
    this.targetState.fovDeg = this.state.fovDeg;
  }

  getState(): Readonly<CameraState> {
    return this.state;
  }

  getTargetState(): Readonly<CameraState> {
    return this.targetState;
  }
}
