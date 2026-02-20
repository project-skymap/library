import * as assert from "node:assert/strict";
import * as THREE from "three";
import { ConstellationLinesModule } from "../src/engine-next/modules/ConstellationLinesModule";
import type { SceneModel, StarMapConfig } from "../src/types";

const scene = new THREE.Scene();
const lines = new ConstellationLinesModule({ scene });

const baseModel: SceneModel = {
  nodes: [
    { id: "A", label: "A", level: 3, meta: { __tileBlend: 1 } },
    { id: "B", label: "B", level: 3, meta: { __tileBlend: 1 } },
  ],
  links: [{ source: "A", target: "B" }],
};

const fadedModel: SceneModel = {
  nodes: [
    { id: "A", label: "A", level: 3, meta: { __tileBlend: 0.25 } },
    { id: "B", label: "B", level: 3, meta: { __tileBlend: 0.25 } },
  ],
  links: [{ source: "A", target: "B" }],
};

function firstVertexBlue(cfg: StarMapConfig): number {
  lines.setConfig(cfg);
  const obj = scene.children.find((c) => c.type === "LineSegments") as THREE.LineSegments | undefined;
  assert.ok(obj, "Expected line segments object");
  const colors = obj.geometry.getAttribute("color") as THREE.BufferAttribute;
  return colors.getZ(0);
}

const fullBlue = firstVertexBlue({
  layout: { algorithm: "phyllotaxis" },
  arrangement: {
    A: { position: [0, 0, -1000] },
    B: { position: [80, 0, -1000] },
  },
  model: baseModel,
  showConstellationLines: true,
});

const fadedBlue = firstVertexBlue({
  layout: { algorithm: "phyllotaxis" },
  arrangement: {
    A: { position: [0, 0, -1000] },
    B: { position: [80, 0, -1000] },
  },
  model: fadedModel,
  showConstellationLines: true,
});

assert.ok(fadedBlue < fullBlue, `Expected faded line to be dimmer (${fadedBlue} < ${fullBlue})`);

lines.dispose();

console.log("engine-next line blend smoke: ok", {
  fullBlue,
  fadedBlue,
});

