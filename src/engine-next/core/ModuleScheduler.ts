import type { EngineModule } from "../types/contracts";

function compareUpdateOrder(a: EngineModule, b: EngineModule): number {
  if (a.updateOrder !== b.updateOrder) return a.updateOrder - b.updateOrder;
  return a.id.localeCompare(b.id);
}

function compareRenderOrder(a: EngineModule, b: EngineModule): number {
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  return a.id.localeCompare(b.id);
}

export class ModuleScheduler {
  private readonly byId = new Map<string, EngineModule>();
  private updateList: EngineModule[] = [];
  private renderList: EngineModule[] = [];

  register(module: EngineModule): void {
    if (this.byId.has(module.id)) {
      throw new Error(`Duplicate module id: ${module.id}`);
    }
    this.byId.set(module.id, module);
    this.rebuild();
  }

  unregister(id: string): void {
    this.byId.delete(id);
    this.rebuild();
  }

  getUpdateModules(): readonly EngineModule[] {
    return this.updateList;
  }

  getRenderModules(): readonly EngineModule[] {
    return this.renderList;
  }

  getModuleCount(): number {
    return this.byId.size;
  }

  private rebuild(): void {
    const modules = [...this.byId.values()];
    this.updateList = modules.slice().sort(compareUpdateOrder);
    this.renderList = modules.slice().sort(compareRenderOrder);
  }
}
