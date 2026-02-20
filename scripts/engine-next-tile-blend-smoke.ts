import * as assert from "node:assert/strict";
import { TileStreamingController } from "../src/engine-next/tiles/TileStreamingController";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const controller = new TileStreamingController();

  controller.setConfig({
    enabled: true,
    rootTileIds: ["root"],
    transitionFrames: 8,
    maxConcurrentLoads: 2,
    selectTiles: () => ["child"],
    getParent: (id) => (id === "child" ? "root" : undefined),
    getChildren: (id) => (id === "root" ? ["child"] : []),
    getTile: async (id) => {
      await sleep(id === "root" ? 8 : 28);
      return {
        model: { nodes: [{ id: `N_${id}`, label: id, level: 3 }], links: [] },
      };
    },
  });

  const camera = { yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 45 };
  controller.update(camera, 0);
  await sleep(12);
  controller.update(camera, 1);

  const fallback = controller.getMergedScene();
  assert.ok(fallback, "Expected fallback scene");
  assert.equal(fallback?.model.nodes[0]?.id, "N_root");

  await sleep(30);
  controller.update(camera, 2);
  controller.update(camera, 4);
  const during = controller.getMergedScene();
  assert.ok(during, "Expected blended scene during transition");
  const byId = new Map((during?.model.nodes ?? []).map((n) => [n.id, n] as const));
  const rootBlend = Number(byId.get("N_root")?.meta?.__tileBlend ?? 0);
  const childBlend = Number(byId.get("N_child")?.meta?.__tileBlend ?? 0);
  assert.ok(rootBlend > 0 && rootBlend < 1, `Expected root blend in (0,1), got ${rootBlend}`);
  assert.ok(childBlend > 0 && childBlend < 1, `Expected child blend in (0,1), got ${childBlend}`);

  controller.update(camera, 20);
  const settled = controller.getMergedScene();
  const settledIds = new Set((settled?.model.nodes ?? []).map((n) => n.id));
  assert.ok(settledIds.has("N_child"), "Expected child tile after blend settles");
  assert.equal(settledIds.has("N_root"), false, "Expected root tile removed after transition");

  console.log("engine-next tile blend smoke: ok", {
    during: { rootBlend, childBlend },
    settled: [...settledIds].sort(),
  });
}

void main();

