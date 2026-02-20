import * as assert from "node:assert/strict";
import { NavigationService } from "../src/engine-next/navigation/NavigationService";
import { InputReplayPlayer, type InputReplayScript } from "../src/engine-next/parity/InputReplay";
import { screenToWorldDir } from "../src/engine-next/navigation/math";

function run(script: InputReplayScript) {
  const nav = new NavigationService();
  const player = new InputReplayPlayer();

  for (let t = 0; t <= 1000; t += 10) {
    const events = player.drainUntil(script, t);
    for (const e of events) {
      if (e.type === "pan") {
        nav.applyEvent({ type: "pan", deltaX: e.deltaX, deltaY: e.deltaY });
      } else if (e.type === "zoom") {
        nav.applyEvent({
          type: "zoom",
          factor: e.factor,
          anchorX: e.anchorX,
          anchorY: e.anchorY,
          viewportWidth: 1280,
          viewportHeight: 720,
        });
      }
    }
  }

  return nav.getState();
}

const script: InputReplayScript = {
  version: 1,
  name: "anchored-zoom-determinism",
  frames: [
    { atMs: 100, event: { type: "pan", deltaX: 34, deltaY: -12, pointer: "mouse" } },
    { atMs: 200, event: { type: "zoom", factor: 1.15, anchorX: 600, anchorY: 300, pointer: "mouse" } },
    { atMs: 300, event: { type: "pan", deltaX: -15, deltaY: 8, pointer: "mouse" } },
    { atMs: 430, event: { type: "zoom", factor: 0.92, anchorX: 220, anchorY: 120, pointer: "mouse" } },
    { atMs: 470, event: { type: "zoom", factor: 1.08, anchorX: 920, anchorY: 540, pointer: "mouse" } },
  ],
};

const a = run(script);
const b = run(script);

assert.equal(a.fovDeg, b.fovDeg, "FOV should be deterministic");
assert.equal(a.yawRad, b.yawRad, "Yaw should be deterministic");
assert.equal(a.pitchRad, b.pitchRad, "Pitch should be deterministic");

assert.ok(a.fovDeg > 1 && a.fovDeg < 140, "FOV should stay within bounds");
assert.ok(a.pitchRad >= -Math.PI / 2 && a.pitchRad <= Math.PI / 2, "Pitch should remain clamped");

// Anchored zoom should preserve the world direction under the pointer.
{
  const nav = new NavigationService();
  const w = 1280;
  const h = 720;
  const ax = 420;
  const ay = 260;
  const before = screenToWorldDir(ax, ay, w, h, nav.getState().fovDeg, nav.getState().yawRad, nav.getState().pitchRad);
  nav.applyEvent({ type: "zoom", factor: 1.2, anchorX: ax, anchorY: ay, viewportWidth: w, viewportHeight: h });
  const after = screenToWorldDir(ax, ay, w, h, nav.getState().fovDeg, nav.getState().yawRad, nav.getState().pitchRad);
  const dot = before[0] * after[0] + before[1] * after[1] + before[2] * after[2];
  const driftRad = Math.acos(Math.max(-1, Math.min(1, dot)));
  assert.ok(driftRad < 0.003, `Anchored zoom drift too high: ${driftRad}`);
}

console.log("engine-next navigation smoke: ok", {
  fovDeg: a.fovDeg,
  yawRad: a.yawRad,
  pitchRad: a.pitchRad,
});
