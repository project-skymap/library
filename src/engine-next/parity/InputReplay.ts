import type { EngineInputEvent } from "../input/InputEventTypes";

export interface InputReplayFrame {
  atMs: number;
  event: EngineInputEvent;
}

export interface InputReplayScript {
  version: 1;
  name: string;
  frames: InputReplayFrame[];
}

export class InputReplayPlayer {
  private index = 0;

  reset(): void {
    this.index = 0;
  }

  drainUntil(script: InputReplayScript, elapsedMs: number): EngineInputEvent[] {
    const out: EngineInputEvent[] = [];
    while (this.index < script.frames.length && script.frames[this.index].atMs <= elapsedMs) {
      out.push(script.frames[this.index].event);
      this.index += 1;
    }
    return out;
  }

  isFinished(script: InputReplayScript): boolean {
    return this.index >= script.frames.length;
  }
}
