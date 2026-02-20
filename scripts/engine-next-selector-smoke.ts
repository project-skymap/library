import * as assert from "node:assert/strict";
import { TileStreamingController } from "../src/engine-next/tiles/TileStreamingController";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const controller = new TileStreamingController();

  const meta: Record<string, { centerYawRad: number; centerPitchRad: number; radiusRad: number; parent?: string }> = {
    root: { centerYawRad: 0, centerPitchRad: 0, radiusRad: 1.2 },
    west: { centerYawRad: -0.4, centerPitchRad: 0, radiusRad: 0.35, parent: "root" },
    east: { centerYawRad: 0.4, centerPitchRad: 0, radiusRad: 0.35, parent: "root" },
  };

  controller.setConfig({
    enabled: true,
    rootTileIds: ["root"],
    maxConcurrentLoads: 2,
    getChildren: (id) => (id === "root" ? ["west", "east"] : []),
    getTileMeta: (id) => meta[id],
    selector: { enabled: true, refinementFovDeg: 70, maxDepth: 2, maxSelectedTiles: 4 },
    getTile: async (id) => {
      await sleep(id === "root" ? 5 : 15);
      return {
        model: { nodes: [{ id: `N_${id}`, label: id, level: 3 }], links: [] },
      };
    },
  });

  // Wide FOV: selector should keep root.
  controller.update({ yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 100 }, 0);
  await sleep(10);
  controller.update({ yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 100 }, 1);
  const wide = controller.getMergedScene();
  assert.ok(wide, "Expected merged scene for wide FOV");
  assert.equal(wide?.model.nodes[0]?.id, "N_root");

  // Narrow FOV: selector should refine and prefer child tiles.
  controller.update({ yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 20 }, 2);
  await sleep(30);
  controller.update({ yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 20 }, 3);
  const narrow = controller.getMergedScene();
  assert.ok(narrow, "Expected merged scene for narrow FOV");
  const ids = new Set((narrow?.model.nodes ?? []).map((n) => n.id));
  assert.ok(ids.has("N_west") || ids.has("N_east"), "Narrow FOV should refine into child tiles");

  console.log("engine-next selector smoke: ok", {
    wideNode: wide?.model.nodes[0]?.id,
    narrowNodes: [...ids].sort(),
  });
}

void main();

