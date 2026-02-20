# engine-next

Experimental Stellarium-parity rebuild track for Project Skymap.

## Status

Milestone 1 scaffold only.

Included:
- Core loop lifecycle orchestration.
- Deterministic module scheduler.
- Navigation baseline service.
- Pointer/touch normalization and replay contracts.
- Three.js baseline star render module (`config.model` + optional `arrangement`).
- Three.js baseline constellation line module (`model.links`).
- Baseline constellation art module (`showConstellationArt`) with zoom/hover fades.
- Baseline constellation art module (`showConstellationArt`) with zoom/hover fades and eased opacity transitions.
- Point picking and `onSelect` integration on tap.
- Working compatibility actions: `flyTo`, projection mode switch, hover/focus/filter/reveal coloring hooks.
- Baseline adaptation module (tone-mapping exposure + faint-star suppression).
- Tile streaming baseline (async loading + parent fallback + LRU cache).
- Built-in tile selector strategy (metadata + FOV driven) when custom `selectTiles` is omitted.
- Tile transition blending (parent/child cross-fade via per-tile blend weights).
- Constellation line blending tied to tile blend weights.
- Chapter label blending tied to tile blend weights.
- Art hover/pick integration parity for direct constellation interaction.
- Art hover hysteresis (enter/leave debounce) to reduce edge-flicker.
- Configurable art hover debounce (`config.constellationArt.hoverEnterDelayMs/hoverLeaveDelayMs`).
- Bible tile adapter (`createBibleTileStreaming`) for real chapter/book datasets.
- Observer/projection/parity contracts.
- Experimental exports via `library/src/index.ts`.

Not included yet:
- Rendering integration with active `createEngine` runtime.
- Label engine and selection integration.
- Full atmosphere and advanced adaptation parity implementation.

## Usage

```ts
import { EngineNext } from "@project-skymap/library";

const engine = new EngineNext();
engine.step(performance.now(), 1 / 60, {
  pixelRatio: window.devicePixelRatio || 1,
  viewportWidth: 1280,
  viewportHeight: 720,
});
```

React integration (feature flag):

```ts
<StarMap config={{ ...cfg, engineVariant: "next" }} />
```

## Migration strategy

`engine-next` is intentionally isolated from `library/src/engine` to allow
parallel development and parity testing without destabilizing production behavior.

## Smoke check

Run:

```bash
npm run smoke:engine-next-nav
npm run smoke:engine-next-interaction
npm run smoke:engine-next-tiles
npm run smoke:engine-next-selector
npm run smoke:engine-next-tile-blend
npm run smoke:engine-next-line-blend
npm run smoke:engine-next-art
npm run smoke:engine-next-bible-tiles
```

These verify deterministic navigation behavior and interaction/picking baseline.
