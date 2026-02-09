/**
 * Shader chunks for the star map projection system.
 *
 * The projection is controlled by the uProjectionType uniform:
 *   0 = Perspective  (standard rectilinear)
 *   1 = Stereographic (conformal, hemisphere as disc)
 *   2 = Blended       (auto-blend driven by uBlend, original behavior)
 *
 * When uProjectionType is 0 or 1, uBlend is ignored.
 * When uProjectionType is 2, uBlend drives the smooth transition (backward compat).
 */

export const BLEND_CHUNK = `
#ifdef GL_ES
precision highp float;
#endif

uniform float uScale;
uniform float uAspect;
uniform float uBlend;
uniform int uProjectionType;

vec4 smartProject(vec4 viewPos) {
    vec3 dir = normalize(viewPos.xyz);
    float dist = length(viewPos.xyz);
    float k;

    // Radial Clipping: Push clipped points off-screen in their natural direction
    // to prevent lines "darting" across the center.
    vec2 escapeDir = (length(dir.xy) > 0.0001) ? normalize(dir.xy) : vec2(1.0, 1.0);
    vec2 escapePos = escapeDir * 10000.0;

    if (uProjectionType == 0) {
        // Perspective
        if (dir.z > -0.1) return vec4(escapePos, 10.0, 1.0);
        k = 1.0 / max(0.01, -dir.z);
    } else if (uProjectionType == 1) {
        // Stereographic — tighter clip to prevent stretch near singularity
        if (dir.z > 0.1) return vec4(escapePos, 10.0, 1.0);
        k = 2.0 / (1.0 - dir.z);
    } else {
        // Blended (auto-blend behavior)
        float zLinear = max(0.01, -dir.z);
        float kStereo = 2.0 / (1.0 - dir.z);
        float kLinear = 1.0 / zLinear;
        k = mix(kLinear, kStereo, uBlend);

        // Tighter clip threshold that scales with blend factor
        float clipZ = mix(-0.1, 0.1, uBlend);
        if (dir.z > clipZ) return vec4(escapePos, 10.0, 1.0);
    }

    vec2 projected = vec2(k * dir.x, k * dir.y);
    projected *= uScale;
    projected.x /= uAspect;
    float zMetric = -1.0 + (dist / 15000.0);

    return vec4(projected, zMetric, 1.0);
}
`;

export const MASK_CHUNK = `
#ifdef GL_ES
precision highp float;
#endif

uniform float uAspect;
uniform float uBlend;
uniform int uProjectionType;
varying vec2 vScreenPos;
float getMaskAlpha() {
    // No artificial circular mask — the horizon, atmosphere, and ground
    // define the dome boundary naturally (as Stellarium does).
    // Only apply a minimal edge softening to catch stray back-face artifacts.
    vec2 p = vScreenPos;
    p.x *= uAspect;
    float dist = length(p);
    // Gentle falloff only at extreme screen edges (beyond NDC ~1.8)
    return 1.0 - smoothstep(1.8, 2.0, dist);
}
`;
