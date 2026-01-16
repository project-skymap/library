import * as THREE from "three";
import { BLEND_CHUNK, MASK_CHUNK } from "./shaders";

export type SmartMaterialParams = {
    uniforms?: Record<string, THREE.IUniform>;
    vertexShaderBody: string;
    fragmentShader: string;
    transparent?: boolean;
    depthWrite?: boolean;
    depthTest?: boolean;
    side?: THREE.Side;
    blending?: THREE.Blending;
};

// Global uniforms shared across all smart materials
// We export this so the engine can update them each frame
export const globalUniforms = {
    uScale: { value: 1.0 },
    uAspect: { value: 1.0 },
    uBlend: { value: 0.0 }
};

export function createSmartMaterial(params: SmartMaterialParams): THREE.ShaderMaterial {
    const uniforms = { ...globalUniforms, ...params.uniforms };
    
    return new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: `
            ${BLEND_CHUNK} 
            varying vec2 vScreenPos; 
            ${params.vertexShaderBody}
        `,
        fragmentShader: `
            ${MASK_CHUNK} 
            ${params.fragmentShader}
        `,
        transparent: params.transparent || false,
        depthWrite: params.depthWrite !== undefined ? params.depthWrite : true,
        depthTest: params.depthTest !== undefined ? params.depthTest : true,
        side: params.side || THREE.FrontSide,
        blending: params.blending || THREE.NormalBlending
    });
}