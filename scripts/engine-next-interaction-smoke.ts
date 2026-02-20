import * as assert from "node:assert/strict";
import * as THREE from "three";
import { StarRenderModule } from "../src/engine-next/modules/StarRenderModule";
import { ConstellationLinesModule } from "../src/engine-next/modules/ConstellationLinesModule";
import type { SceneModel, StarMapConfig } from "../src/types";

const fakeRenderer = {
  setPixelRatio: (_v: number) => undefined,
  setSize: (_w: number, _h: number, _updateStyle?: boolean) => undefined,
  render: (_scene: THREE.Scene, _camera: THREE.Camera) => undefined,
} as unknown as THREE.WebGLRenderer;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);

const model: SceneModel = {
  nodes: [
    { id: "BOOK_MAT", label: "Matthew", level: 2 },
    { id: "MAT_1", label: "Matthew 1", level: 3, parent: "BOOK_MAT", meta: { bookKey: "MAT", testament: "NT", division: "Gospels" } },
    { id: "MAT_2", label: "Matthew 2", level: 3, parent: "BOOK_MAT", meta: { bookKey: "MAT", testament: "NT", division: "Gospels" } },
  ],
  links: [{ source: "MAT_1", target: "MAT_2" }],
};

const cfg: StarMapConfig = {
  layout: { algorithm: "phyllotaxis" },
  model,
  arrangement: {
    MAT_1: { position: [0, 0, -1000] },
    MAT_2: { position: [80, 0, -1000] },
  },
  showConstellationLines: true,
};

const stars = new StarRenderModule({
  renderer: fakeRenderer,
  scene,
  camera,
  getCameraState: () => ({ yawRad: 0, pitchRad: 0, rollRad: 0, fovDeg: 50 }),
});

stars.setConfig(cfg);
stars.render({ pixelRatio: 1, viewportWidth: 800, viewportHeight: 600 });

const pickedCenter = stars.pickAtScreen(400, 300, 800, 600);
assert.ok(pickedCenter, "Center pick should hit at least one point");

stars.setHoveredBook("BOOK_MAT");
stars.setFocusedBook("BOOK_MAT");
stars.setHierarchyFilter({ bookKey: "MAT" });
stars.setOrderRevealEnabled(false);
stars.setProjectionMode("stereographic");

const lines = new ConstellationLinesModule({ scene });
lines.setConfig(cfg);
assert.ok(scene.children.length >= 1, "Scene should have drawable objects after lines setup");
lines.setVisible(false);
lines.dispose();
stars.dispose();

console.log("engine-next interaction smoke: ok", {
  picked: pickedCenter?.id,
  sceneChildren: scene.children.length,
});
