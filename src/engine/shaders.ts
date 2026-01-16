export const BLEND_CHUNK = `
uniform float uScale;
uniform float uAspect;
uniform float uBlend;

vec4 smartProject(vec4 viewPos) {
    vec3 dir = normalize(viewPos.xyz);
    float dist = length(viewPos.xyz);
    float zLinear = max(0.01, -dir.z);
    float kStereo = 2.0 / (1.0 - dir.z);
    float kLinear = 1.0 / zLinear;
    float k = mix(kLinear, kStereo, uBlend);
    vec2 projected = vec2(k * dir.x, k * dir.y);
    projected *= uScale;
    projected.x /= uAspect;
    float zMetric = -1.0 + (dist / 2000.0);
    // Clip backward facing points in fisheye mode
    if (uBlend > 0.5 && dir.z > 0.4) return vec4(10.0, 10.0, 10.0, 1.0);
    // Clip very close points in linear mode
    if (uBlend < 0.1 && dir.z > -0.1) return vec4(10.0, 10.0, 10.0, 1.0);
    return vec4(projected, zMetric, 1.0);
}
`;

export const MASK_CHUNK = `
uniform float uAspect;
uniform float uBlend;
varying vec2 vScreenPos;
float getMaskAlpha() {
    if (uBlend < 0.1) return 1.0;
    vec2 p = vScreenPos;
    p.x *= uAspect;
    float dist = length(p);
    float t = smoothstep(0.75, 1.0, uBlend);
    float currentRadius = mix(2.5, 1.0, t);
    float edgeSoftness = mix(0.5, 0.02, t);
    return 1.0 - smoothstep(currentRadius - edgeSoftness, currentRadius, dist);
}
`;
