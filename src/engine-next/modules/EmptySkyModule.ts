import type { EngineModule } from "../types/contracts";

export class EmptySkyModule implements EngineModule {
  readonly id = "empty-sky";
  readonly updateOrder = 0;
  readonly renderOrder = 0;
}
