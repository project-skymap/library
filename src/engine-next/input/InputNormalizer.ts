import type { EngineInputEvent, InputPointerType } from "./InputEventTypes";

export interface NormalizeContext {
  viewportWidth: number;
  viewportHeight: number;
}

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  pointer: InputPointerType;
}

export class InputNormalizer {
  private readonly pointers = new Map<number, PointerSample>();
  private primaryPointerId: number | null = null;
  private primaryDown: PointerSample | null = null;
  private lastPrimary: PointerSample | null = null;
  private pinchDistance: number | null = null;
  private draggedSincePrimaryDown = false;
  private readonly tapMoveThresholdPx = 6;

  onPointerDown(sample: PointerSample): EngineInputEvent[] {
    this.pointers.set(sample.id, sample);
    if (this.pointers.size === 1) {
      this.primaryPointerId = sample.id;
      this.primaryDown = sample;
      this.lastPrimary = sample;
      this.draggedSincePrimaryDown = false;
      this.pinchDistance = null;
      return [];
    }
    if (this.pointers.size >= 2) {
      this.primaryPointerId = null;
      this.lastPrimary = null;
      this.pinchDistance = this.getPinchDistance();
      this.draggedSincePrimaryDown = true;
    }
    return [];
  }

  onPointerMove(sample: PointerSample): EngineInputEvent[] {
    this.pointers.set(sample.id, sample);
    if (this.pointers.size <= 0) {
      return [];
    }
    if (this.pointers.size === 1 && this.primaryPointerId === sample.id) {
      if (!this.lastPrimary) {
        this.lastPrimary = sample;
        return [];
      }
      const dx = sample.x - this.lastPrimary.x;
      const dy = sample.y - this.lastPrimary.y;
      this.lastPrimary = sample;
      if (this.primaryDown) {
        const moved =
          Math.hypot(sample.x - this.primaryDown.x, sample.y - this.primaryDown.y) >= this.tapMoveThresholdPx;
        if (moved) this.draggedSincePrimaryDown = true;
      }
      if (dx === 0 && dy === 0) return [];
      return [{
        type: "pan",
        deltaX: dx,
        deltaY: dy,
        pointer: sample.pointer,
      }];
    }

    if (this.pointers.size >= 2) {
      const d = this.getPinchDistance();
      const c = this.getPinchCenter();
      if (d === null || c === null) return [];
      if (this.pinchDistance === null || this.pinchDistance <= 0) {
        this.pinchDistance = d;
        return [];
      }
      let factor = d / this.pinchDistance;
      this.pinchDistance = d;
      if (!Number.isFinite(factor) || factor <= 0) return [];
      factor = Math.min(1.28, Math.max(0.78, factor));
      return [{
        type: "zoom",
        factor,
        anchorX: c.x,
        anchorY: c.y,
        pointer: sample.pointer,
      }];
    }

    return [];
  }

  onPointerUp(sample: PointerSample): EngineInputEvent[] {
    const released = this.pointers.get(sample.id) ?? sample;
    const wasPrimary = this.primaryPointerId === sample.id;
    this.pointers.delete(sample.id);

    if (this.pointers.size === 0) {
      const shouldTap = wasPrimary && !this.draggedSincePrimaryDown;
      this.primaryPointerId = null;
      this.primaryDown = null;
      this.lastPrimary = null;
      this.pinchDistance = null;
      this.draggedSincePrimaryDown = false;
      if (!shouldTap) return [];
      return [{
        type: "tap",
        x: released.x,
        y: released.y,
        pointer: released.pointer,
      }];
    }

    if (this.pointers.size === 1) {
      const remaining = this.pointers.values().next().value as PointerSample;
      this.primaryPointerId = remaining.id;
      this.primaryDown = remaining;
      this.lastPrimary = remaining;
      this.pinchDistance = null;
      this.draggedSincePrimaryDown = true;
      return [];
    }

    this.primaryPointerId = null;
    this.lastPrimary = null;
    this.pinchDistance = this.getPinchDistance();
    this.draggedSincePrimaryDown = true;
    return [];
  }

  onWheel(deltaY: number, x: number, y: number): EngineInputEvent[] {
    const steps = deltaY / 120;
    const mag = Math.min(4, Math.abs(steps));
    const accel = 1 + mag * 0.14;
    const factor = Math.min(1.24, Math.max(0.8, Math.pow(1.035, -steps * accel)));
    return [
      {
        type: "zoom",
        factor,
        anchorX: x,
        anchorY: y,
        pointer: "mouse",
      },
    ];
  }

  private getPinchDistance(): number | null {
    const points = [...this.pointers.values()];
    if (points.length < 2) return null;
    const a = points[0];
    const b = points[1];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private getPinchCenter(): { x: number; y: number } | null {
    const points = [...this.pointers.values()];
    if (points.length < 2) return null;
    const a = points[0];
    const b = points[1];
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  }
}
