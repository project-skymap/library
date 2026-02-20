import * as assert from "node:assert/strict";
import { TileStreamingController } from "../src/engine-next/tiles/TileStreamingController";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const controller = new TileStreamingController();

const parentById: Record<string, string | undefined> = {
  root: undefined,
  a: "root",
  b: "root",
};

async function main(): Promise<void> {
  controller.setConfig({
    enabled: true,
    rootTileIds: ["root"],
    maxConcurrentLoads: 2,
    maxLoadedTiles: 2,
    selectTiles: () => ["a", "b"],
    getParent: (id) => parentById[id],
    getChildren: (id) => (id === "root" ? ["a", "b"] : []),
    getTile: async (id) => {
      if (id === "root") await sleep(10);
      if (id === "a") await sleep(40);
      if (id === "b") await sleep(50);
      return {
        model: {
          nodes: [{ id: `N_${id}`, label: id, level: 3 }],
          links: [],
        },
        arrangement: {
          [`N_${id}`]: { position: [0, 0, -1000] },
        },
      };
    },
  });

  const camera = { yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 50 };

  // Kick off initial requests.
  controller.update(camera, 0);
  await sleep(20);
  controller.update(camera, 1);

  const early = controller.getMergedScene();
  assert.ok(early, "Expected fallback scene once root tile loads");
  assert.equal(early?.model.nodes.length, 1, "Fallback should render one parent tile while children load");
  assert.equal(early?.model.nodes[0]?.id, "N_root");

  await sleep(60);
  controller.update(camera, 2);
  controller.update(camera, 20);

  const settled = controller.getMergedScene();
  assert.ok(settled, "Expected merged scene after child tiles load");
  const ids = new Set((settled?.model.nodes ?? []).map((n) => n.id));
  assert.ok(ids.has("N_a") && ids.has("N_b"), "Merged scene should use desired child tiles");
  assert.equal(ids.has("N_root"), false, "Root tile should no longer be active once children are available");

  console.log("engine-next tiles smoke: ok", {
    activeNodeIds: [...ids].sort(),
  });
}

void main();
