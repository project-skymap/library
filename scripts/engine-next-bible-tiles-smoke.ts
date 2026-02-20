import * as assert from "node:assert/strict";
import { bibleToSceneModel, type BibleJSON } from "../src/adapters/bible";
import { createBibleTileStreaming } from "../src/engine-next/tiles/createBibleTileStreaming";
import { TileStreamingController } from "../src/engine-next/tiles/TileStreamingController";
import type { StarArrangement } from "../src/types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BIBLE: BibleJSON = {
  testaments: [
    {
      name: "OT",
      divisions: [
        {
          name: "Law",
          books: [{ key: "GEN", name: "Genesis", chapters: 2 }],
        },
      ],
    },
  ],
};

const model = bibleToSceneModel(BIBLE);
const arrangement: StarArrangement = {
  "T:OT": { position: [0, 200, -980] },
  "D:OT:Law": { position: [0, 120, -990] },
  "B:GEN": { position: [0, 0, -1000] },
  "C:GEN:1": { position: [-80, 20, -1000] },
  "C:GEN:2": { position: [80, -20, -1000] },
};

async function main(): Promise<void> {
  const streaming = createBibleTileStreaming(model, arrangement, {
    transitionFrames: 0,
    maxLoadedTiles: 8,
    maxConcurrentLoads: 2,
  });

  assert.deepEqual(streaming.rootTileIds, ["tile:root"]);
  const rootPayload = await streaming.getTile("tile:root");
  assert.ok(rootPayload.model.nodes.some((n) => n.id === "T:OT"), "Root tile should include testament node");
  assert.ok(rootPayload.model.nodes.some((n) => n.id === "D:OT:Law"), "Root tile should include division context");

  const bookPayload = await streaming.getTile("B:GEN");
  assert.ok(bookPayload.model.nodes.some((n) => n.id === "C:GEN:1"), "Book tile should include chapter 1");
  assert.ok(bookPayload.model.nodes.some((n) => n.id === "C:GEN:2"), "Book tile should include chapter 2");
  assert.equal(streaming.getParent?.("B:GEN"), "D:OT:Law", "Book tile should report division parent");

  const controller = new TileStreamingController();
  controller.setConfig({
    ...streaming,
    // Force a direct target to the book tile to verify fallback then final resolution.
    selectTiles: () => ["B:GEN"],
  });
  const camera = { yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 45 };
  controller.update(camera, 0);
  await sleep(5);
  controller.update(camera, 1);
  const early = controller.getMergedScene();
  assert.ok(early, "Expected early fallback scene");
  assert.ok(
    (early?.model.nodes ?? []).some((n) => n.id === "B:GEN" || n.id === "D:OT:Law"),
    "Fallback should include ancestor coverage while desired tile is resolving",
  );

  await sleep(5);
  controller.update(camera, 4);
  const settled = controller.getMergedScene();
  assert.ok(settled, "Expected settled merged scene");
  const settledIds = new Set((settled?.model.nodes ?? []).map((n) => n.id));
  assert.ok(settledIds.has("C:GEN:1") && settledIds.has("C:GEN:2"), "Settled scene should include book chapters");

  console.log("engine-next bible tiles smoke: ok", {
    rootTileIds: streaming.rootTileIds,
    settledNodeCount: settled?.model.nodes.length ?? 0,
  });
}

void main();
