/**
 * Projection system inspired by Stellarium's projection architecture.
 *
 * Stellarium supports 5 projection types (Perspective, Stereographic, Mercator,
 * Hammer, Mollweide). We implement Perspective, Stereographic, and a Blended
 * mode that reproduces the original auto-blend behavior.
 *
 * Each projection maps a view-space unit direction vector to/from 2D screen
 * coordinates, independent of Three.js's built-in camera projection.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Vec2 = { x: number; y: number };

export interface Projection {
    /** Unique key for config / serialization */
    readonly id: string;
    /** Human-readable name */
    readonly label: string;
    /** Maximum valid FOV in degrees for this projection */
    readonly maxFov: number;
    /**
     * Integer sent to the shader as uProjectionType.
     * 0 = perspective, 1 = stereographic, 2 = blended (auto)
     */
    readonly glslProjectionType: number;

    /**
     * Forward projection: view-space unit direction -> raw projected xy.
     * Returns null if the point should be clipped.
     * The returned {x,y} are pre-scale values (caller multiplies by uScale/uAspect).
     * Also returns the original dir.z for clipping decisions.
     */
    forward(dir: Vec3): { x: number; y: number; z: number } | null;

    /**
     * Inverse projection: NDC xy (after dividing out scale/aspect) -> view-space
     * unit direction vector. Used for mouse picking / unprojection.
     */
    inverse(uvX: number, uvY: number, fovRad: number): Vec3;

    /**
     * Compute the uniform scale factor for a given FOV (radians).
     */
    getScale(fovRad: number): number;

    /**
     * Whether a view-space direction with the given z component should be clipped.
     */
    isClipped(dirZ: number): boolean;
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

export class PerspectiveProjection implements Projection {
    readonly id = "perspective";
    readonly label = "Perspective";
    readonly maxFov = 160;
    readonly glslProjectionType = 0;

    forward(dir: Vec3) {
        if (dir.z > -0.1) return null;
        const k = 1.0 / Math.max(0.01, -dir.z);
        return { x: k * dir.x, y: k * dir.y, z: dir.z };
    }

    inverse(uvX: number, uvY: number, fovRad: number): Vec3 {
        const halfHeight = Math.tan(fovRad / 2);
        const r = Math.sqrt(uvX * uvX + uvY * uvY);
        const theta = Math.atan(r * halfHeight);
        const phi = Math.atan2(uvY, uvX);
        const sinT = Math.sin(theta);
        return {
            x: sinT * Math.cos(phi),
            y: sinT * Math.sin(phi),
            z: -Math.cos(theta),
        };
    }

    getScale(fovRad: number): number {
        return 1.0 / Math.tan(fovRad / 2.0);
    }

    isClipped(dirZ: number): boolean {
        return dirZ > -0.1;
    }
}

export class StereographicProjection implements Projection {
    readonly id = "stereographic";
    readonly label = "Stereographic";
    readonly maxFov = 360;
    readonly glslProjectionType = 1;

    forward(dir: Vec3) {
        if (dir.z > 0.4) return null;
        const k = 2.0 / (1.0 - dir.z);
        return { x: k * dir.x, y: k * dir.y, z: dir.z };
    }

    inverse(uvX: number, uvY: number, fovRad: number): Vec3 {
        const halfHeight = 2 * Math.tan(fovRad / 4);
        const r = Math.sqrt(uvX * uvX + uvY * uvY);
        const theta = 2 * Math.atan((r * halfHeight) / 2);
        const phi = Math.atan2(uvY, uvX);
        const sinT = Math.sin(theta);
        return {
            x: sinT * Math.cos(phi),
            y: sinT * Math.sin(phi),
            z: -Math.cos(theta),
        };
    }

    getScale(fovRad: number): number {
        return 1.0 / (2.0 * Math.tan(fovRad / 4.0));
    }

    isClipped(dirZ: number): boolean {
        return dirZ > 0.4;
    }
}

/**
 * Reproduces the original auto-blend behavior: smoothly interpolates between
 * perspective (low FOV) and stereographic (high FOV) based on the current FOV.
 *
 * This is the default projection and produces pixel-identical output to the
 * pre-refactor code.
 */
export class BlendedProjection implements Projection {
    readonly id = "blended";
    readonly label = "Blended (Auto)";
    readonly maxFov = 165;
    readonly glslProjectionType = 2;

    /** FOV thresholds for blend transition (degrees) */
    private blendStart = 40;
    private blendEnd = 100;

    /** Current blend factor, updated via setFov() */
    private blend = 0;

    /** Call this each frame / when FOV changes so forward/inverse stay in sync */
    setFov(fovDeg: number) {
        if (fovDeg <= this.blendStart) { this.blend = 0; return; }
        if (fovDeg >= this.blendEnd) { this.blend = 1; return; }
        const t = (fovDeg - this.blendStart) / (this.blendEnd - this.blendStart);
        this.blend = t * t * (3 - 2 * t); // smoothstep
    }

    getBlend(): number {
        return this.blend;
    }

    forward(dir: Vec3) {
        if (this.blend > 0.5 && dir.z > 0.4) return null;
        if (this.blend < 0.1 && dir.z > -0.1) return null;

        const kLinear = 1.0 / Math.max(0.01, -dir.z);
        const kStereo = 2.0 / (1.0 - dir.z);
        const k = kLinear * (1 - this.blend) + kStereo * this.blend;
        return { x: k * dir.x, y: k * dir.y, z: dir.z };
    }

    inverse(uvX: number, uvY: number, fovRad: number): Vec3 {
        const r = Math.sqrt(uvX * uvX + uvY * uvY);

        const halfHeightLin = Math.tan(fovRad / 2);
        const thetaLin = Math.atan(r * halfHeightLin);

        const halfHeightStereo = 2 * Math.tan(fovRad / 4);
        const thetaStereo = 2 * Math.atan((r * halfHeightStereo) / 2);

        const theta = thetaLin * (1 - this.blend) + thetaStereo * this.blend;
        const phi = Math.atan2(uvY, uvX);
        const sinT = Math.sin(theta);
        return {
            x: sinT * Math.cos(phi),
            y: sinT * Math.sin(phi),
            z: -Math.cos(theta),
        };
    }

    getScale(fovRad: number): number {
        const scaleLinear = 1.0 / Math.tan(fovRad / 2.0);
        const scaleStereo = 1.0 / (2.0 * Math.tan(fovRad / 4.0));
        return scaleLinear * (1 - this.blend) + scaleStereo * this.blend;
    }

    isClipped(dirZ: number): boolean {
        if (this.blend > 0.5) return dirZ > 0.4;
        if (this.blend < 0.1) return dirZ > -0.1;
        return false;
    }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type ProjectionId = "perspective" | "stereographic" | "blended";

export const PROJECTIONS: Record<ProjectionId, () => Projection> = {
    perspective: () => new PerspectiveProjection(),
    stereographic: () => new StereographicProjection(),
    blended: () => new BlendedProjection(),
};
