import type { CameraState } from "../types/navigation";

export interface ParitySnapshot {
  sceneId: string;
  timestampUtc: string;
  camera: CameraState;
  frameIndex: number;
}

export interface InputReplayStep {
  atMs: number;
  event: string;
  payload: Record<string, unknown>;
}
