import { ModuleScheduler } from "./ModuleScheduler";
import type { EngineMetrics, EngineModule, FrameTiming, Logger, RenderContext } from "../types/contracts";
import { DEFAULT_ENGINE_CONFIG } from "../config/defaults";

const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface CoreLoopOptions {
  logger?: Logger;
  strictModuleErrors?: boolean;
}

export class CoreLoop {
  private readonly scheduler = new ModuleScheduler();
  private readonly logger: Logger;
  private readonly strictModuleErrors: boolean;

  private frameIndex = 0;
  private initialized = false;
  private lastUpdateMs = 0;
  private lastRenderMs = 0;

  constructor(options: CoreLoopOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER;
    this.strictModuleErrors = options.strictModuleErrors ?? DEFAULT_ENGINE_CONFIG.strictModuleErrors;
  }

  registerModule(module: EngineModule): void {
    this.scheduler.register(module);
    if (this.initialized) {
      this.invoke("init", () => module.init?.(), module.id);
    }
  }

  init(): void {
    if (this.initialized) return;
    for (const module of this.scheduler.getUpdateModules()) {
      this.invoke("init", () => module.init?.(), module.id);
    }
    this.initialized = true;
  }

  update(nowMs: number, dtSeconds: number): void {
    this.ensureInitialized();
    const start = performance.now();
    const timing: FrameTiming = { dtSeconds, nowMs, frameIndex: this.frameIndex };
    for (const module of this.scheduler.getUpdateModules()) {
      this.invoke("update", () => module.update?.(timing), module.id);
    }
    this.lastUpdateMs = performance.now() - start;
  }

  render(ctx: RenderContext): void {
    this.ensureInitialized();
    const start = performance.now();
    for (const module of this.scheduler.getRenderModules()) {
      this.invoke("render", () => module.render?.(ctx), module.id);
    }
    for (const module of this.scheduler.getRenderModules()) {
      this.invoke("postRender", () => module.postRender?.(ctx), module.id);
    }
    this.lastRenderMs = performance.now() - start;
    this.frameIndex += 1;
  }

  dispose(): void {
    const modules = [...this.scheduler.getUpdateModules()].reverse();
    for (const module of modules) {
      this.invoke("dispose", () => module.dispose?.(), module.id);
    }
  }

  getMetrics(): EngineMetrics {
    return {
      frameIndex: this.frameIndex,
      lastUpdateMs: this.lastUpdateMs,
      lastRenderMs: this.lastRenderMs,
      moduleCount: this.scheduler.getModuleCount(),
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("CoreLoop.init() must be called before update/render");
    }
  }

  private invoke(phase: string, fn: () => void, moduleId: string): void {
    try {
      fn();
    } catch (error) {
      this.logger.error(`Module ${phase} failed`, {
        moduleId,
        phase,
        error,
      });
      if (this.strictModuleErrors) {
        throw error;
      }
    }
  }
}
