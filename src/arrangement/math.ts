/**
 * Minimal pure-math Vec3 helpers for the arrangement layer.
 * No three.js dependency — plain TypeScript only.
 *
 * Vec3 is a mutable 3-element tuple [x, y, z].
 *
 * All exported functions return new Vec3 values and do not mutate their inputs.
 */

export type Vec3 = [number, number, number];

export function vec3(x: number, y: number, z: number): Vec3 {
    return [x, y, z];
}

export function clone(v: Vec3): Vec3 {
    return [v[0], v[1], v[2]];
}

export function length(v: Vec3): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function lengthSq(v: Vec3): number {
    return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

/** Internal: normalizes v in place. Not exported — use normalized() instead. */
function normalizeInPlace(v: Vec3): Vec3 {
    const len = length(v);
    if (len > 0) {
        v[0] /= len;
        v[1] /= len;
        v[2] /= len;
    }
    return v;
}

/** Returns a new normalized copy of v. Does not mutate v. */
export function normalized(v: Vec3): Vec3 {
    return normalizeInPlace(clone(v));
}

export function add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function multiplyScalar(v: Vec3, s: number): Vec3 {
    return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

export function degToRad(deg: number): number {
    return deg * (Math.PI / 180);
}
