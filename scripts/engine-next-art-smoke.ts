import * as assert from "node:assert/strict";
import * as THREE from "three";
import { ConstellationArtModule } from "../src/engine-next/modules/ConstellationArtModule";
import type { StarMapConfig } from "../src/types";

let fovDeg = 90;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 5000);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);
camera.updateProjectionMatrix();

const mod = new ConstellationArtModule({
  scene,
  camera,
  getCameraState: () => ({ yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg }),
});

const cfg: StarMapConfig = {
  layout: { algorithm: "phyllotaxis" },
  showConstellationArt: true,
  model: {
    nodes: [
      { id: "BOOK_GEN", label: "Genesis", level: 2 },
      { id: "GEN_1", label: "Genesis 1", level: 3, parent: "BOOK_GEN", meta: { __tileBlend: 1 } },
      { id: "GEN_2", label: "Genesis 2", level: 3, parent: "BOOK_GEN", meta: { __tileBlend: 1 } },
    ],
  },
  arrangement: {
    BOOK_GEN: { position: [0, 0, -1000] },
    GEN_1: { position: [-80, 40, -1000] },
    GEN_2: { position: [80, -40, -1000] },
  },
  constellations: {
    version: 1,
    atlasBasePath: ".",
    constellations: [
      {
        id: "BOOK_GEN",
        title: "Genesis",
        type: "book",
        image: "missing-texture.png",
        anchors: ["GEN_1", "GEN_2"],
        center: null,
        radius: 180,
        rotationDeg: 0,
        opacity: 0.9,
        blend: "normal",
        zBias: 0,
        fade: {
          zoomInStart: 80,
          zoomInEnd: 30,
          hoverBoost: 1.5,
          minOpacity: 0.2,
          maxOpacity: 0.8,
        },
      },
    ],
  },
};

mod.setConfig(cfg);
for (let i = 0; i < 16; i++) {
  mod.update({ dtSeconds: 1 / 60, nowMs: i * 16, frameIndex: i });
}

const artMesh = scene.children
  .flatMap((o) => ("children" in o ? (o as THREE.Group).children : []))
  .find((m) => (m as THREE.Mesh).userData?.type === "constellation-art") as THREE.Mesh | undefined;

assert.ok(artMesh, "Expected constellation art mesh");
const mat = artMesh?.material as THREE.MeshBasicMaterial;
const wideOpacity = mat.opacity;
assert.ok(wideOpacity > 0.2, "Wide FOV opacity should be visible");

fovDeg = 20;
for (let i = 16; i < 30; i++) {
  mod.update({ dtSeconds: 1 / 60, nowMs: i * 16, frameIndex: i });
}
const zoomedOpacity = mat.opacity;
assert.ok(zoomedOpacity < wideOpacity, "Zoomed-in opacity should reduce per fade curve");

mod.setHovered("BOOK_GEN");
for (let i = 30; i < 44; i++) {
  mod.update({ dtSeconds: 1 / 60, nowMs: i * 16, frameIndex: i });
}
const hoveredOpacity = mat.opacity;
assert.ok(hoveredOpacity > zoomedOpacity, "Hover boost should increase opacity");

const pickedId = mod.pickAtScreen(400, 300, 800, 600);
assert.equal(pickedId, "BOOK_GEN", "Center pick should hit art mesh");

mod.dispose();

console.log("engine-next art smoke: ok", {
  wideOpacity,
  zoomedOpacity,
  hoveredOpacity,
  pickedId,
});
