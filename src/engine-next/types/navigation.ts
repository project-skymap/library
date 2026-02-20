export interface CameraState {
  yawRad: number;
  pitchRad: number;
  rollRad: number;
  fovDeg: number;
}

export interface NavigationConfig {
  minFovDeg: number;
  maxFovDeg: number;
  panSensitivity: number;
  zoomSpeed: number;
}

export interface PanInput {
  deltaX: number;
  deltaY: number;
}

export interface ZoomInput {
  zoomFactor: number;
}
