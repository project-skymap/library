import type { NavigationConfig } from "../types/navigation";

export const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  minFovDeg: 1,
  maxFovDeg: 140,
  panSensitivity: 0.00125,
  zoomSpeed: 1,
};

export const DEFAULT_ENGINE_CONFIG = {
  strictModuleErrors: true,
};
