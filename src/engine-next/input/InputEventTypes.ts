export type InputPointerType = "mouse" | "touch" | "pen";

export type EngineInputEvent =
  | { type: "pan"; deltaX: number; deltaY: number; pointer: InputPointerType }
  | { type: "zoom"; factor: number; anchorX: number; anchorY: number; pointer: InputPointerType }
  | { type: "tap"; x: number; y: number; pointer: InputPointerType };
