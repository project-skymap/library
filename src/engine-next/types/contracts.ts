export type EnginePhase = "init" | "update" | "render" | "postRender" | "dispose";

export interface FrameTiming {
  readonly dtSeconds: number;
  readonly nowMs: number;
  readonly frameIndex: number;
}

export interface RenderContext {
  readonly pixelRatio: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface EngineModule {
  readonly id: string;
  readonly updateOrder: number;
  readonly renderOrder: number;
  init?(): void;
  update?(timing: FrameTiming): void;
  render?(ctx: RenderContext): void;
  postRender?(ctx: RenderContext): void;
  dispose?(): void;
}

export interface EngineMetrics {
  readonly frameIndex: number;
  readonly lastUpdateMs: number;
  readonly lastRenderMs: number;
  readonly moduleCount: number;
}
