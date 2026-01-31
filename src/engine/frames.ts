/**
 * Coordinate frame system inspired by Stellarium's 9-frame architecture.
 *
 * Stellarium defines frames like ICRF, JNOW, CIRS, Observed, View, Ecliptic, etc.
 * For this biblical star map we use a simplified 3-frame system:
 *
 *   catalog  →  observer  →  view
 *
 * - catalog:  Fixed star positions (the arrangement). Equivalent to ICRF.
 * - observer: Rotated by the observer's lon/lat. Equivalent to alt-azimuth.
 * - view:     Camera-aligned (Z into screen). What the projection operates on.
 *
 * The catalog→observer transform is a rotation by (lon, lat).
 * The observer→view transform is identity for now but serves as an extension
 * point for future features (equatorial mount simulation, ecliptic tilt, etc.).
 */

import * as THREE from "three";

export type FrameId = "catalog" | "observer" | "view";

export interface ObserverState {
    /** Longitude in radians */
    lon: number;
    /** Latitude in radians */
    lat: number;
    /** Roll in radians (typically 0) */
    roll: number;
}

/**
 * Computes the quaternion that transforms from catalog frame to view frame.
 * This formalizes the existing camera orientation logic in createEngine.ts.
 */
export function catalogToViewQuaternion(obs: ObserverState): THREE.Quaternion {
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler(-obs.lat, -obs.lon, obs.roll, "YXZ");
    q.setFromEuler(euler);
    return q;
}

/**
 * Computes a 4x4 matrix transforming catalog-frame positions into view-frame.
 */
export function catalogToViewMatrix(obs: ObserverState): THREE.Matrix4 {
    const mat = new THREE.Matrix4();
    mat.makeRotationFromQuaternion(catalogToViewQuaternion(obs));
    return mat;
}

/**
 * Converts spherical coordinates (lon/lat in radians) to a unit direction
 * vector in the catalog frame.
 */
export function sphericalToCartesian(lon: number, lat: number): THREE.Vector3 {
    return new THREE.Vector3(
        Math.cos(lat) * Math.sin(lon),
        Math.sin(lat),
        Math.cos(lat) * Math.cos(lon),
    );
}

/**
 * Converts a catalog-frame unit vector to spherical (lon, lat) in radians.
 */
export function cartesianToSpherical(v: THREE.Vector3): { lon: number; lat: number } {
    return {
        lon: Math.atan2(v.x, v.z),
        lat: Math.asin(Math.max(-1, Math.min(1, v.y))),
    };
}
