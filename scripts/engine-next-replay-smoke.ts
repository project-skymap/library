import * as assert from "node:assert/strict";
import { NavigationService } from "../src/engine-next/navigation/NavigationService";
import { InputReplayPlayer, type InputReplayScript } from "../src/engine-next/parity/InputReplay";

const nav = new NavigationService();
const replay = new InputReplayPlayer();
const selected: string[] = [];

const script: InputReplayScript = {
  version: 1,
  name: "interaction-sequence",
  frames: [
    { atMs: 50, event: { type: "pan", deltaX: 24, deltaY: -9, pointer: "mouse" } },
    { atMs: 100, event: { type: "zoom", factor: 1.1, anchorX: 420, anchorY: 260, pointer: "mouse" } },
    { atMs: 150, event: { type: "tap", x: 400, y: 300, pointer: "mouse" } },
    { atMs: 220, event: { type: "zoom", factor: 0.96, anchorX: 620, anchorY: 420, pointer: "mouse" } },
    { atMs: 260, event: { type: "tap", x: 450, y: 310, pointer: "mouse" } },
  ],
};

for (let t = 0; t <= 400; t += 10) {
  const events = replay.drainUntil(script, t);
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
    } else if (e.type === "tap") {
      selected.push(`tap@${e.x},${e.y}`);
    }
  }
}

assert.equal(selected.length, 2, "Replay should process both tap interactions");
assert.ok(replay.isFinished(script), "Replay should be fully consumed");

const s = nav.getState();
assert.ok(s.fovDeg > 1 && s.fovDeg < 140, "FOV should stay bounded");
assert.ok(Number.isFinite(s.yawRad) && Number.isFinite(s.pitchRad), "Camera state should remain finite");

console.log("engine-next replay smoke: ok", {
  selected,
  fovDeg: s.fovDeg,
  yawRad: s.yawRad,
  pitchRad: s.pitchRad,
});
