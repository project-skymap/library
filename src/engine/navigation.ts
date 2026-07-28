import * as THREE from "three";
import type { ProjectionId } from "./projections";

export type PlanetariumViewMode = "zenith" | "immersive" | "hybrid";
export type PlanetariumProjectionId = ProjectionId | "blended";

export type PlanetariumNavigationConfig = {
    inputCompression: number;
    movementMassWideFov: number;
    wideDiscControlStartFov: number;
    wideDiscControlEndFov: number;
    wideDiscHorizontalPanFactor: number;
    wideDiscVerticalPanFactor: number;
};

export type PlanetariumViewModeProfile = {
    id: PlanetariumViewMode;
    projection: PlanetariumProjectionId;
    maxFov: number;
    defaultFov: number;
    fitProjection: boolean;
    fitReferenceMaxFov?: number;
};

export const VIEW_MODE_PROFILES: Record<PlanetariumViewMode, PlanetariumViewModeProfile> = {
    zenith: {
        id: "zenith",
        projection: "stereographic",
        // Previous maxFov was 180. Cap user zoom at 110, but keep 180 as the
        // projection-fit reference so 110 retains the earlier zoomed-in framing.
        maxFov: 110,
        defaultFov: 110,
        fitProjection: true,
        fitReferenceMaxFov: 180,
    },
    immersive: {
        id: "immersive",
        projection: "perspective",
        maxFov: 90,
        defaultFov: 90,
        fitProjection: false,
    },
    hybrid: {
        id: "hybrid",
        projection: "blended",
        maxFov: 180,
        defaultFov: 135,
        fitProjection: true,
    },
};

export function getViewModeProfile(mode: PlanetariumViewMode): PlanetariumViewModeProfile {
    return VIEW_MODE_PROFILES[mode] ?? VIEW_MODE_PROFILES.zenith;
}

export function getWideDiscControlT(
    fov: number,
    projectionId: PlanetariumProjectionId,
    config: PlanetariumNavigationConfig
) {
    if (projectionId === "perspective") return 0.0;
    return THREE.MathUtils.smoothstep(
        fov,
        config.wideDiscControlStartFov,
        config.wideDiscControlEndFov
    );
}

export function getHorizontalPanFactor(
    fov: number,
    projectionId: PlanetariumProjectionId,
    config: PlanetariumNavigationConfig
) {
    return THREE.MathUtils.lerp(1.0, config.wideDiscHorizontalPanFactor, getWideDiscControlT(fov, projectionId, config));
}

export function getVerticalPanFactor(
    fov: number,
    lat: number,
    projectionId: PlanetariumProjectionId,
    config: PlanetariumNavigationConfig
) {
    const wideT = getWideDiscControlT(fov, projectionId, config);
    const base = THREE.MathUtils.lerp(1.0, config.wideDiscVerticalPanFactor, wideT);
    const downLookT = THREE.MathUtils.smoothstep(-THREE.MathUtils.radToDeg(lat), 0, 38);
    return base * THREE.MathUtils.lerp(1.0, 0.35, wideT * downLookT);
}

export function getMovementMassFactor(
    fov: number,
    projectionId: PlanetariumProjectionId,
    config: PlanetariumNavigationConfig,
    wideFovFactor: number = config.movementMassWideFov
) {
    const t = THREE.MathUtils.smoothstep(fov, 24, 96);
    const wideDiscT = getWideDiscControlT(fov, projectionId, config);
    const targetWideFactor = THREE.MathUtils.lerp(wideFovFactor, wideFovFactor * 0.75, wideDiscT);
    return THREE.MathUtils.lerp(1.0, targetWideFactor, t);
}

export function compressInputDelta(delta: number, config: PlanetariumNavigationConfig) {
    const absDelta = Math.abs(delta);
    if (absDelta < 0.0001) return 0;
    return Math.sign(delta) * (absDelta / (1.0 + absDelta * config.inputCompression));
}

export function getGroundAlphaForView(
    fov: number,
    lat: number,
    projectionId: PlanetariumProjectionId,
    config: PlanetariumNavigationConfig
) {
    const fovAlpha = THREE.MathUtils.smoothstep(fov, 1, 20);
    const belowHorizonRelief = THREE.MathUtils.lerp(
        1.0,
        0.5,
        THREE.MathUtils.smoothstep(-THREE.MathUtils.radToDeg(lat), 0, 45)
    );
    const wideDownRelief = THREE.MathUtils.lerp(
        1.0,
        0.12,
        getWideDiscControlT(fov, projectionId, config) * THREE.MathUtils.smoothstep(35 - THREE.MathUtils.radToDeg(lat), 0, 80)
    );
    return fovAlpha * belowHorizonRelief * wideDownRelief;
}
