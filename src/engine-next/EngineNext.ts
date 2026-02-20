import { CoreLoop } from "./core/CoreLoop";
import { NavigationService } from "./navigation/NavigationService";
import { EmptySkyModule } from "./modules/EmptySkyModule";
import type { EngineModule, RenderContext } from "./types/contracts";

export interface EngineNextOptions {
  strictModuleErrors?: boolean;
}

export class EngineNext {
  readonly core: CoreLoop;
  readonly navigation: NavigationService;

  constructor(options: EngineNextOptions = {}) {
    this.core = new CoreLoop({ strictModuleErrors: options.strictModuleErrors });
    this.navigation = new NavigationService();
    this.core.registerModule(new EmptySkyModule());
    this.core.init();
  }

  step(nowMs: number, dtSeconds: number, render: RenderContext): void {
    this.core.update(nowMs, dtSeconds);
    this.core.render(render);
  }

  registerModule(module: EngineModule): void {
    this.core.registerModule(module);
  }

  dispose(): void {
    this.core.dispose();
  }
}
