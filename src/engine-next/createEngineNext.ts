import type { HierarchyFilter, SceneNode, StarArrangement, StarMapConfig } from "../types";
import { EngineNext } from "./EngineNext";
import { InputNormalizer } from "./input/InputNormalizer";
import type { EngineInputEvent } from "./input/InputEventTypes";
import * as THREE from "three";
import { StarRenderModule } from "./modules/StarRenderModule";
import { dirToYawPitch } from "./navigation/math";
import { ConstellationLinesModule } from "./modules/ConstellationLinesModule";
import { ChapterLabelsModule } from "./modules/ChapterLabelsModule";
import { AdaptationModule } from "./modules/AdaptationModule";
import { TileStreamingController } from "./tiles/TileStreamingController";
import { ConstellationArtModule } from "./modules/ConstellationArtModule";

type Handlers = {
  onSelect?: (node: SceneNode) => void;
  onHover?: (node?: SceneNode) => void;
  onArrangementChange?: (arrangement: StarArrangement) => void;
  onFovChange?: (fov: number) => void;
  onLongPress?: (node: SceneNode | null, x: number, y: number) => void;
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function shortestAngleDelta(current: number, target: number): number {
  const twoPi = Math.PI * 2;
  let d = (target - current) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
}

export function createEngineNext({
  container,
  onSelect,
  onHover,
  onArrangementChange,
  onFovChange,
  onLongPress,
}: {
  container: HTMLDivElement;
  onSelect?: Handlers["onSelect"];
  onHover?: Handlers["onHover"];
  onArrangementChange?: Handlers["onArrangementChange"];
  onFovChange?: Handlers["onFovChange"];
  onLongPress?: Handlers["onLongPress"];
}) {
  const runtime = new EngineNext();
  runtime.navigation.setSmoothing(true, { followHz: 16 });
  const input = new InputNormalizer();
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02050d);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);

  const stars = new StarRenderModule({
    renderer,
    scene,
    camera,
    getCameraState: () => runtime.navigation.getState(),
  });
  const lines = new ConstellationLinesModule({ scene });
  const art = new ConstellationArtModule({
    scene,
    camera,
    getCameraState: () => runtime.navigation.getState(),
  });
  const adaptation = new AdaptationModule({ renderer, stars });
  const tiles = new TileStreamingController();
  const labelOverlay = document.createElement("div");
  labelOverlay.style.position = "absolute";
  labelOverlay.style.inset = "0";
  labelOverlay.style.pointerEvents = "none";
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.appendChild(labelOverlay);
  const labels = new ChapterLabelsModule({
    overlay: labelOverlay,
    camera,
    getEntries: () => stars.getLabelEntries(),
  });
  runtime.registerModule(stars);
  runtime.registerModule(lines);
  runtime.registerModule(art);
  runtime.registerModule(adaptation);
  runtime.registerModule(labels);
  let handlers: Handlers = { onSelect, onHover, onArrangementChange, onFovChange, onLongPress };
  let config: StarMapConfig | undefined;
  let projectionMode: "perspective" | "stereographic" | "blended" = "perspective";
  let running = false;
  let raf = 0;
  let lastNow = 0;
  let lastEmittedFov = runtime.navigation.getState().fovDeg;
  let adaptiveDprScale = 0.9;
  let smoothFrameMs = 16.7;
  let lowPerfLabelSuppression = false;
  let lowPerfFrameSkipping = false;
  let loopFrameIndex = 0;
  let hoveredNodeId: string | null = null;
  let selectedNodeId: string | null = null;
  let activeConfigRevision = -1;
  let lastEffectivePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const activePointerIds = new Set<number>();
  let inertiaYawVel = 0;
  let inertiaPitchVel = 0;
  let inertiaPointer: "mouse" | "touch" | "pen" = "mouse";
  let lastPanSampleAtMs = 0;

  function emitNavigation(): void {
    handlers.onFovChange?.(runtime.navigation.getState().fovDeg);
  }

  function maybeEmitNavigation(): void {
    const fov = runtime.navigation.getState().fovDeg;
    if (Math.abs(fov - lastEmittedFov) > 1e-3) {
      lastEmittedFov = fov;
      handlers.onFovChange?.(fov);
    }
  }

  function applySceneConfig(next: StarMapConfig): void {
    const merged = tiles.getMergedScene();
    if (merged) {
      const streamedCfg: StarMapConfig = {
        ...next,
        model: merged.model,
        arrangement: merged.arrangement ?? next.arrangement,
      };
      stars.setConfig(streamedCfg);
      lines.setConfig(streamedCfg);
      art.setConfig(streamedCfg);
      return;
    }
    stars.setConfig(next);
    lines.setConfig(next);
    art.setConfig(next);
  }

  function applyBackground(background: StarMapConfig["background"]): void {
    if (background === "transparent") {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      return;
    }
    if (typeof background === "string" && background.trim().length > 0) {
      scene.background = new THREE.Color(background);
      renderer.setClearColor(new THREE.Color(background), 1);
      return;
    }
    scene.background = new THREE.Color(0x02050d);
    renderer.setClearColor(0x02050d, 1);
  }

  function handleEvent(event: EngineInputEvent): void {
    if (event.type === "pan") {
      const before = runtime.navigation.getTargetState();
      runtime.navigation.applyEvent({
        type: "pan",
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      const after = runtime.navigation.getTargetState();
      const now = performance.now();
      const dt = Math.max(1 / 240, Math.min(1 / 10, (now - (lastPanSampleAtMs || now - 16.7)) / 1000));
      const yawDelta = shortestAngleDelta(before.yawRad, after.yawRad);
      const pitchDelta = after.pitchRad - before.pitchRad;
      inertiaYawVel = yawDelta / dt;
      inertiaPitchVel = pitchDelta / dt;
      inertiaPointer = event.pointer;
      lastPanSampleAtMs = now;
      return;
    }
    if (event.type === "zoom") {
      inertiaYawVel = 0;
      inertiaPitchVel = 0;
      runtime.navigation.applyEvent({
        type: "zoom",
        factor: event.factor,
        anchorX: event.anchorX,
        anchorY: event.anchorY,
        viewportWidth: container.clientWidth || 1,
        viewportHeight: container.clientHeight || 1,
      });
      return;
    }
    if (event.type === "tap") {
      const pickedStar = stars.pickAtScreen(
        event.x,
        event.y,
        container.clientWidth || 1,
        container.clientHeight || 1,
      );
      const artId = !pickedStar
        ? art.pickAtScreen(event.x, event.y, container.clientWidth || 1, container.clientHeight || 1)
        : undefined;
      const picked = pickedStar ?? (artId ? stars.getNodeById(artId) : undefined);
      if (picked) {
        selectedNodeId = picked.id;
        art.setFocused(picked.id);
        stars.setSelectedNode(selectedNodeId);
        lines.setSelectedNode(selectedNodeId);
        labels.setSelectedId(selectedNodeId);
        handlers.onSelect?.(picked);
      }
      handlers.onLongPress?.(picked ?? null, event.x, event.y);
    }
  }

  function onPointerDown(ev: PointerEvent): void {
    activePointerIds.add(ev.pointerId);
    if (activePointerIds.size > 1) {
      inertiaYawVel = 0;
      inertiaPitchVel = 0;
    }
    const rect = container.getBoundingClientRect();
    const events = input.onPointerDown({
      id: ev.pointerId,
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      pointer: ev.pointerType === "mouse" || ev.pointerType === "touch" || ev.pointerType === "pen" ? ev.pointerType : "mouse",
    });
    for (const e of events) handleEvent(e);
    (ev.target as Element | null)?.setPointerCapture?.(ev.pointerId);
  }

  function onPointerMove(ev: PointerEvent): void {
    const rect = container.getBoundingClientRect();
    const events = input.onPointerMove({
      id: ev.pointerId,
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      pointer: ev.pointerType === "mouse" || ev.pointerType === "touch" || ev.pointerType === "pen" ? ev.pointerType : "mouse",
    });
    for (const e of events) handleEvent(e);
    const picked = stars.pickAtScreen(
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      container.clientWidth || 1,
      container.clientHeight || 1,
    );
    const artId = !picked
      ? art.pickAtScreen(
        ev.clientX - rect.left,
        ev.clientY - rect.top,
        container.clientWidth || 1,
        container.clientHeight || 1,
      )
      : undefined;
    const pickedNode = picked ?? (artId ? stars.getNodeById(artId) : undefined);
    const pickedId = pickedNode?.id ?? null;
    if (pickedId !== hoveredNodeId) {
      hoveredNodeId = pickedId;
      art.setHovered(pickedId);
      handlers.onHover?.(pickedNode);
    }
  }

  function onPointerUp(ev: PointerEvent): void {
    activePointerIds.delete(ev.pointerId);
    const rect = container.getBoundingClientRect();
    const events = input.onPointerUp({
      id: ev.pointerId,
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      pointer: ev.pointerType === "mouse" || ev.pointerType === "touch" || ev.pointerType === "pen" ? ev.pointerType : "mouse",
    });
    for (const e of events) handleEvent(e);
  }

  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = container.getBoundingClientRect();
    const events = input.onWheel(ev.deltaY, ev.clientX - rect.left, ev.clientY - rect.top);
    for (const e of events) handleEvent(e);
  }

  function loop(now: number): void {
    if (!running) return;
    loopFrameIndex += 1;
    const dt = lastNow === 0 ? 1 / 60 : Math.max(0.001, (now - lastNow) / 1000);
    const frameMs = lastNow === 0 ? 16.7 : Math.max(1, now - lastNow);
    lastNow = now;

    runtime.navigation.update(dt);
    if (activePointerIds.size === 0) {
      const speed = Math.hypot(inertiaYawVel, inertiaPitchVel);
      if (speed > 1e-4) {
        const nav = runtime.navigation.getTargetState();
        const fovNorm = clamp((nav.fovDeg - 10) / 110, 0, 1);
        const inertiaGain = 1.05 - 0.48 * fovNorm;
        const speedCap = 2.3 - 1.2 * fovNorm;
        const dampingPerSec = (inertiaPointer === "touch" ? 6.8 : 8.6) + 3.1 * fovNorm;
        const capped = Math.max(1e-6, Math.min(speed, speedCap));
        const scale = capped / Math.max(1e-6, speed);
        inertiaYawVel *= scale;
        inertiaPitchVel *= scale;
        const decay = Math.exp(-dampingPerSec * dt);
        runtime.navigation.setTargetOrientation(
          nav.yawRad + inertiaYawVel * dt * inertiaGain,
          nav.pitchRad + inertiaPitchVel * dt * inertiaGain,
          nav.rollRad,
        );
        if (capped < 0.045) {
          const softStop = Math.exp(-11 * dt);
          inertiaYawVel *= softStop;
          inertiaPitchVel *= softStop;
        }
        inertiaYawVel *= decay;
        inertiaPitchVel *= decay;
      } else {
        inertiaYawVel = 0;
        inertiaPitchVel = 0;
      }
    }
    maybeEmitNavigation();

    if (config?.tileStreaming && config.tileStreaming.enabled !== false) {
      const frameIndex = runtime.core.getMetrics().frameIndex;
      const changed = tiles.update(runtime.navigation.getState(), frameIndex);
      const rev = tiles.getRevision();
      if (changed || rev !== activeConfigRevision) {
        activeConfigRevision = rev;
        applySceneConfig(config);
      }
    }

    smoothFrameMs = smoothFrameMs * 0.86 + frameMs * 0.14;
    if (smoothFrameMs > 28) {
      adaptiveDprScale = Math.max(0.45, adaptiveDprScale - 0.08);
    } else if (smoothFrameMs < 17) {
      adaptiveDprScale = Math.min(1, adaptiveDprScale + 0.02);
    }
    if (!lowPerfLabelSuppression && smoothFrameMs > 45) {
      lowPerfLabelSuppression = true;
    } else if (lowPerfLabelSuppression && smoothFrameMs < 28) {
      lowPerfLabelSuppression = false;
    }
    if (!lowPerfFrameSkipping && smoothFrameMs > 75) {
      lowPerfFrameSkipping = true;
    } else if (lowPerfFrameSkipping && smoothFrameMs < 48) {
      lowPerfFrameSkipping = false;
    }

    const effectivePixelRatio = clamp((window.devicePixelRatio || 1) * adaptiveDprScale, 0.35, 1.6);
    lastEffectivePixelRatio = effectivePixelRatio;
    const renderDecorations = !lowPerfFrameSkipping;
    lines.setVisible((config?.showConstellationLines ?? true) && renderDecorations);
    art.setRuntimeVisible(renderDecorations);
    labels.setVisible((config?.showChapterLabels ?? true) && !lowPerfLabelSuppression);
    if (lowPerfFrameSkipping && loopFrameIndex % 2 === 0) {
      raf = requestAnimationFrame(loop);
      return;
    }
    runtime.step(now, dt, {
      pixelRatio: effectivePixelRatio,
      viewportWidth: container.clientWidth || 1,
      viewportHeight: container.clientHeight || 1,
    });
    raf = requestAnimationFrame(loop);
  }

  function attachEvents(): void {
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });
  }

  function detachEvents(): void {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
  }

  attachEvents();

  return {
    setConfig(next: StarMapConfig) {
      config = next;
      projectionMode = next.projection ?? projectionMode;
      applyBackground(next.background);
      stars.setProjectionMode(projectionMode);
      tiles.setConfig(next.tileStreaming);
      activeConfigRevision = tiles.getRevision();
      applySceneConfig(next);
      adaptation.setConfig(next.adaptation);
      labels.setVisible(next.showChapterLabels ?? true);
      if (next.arrangement) {
        handlers.onArrangementChange?.(next.arrangement);
      }
    },
    setHandlers(next: Handlers) {
      handlers = next;
    },
    start() {
      if (running) return;
      running = true;
      lastNow = 0;
      smoothFrameMs = 16.7;
      adaptiveDprScale = 0.9;
      lowPerfLabelSuppression = false;
      lowPerfFrameSkipping = false;
      loopFrameIndex = 0;
      activePointerIds.clear();
      inertiaYawVel = 0;
      inertiaPitchVel = 0;
      lastPanSampleAtMs = 0;
      lastEmittedFov = runtime.navigation.getState().fovDeg;
      emitNavigation();
      raf = requestAnimationFrame(loop);
    },
    dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      detachEvents();
      activePointerIds.clear();
      inertiaYawVel = 0;
      inertiaPitchVel = 0;
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      if (labelOverlay.parentElement === container) {
        container.removeChild(labelOverlay);
      }
      tiles.dispose();
      runtime.dispose();
    },

    // Compatibility stubs with legacy imperative API.
    getFullArrangement(): StarArrangement | undefined {
      return stars.getArrangement();
    },
    setHoveredBook(_id: string | null): void {
      stars.setHoveredBook(_id);
      art.setHovered(_id);
    },
    setFocusedBook(_id: string | null): void {
      stars.setFocusedBook(_id);
      art.setFocused(_id);
      selectedNodeId = _id;
      stars.setSelectedNode(_id);
      lines.setSelectedNode(_id);
      labels.setSelectedId(_id);
    },
    setOrderRevealEnabled(_enabled: boolean): void {
      stars.setOrderRevealEnabled(_enabled);
    },
    setHierarchyFilter(_filter: HierarchyFilter | null): void {
      stars.setHierarchyFilter(_filter);
    },
    flyTo(_nodeId: string, _targetFov?: number): void {
      const p = stars.getWorldPositionById(_nodeId);
      if (!p) return;
      const len = Math.hypot(p[0], p[1], p[2]) || 1;
      const dir: [number, number, number] = [p[0] / len, p[1] / len, p[2] / len];
      const angles = dirToYawPitch(dir);
      runtime.navigation.setTargetOrientation(angles.yaw, angles.pitch);
      if (_targetFov !== undefined) {
        runtime.navigation.setTargetFov(_targetFov);
      }
      selectedNodeId = _nodeId;
      stars.setSelectedNode(_nodeId);
      lines.setSelectedNode(_nodeId);
      labels.setSelectedId(_nodeId);
    },
    setProjection(_id: "perspective" | "stereographic" | "blended"): void {
      projectionMode = _id;
      stars.setProjectionMode(_id);
    },
    getDebugState(): Record<string, unknown> {
      const nav = runtime.navigation.getState();
      const core = runtime.core.getMetrics();
      const tile = tiles.getDebugStats();
      return {
        engine: "next",
        running,
        frameIndex: core.frameIndex,
        updateMs: core.lastUpdateMs,
        renderMs: core.lastRenderMs,
        moduleCount: core.moduleCount,
        fovDeg: nav.fovDeg,
        yawRad: nav.yawRad,
        pitchRad: nav.pitchRad,
        rollRad: nav.rollRad,
        selectedNodeId,
        hoveredNodeId,
        projection: projectionMode,
        adaptiveDprScale,
        effectivePixelRatio: lastEffectivePixelRatio,
        tile,
      };
    },
  };
}
