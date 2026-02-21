import * as THREE from "three";
import type { EngineModule, RenderContext } from "../types/contracts";
import type { CameraState } from "../types/navigation";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const SKY_DOME_RADIUS = 4200;

export class SkyDomeModule implements EngineModule {
  readonly id = "sky-dome";
  readonly updateOrder = 20;
  readonly renderOrder = 20;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly getCameraState: () => Readonly<CameraState>;
  private readonly getExposure: () => number;

  private mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private horizonRing: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private enabled = true;

  constructor(opts: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    getCameraState: () => Readonly<CameraState>;
    getExposure: () => number;
  }) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.getCameraState = opts.getCameraState;
    this.getExposure = opts.getExposure;
    this.createSky();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.mesh) this.mesh.visible = enabled;
    if (this.horizonRing) this.horizonRing.visible = enabled;
  }

  render(_ctx: RenderContext): void {
    if (!this.enabled || !this.material || !this.mesh) return;
    const nav = this.getCameraState();
    const exposure = clamp(this.getExposure(), 0.25, 2.0);
    const skyIntensity = clamp(0.72 + (exposure - 1) * 0.45, 0.42, 1.15);
    const horizonGlow = clamp(0.1 + (1 - Math.abs(nav.pitchRad) / (Math.PI / 2)) * 0.22, 0.08, 0.36);
    this.material.uniforms.uSkyIntensity.value = skyIntensity;
    this.material.uniforms.uHorizonGlow.value = horizonGlow;
    this.mesh.position.copy(this.camera.position);
    if (this.horizonRing) {
      this.horizonRing.position.copy(this.camera.position);
      this.horizonRing.material.opacity = clamp(0.16 + horizonGlow * 0.55, 0.08, 0.3);
    }
  }

  dispose(): void {
    if (!this.mesh || !this.material) return;
    this.scene.remove(this.mesh);
    if (this.horizonRing) {
      this.scene.remove(this.horizonRing);
      this.horizonRing.geometry.dispose();
      this.horizonRing.material.dispose();
      this.horizonRing = null;
    }
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
    this.material = null;
  }

  private createSky(): void {
    const uniforms = {
      uZenithColor: { value: new THREE.Color(0x030814) },
      uHorizonColor: { value: new THREE.Color(0x08182c) },
      uNadirColor: { value: new THREE.Color(0x010206) },
      uGroundColor: { value: new THREE.Color(0x050505) },
      uSkyIntensity: { value: 0.85 },
      uHorizonGlow: { value: 0.2 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      transparent: false,
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldDir;
        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uNadirColor;
        uniform vec3 uGroundColor;
        uniform float uSkyIntensity;
        uniform float uHorizonGlow;

        void main() {
          float y = clamp(vWorldDir.y, -1.0, 1.0);
          float t = (y + 1.0) * 0.5;
          vec3 base = mix(uNadirColor, uHorizonColor, smoothstep(0.05, 0.55, t));
          base = mix(base, uZenithColor, smoothstep(0.5, 1.0, t));
          float groundMix = smoothstep(0.0, -0.24, y);
          base = mix(base, uGroundColor, groundMix);
          float horizonLine = exp(-pow(abs(y) * 38.0, 2.0)) * 0.18;
          float glowBand = exp(-pow(abs(y) * 8.5, 2.0)) * uHorizonGlow;
          vec3 color = base * uSkyIntensity + vec3(0.03, 0.04, 0.06) * glowBand + vec3(0.05, 0.06, 0.08) * horizonLine;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 24, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -100;
    this.scene.add(mesh);
    this.mesh = mesh;
    this.material = material;

    const ringSegments = 192;
    const ringR = SKY_DOME_RADIUS * 0.997;
    const ringPositions = new Float32Array(ringSegments * 3);
    for (let i = 0; i < ringSegments; i++) {
      const a = (i / ringSegments) * Math.PI * 2;
      ringPositions[i * 3 + 0] = Math.cos(a) * ringR;
      ringPositions[i * 3 + 1] = 0;
      ringPositions[i * 3 + 2] = Math.sin(a) * ringR;
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPositions, 3));
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x7e96b8,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    ring.frustumCulled = false;
    ring.renderOrder = -90;
    this.scene.add(ring);
    this.horizonRing = ring;
  }
}
