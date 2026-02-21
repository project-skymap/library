import * as THREE from "three";
import type { EngineModule, FrameTiming } from "../types/contracts";
import { StarRenderModule } from "./StarRenderModule";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export type AdaptationConfig = {
  enabled?: boolean;
  minExposure?: number;
  maxExposure?: number;
  brighteningSpeed?: number;
  darkeningSpeed?: number;
};

export class AdaptationModule implements EngineModule {
  readonly id = "adaptation";
  readonly updateOrder = 160;
  readonly renderOrder = 80;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly stars: StarRenderModule;

  private enabled = true;
  private minExposure = 0.72;
  private maxExposure = 1.4;
  private brighteningSpeed = 1.15;
  private darkeningSpeed = 2.6;

  private exposure = 1.05;
  private targetExposure = 1.05;

  constructor(opts: { renderer: THREE.WebGLRenderer; stars: StarRenderModule }) {
    this.renderer = opts.renderer;
    this.stars = opts.stars;
  }

  setConfig(config: AdaptationConfig | undefined): void {
    if (!config) return;
    this.enabled = config.enabled ?? this.enabled;
    this.minExposure = clamp(config.minExposure ?? this.minExposure, 0.2, 2);
    this.maxExposure = clamp(config.maxExposure ?? this.maxExposure, this.minExposure + 0.05, 2.6);
    this.brighteningSpeed = clamp(config.brighteningSpeed ?? this.brighteningSpeed, 0.2, 10);
    this.darkeningSpeed = clamp(config.darkeningSpeed ?? this.darkeningSpeed, 0.2, 12);
  }

  update(timing: FrameTiming): void {
    if (!this.enabled) {
      this.exposure = this.maxExposure;
      this.targetExposure = this.maxExposure;
      this.renderer.toneMappingExposure = this.exposure;
      this.stars.setAdaptationSuppression(0);
      return;
    }

    const luminance = this.stars.getEstimatedLuminance();
    const norm = clamp((luminance - 0.1) / 1.8, 0, 1);
    this.targetExposure = this.maxExposure - (this.maxExposure - this.minExposure) * norm;

    const speed = this.targetExposure > this.exposure ? this.brighteningSpeed : this.darkeningSpeed;
    const alpha = 1 - Math.exp(-speed * Math.max(0.001, timing.dtSeconds));
    this.exposure += (this.targetExposure - this.exposure) * alpha;
    this.exposure = clamp(this.exposure, this.minExposure, this.maxExposure);

    this.renderer.toneMappingExposure = this.exposure;
    this.stars.setAdaptationSuppression(norm);
  }
}
