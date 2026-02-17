import * as THREE from "three";
import { ConstellationConfig, ConstellationItem } from "../types";
import { createSmartMaterial } from "./materials";

function buildSphereQuad(
    center: THREE.Vector3,
    rightDir: THREE.Vector3,
    upDir: THREE.Vector3,
    halfWidth: number,
    halfHeight: number,
    domeRadius: number,
    subdivisions: number = 8
): THREE.BufferGeometry {
    const vertsPerSide = subdivisions + 1;
    const vertCount = vertsPerSide * vertsPerSide;
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);

    const centerNorm = center.clone().normalize();
    const temp = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const q = new THREE.Quaternion();

    // Compute angular half-extents (Stellarium-style: uniform angular spacing)
    const halfAngleX = Math.atan2(halfWidth, domeRadius);
    const halfAngleY = Math.atan2(halfHeight, domeRadius);

    for (let iy = 0; iy < vertsPerSide; iy++) {
        for (let ix = 0; ix < vertsPerSide; ix++) {
            const idx = iy * vertsPerSide + ix;
            const u = ix / subdivisions;
            const v = iy / subdivisions;

            // Angular offsets from center (uniform in angle, not tangent-plane)
            const angX = (u - 0.5) * 2 * halfAngleX;
            const angY = (v - 0.5) * 2 * halfAngleY;

            // Exponential map: rotate centerNorm by the combined angular offset
            // tangent vector in the tangent plane at center
            tangent.copy(rightDir).multiplyScalar(angX)
                .addScaledVector(upDir, angY);
            const angle = tangent.length();

            if (angle > 0.00001) {
                tangent.normalize();
                q.setFromAxisAngle(tangent, angle);
                temp.copy(centerNorm).applyQuaternion(q).multiplyScalar(domeRadius);
            } else {
                temp.copy(center);
            }

            positions[idx * 3 + 0] = temp.x;
            positions[idx * 3 + 1] = temp.y;
            positions[idx * 3 + 2] = temp.z;

            // UV: Y flipped to match THREE.js PlaneGeometry convention (bottom-left origin)
            uvs[idx * 2 + 0] = u;
            uvs[idx * 2 + 1] = 1 - v;
        }
    }

    // Triangle indices: 2 triangles per grid cell
    const indexCount = subdivisions * subdivisions * 6;
    const indices = new Uint16Array(indexCount);
    let ii = 0;
    for (let iy = 0; iy < subdivisions; iy++) {
        for (let ix = 0; ix < subdivisions; ix++) {
            const a = iy * vertsPerSide + ix;
            const b = a + 1;
            const c = a + vertsPerSide;
            const d = c + 1;
            indices[ii++] = a;
            indices[ii++] = c;
            indices[ii++] = b;
            indices[ii++] = b;
            indices[ii++] = c;
            indices[ii++] = d;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
}

export class ConstellationArtworkLayer {
    private root: THREE.Group;
    private items: {
        config: ConstellationItem;
        mesh: THREE.Mesh;
        material: THREE.ShaderMaterial;
        baseOpacity: number;
        center: THREE.Vector3;
        rightDir: THREE.Vector3;
        upDir: THREE.Vector3;
        halfHeight: number;
        domeRadius: number;
    }[] = [];
    private textureLoader: THREE.TextureLoader;
    private hoveredId: string | null = null;
    private focusedId: string | null = null;

    constructor(root: THREE.Group) {
        this.textureLoader = new THREE.TextureLoader();
        this.textureLoader.crossOrigin = 'anonymous';
        this.root = new THREE.Group();
        this.root.renderOrder = -1; // Render early, but zBias handles depth
        root.add(this.root);
    }

    getItems() { return this.items; }

    load(config: ConstellationConfig, getPosition: (id: string) => THREE.Vector3 | null) {
        this.clear();
        console.log(`[Constellation] Loading ${config.constellations.length} constellations from ${config.atlasBasePath}`);
        // Remove trailing slash if present
        const basePath = config.atlasBasePath.replace(/\/$/, "");

        config.constellations.forEach(c => {
            // 1. Calculate Center
            let center = new THREE.Vector3();
            let valid = false;
            let radius = 2000; // Default dome radius

            // Priority 0: Arrangement Override (via getPosition)
            const arrPos = getPosition(c.id);
            if (arrPos) {
                center.copy(arrPos);
                valid = true;
                if (c.anchors.length > 0) {
                     const points: THREE.Vector3[] = [];
                     for (const anchorId of c.anchors) {
                        const p = getPosition(anchorId);
                        if (p) points.push(p);
                     }
                     if (points.length > 0) {
                         radius = points[0].length();
                     }
                }
            }
            else if (c.center) {
                center.set(c.center[0], c.center[1], 0);
                valid = true;
            } else if (c.anchors.length > 0) {
                const points: THREE.Vector3[] = [];
                for (const anchorId of c.anchors) {
                    const p = getPosition(anchorId);
                    if (p) points.push(p);
                }

                if (points.length > 0) {
                    for (const p of points) center.add(p);
                    center.divideScalar(points.length);

                    const len = center.length();
                    if (len > 0.001) {
                        radius = points[0].length();
                        center.normalize().multiplyScalar(radius);
                    }
                    valid = true;
                }
            }

            if (!valid) return;

            // 2. Orientation — derive tangent-plane frame at center
            const centerNorm = center.clone().normalize();

            let rightDir = new THREE.Vector3();
            let upDir = new THREE.Vector3();

            if (c.anchors.length >= 2) {
                const p0 = getPosition(c.anchors[0]);
                const p1 = getPosition(c.anchors[1]);
                if (p0 && p1 && p0.distanceTo(p1) > 0.001) {
                    const diff = new THREE.Vector3().subVectors(p1, p0);
                    rightDir.copy(diff).sub(centerNorm.clone().multiplyScalar(diff.dot(centerNorm))).normalize();
                    upDir.crossVectors(centerNorm, rightDir).normalize();
                    rightDir.crossVectors(upDir, centerNorm).normalize();
                } else {
                    this._defaultTangentFrame(centerNorm, rightDir, upDir);
                }
            } else {
                this._defaultTangentFrame(centerNorm, rightDir, upDir);
            }

            // Apply rotationDeg by rotating rightDir/upDir around centerNorm
            if (c.rotationDeg !== 0) {
                const q = new THREE.Quaternion().setFromAxisAngle(centerNorm, THREE.MathUtils.degToRad(c.rotationDeg));
                rightDir.applyQuaternion(q);
                upDir.applyQuaternion(q);
            }

            // 3. Geometry
            let size = c.radius;
            if (size <= 1.0) size *= radius;
            size *= 2; // Radius to Diameter

            const aspectRatio = c.aspectRatio ?? 1.0;
            const halfWidth = (size / 2) * aspectRatio;
            const halfHeight = size / 2;

            const geometry = buildSphereQuad(center, rightDir, upDir, halfWidth, halfHeight, radius, 8);

            // Texture
            const texPath = `${basePath}/${c.image}`;

            // Blending
            const blending = c.blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;

            // Create Material — Stellarium-aligned projection with smooth clip fade
            const material = createSmartMaterial({
                uniforms: {
                    uMap: { value: this.textureLoader.load(texPath) },
                    uOpacity: { value: c.opacity },
                },
                vertexShaderBody: `
                    varying vec2 vUv;
                    varying float vClipFade;
                    void main() {
                        vUv = uv;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                        // Compute clip-boundary fade BEFORE smartProject
                        // (Stellarium culls entire constellations near the boundary;
                        //  we fade per-vertex for smoother transitions)
                        vec3 viewDir = normalize(mvPosition.xyz);
                        float clipZ;
                        if (uProjectionType == 0) {
                            clipZ = -0.1;
                        } else if (uProjectionType == 1) {
                            clipZ = 0.1;
                        } else {
                            clipZ = mix(-0.1, 0.1, uBlend);
                        }
                        // Smooth fade over 0.3 radians before the clip threshold
                        vClipFade = smoothstep(clipZ, clipZ - 0.3, viewDir.z);

                        gl_Position = smartProject(mvPosition);
                        vScreenPos = gl_Position.xy / gl_Position.w;
                    }
                `,
                fragmentShader: `
                    #ifdef GL_ES
                    precision highp float;
                    #endif
                    uniform sampler2D uMap;
                    uniform float uOpacity;
                    varying vec2 vUv;
                    varying float vClipFade;
                    void main() {
                        float mask = getMaskAlpha();
                        if (mask < 0.01) discard;
                        vec4 tex = texture2D(uMap, vUv);

                        // Apply a slight blue tinge to the artwork
                        vec3 color = tex.rgb * vec3(0.8, 0.9, 1.0);

                        // vClipFade smoothly hides vertices near the projection
                        // clip boundary, preventing mesh distortion from escape positions
                        gl_FragColor = vec4(color, tex.a * uOpacity * mask * vClipFade);
                    }
                `,
                transparent: true,
                depthWrite: false,
                depthTest: true,
                blending: blending,
                side: THREE.DoubleSide
            });

            // Load Texture & Update Aspect Ratio
            material.uniforms.uMap.value = this.textureLoader.load(
                texPath,
                (tex) => {
                    tex.minFilter = THREE.LinearFilter;
                    tex.magFilter = THREE.LinearFilter;
                    tex.generateMipmaps = false;
                    tex.needsUpdate = true;

                    if (c.aspectRatio === undefined && tex.image.width && tex.image.height) {
                        const natAspect = tex.image.width / tex.image.height;
                        const newHalfWidth = (size / 2) * natAspect;
                        const newGeometry = buildSphereQuad(center, rightDir, upDir, newHalfWidth, halfHeight, radius, 8);
                        const item = this.items.find(i => i.config.id === c.id);
                        if (item) {
                            item.mesh.geometry.dispose();
                            item.mesh.geometry = newGeometry;
                        }
                    }
                    console.log(`[Constellation] Loaded: ${c.id} (${tex.image.width}x${tex.image.height})`);
                },
                (progress) => {
                    // Progress callback
                },
                (err) => {
                    console.error(`[Constellation] Failed to load: ${texPath}`, err);
                }
            );

            if (c.zBias) {
                material.polygonOffset = true;
                material.polygonOffsetFactor = -c.zBias;
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.frustumCulled = false;
            mesh.userData = { id: c.id, type: 'constellation' };

            this.root.add(mesh);
            this.items.push({
                config: c,
                mesh,
                material,
                baseOpacity: c.opacity,
                center: center.clone(),
                rightDir: rightDir.clone(),
                upDir: upDir.clone(),
                halfHeight,
                domeRadius: radius,
            });
        });
    }

    private _defaultTangentFrame(centerNorm: THREE.Vector3, rightDir: THREE.Vector3, upDir: THREE.Vector3) {
        const worldUp = new THREE.Vector3(0, 1, 0);
        if (Math.abs(centerNorm.dot(worldUp)) > 0.99) {
            rightDir.crossVectors(new THREE.Vector3(1, 0, 0), centerNorm).normalize();
        } else {
            rightDir.crossVectors(worldUp, centerNorm).normalize();
        }
        upDir.crossVectors(centerNorm, rightDir).normalize();
        rightDir.crossVectors(upDir, centerNorm).normalize();
    }

    private _globalOpacity = 1.0;

    setGlobalOpacity(v: number) { this._globalOpacity = v; }

    /**
     * Update visibility and opacity.
     * Accepts an optional camera for Stellarium-style visibility culling:
     * constellations whose center is near or past the projection clip
     * boundary are hidden to prevent mesh distortion from escape positions.
     */
    update(fov: number, showArt: boolean, camera?: THREE.Camera) {
        this.root.visible = showArt;
        if (!showArt) {
            return;
        }

        // Camera forward direction in world space (for visibility culling)
        let cameraForward: THREE.Vector3 | null = null;
        if (camera) {
            cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        }

        for (const item of this.items) {
            const { fade } = item.config;

            let opacity = fade.maxOpacity;

            if (fov >= fade.zoomInStart) {
                opacity = fade.maxOpacity;
            } else if (fov <= fade.zoomInEnd) {
                opacity = fade.minOpacity;
            } else {
                const t = (fade.zoomInStart - fov) / (fade.zoomInStart - fade.zoomInEnd);
                opacity = THREE.MathUtils.lerp(fade.maxOpacity, fade.minOpacity, t);
            }

            opacity = Math.min(Math.max(opacity, 0), 1) * this._globalOpacity;

            // Stellarium-style visibility culling: hide constellations whose
            // center direction is > ~80° from camera forward (approaching the
            // clip boundary). Smooth fade from 70° to 85°.
            if (cameraForward) {
                const centerDir = item.center.clone().normalize();
                const dot = cameraForward.dot(centerDir);
                // dot=1 → directly ahead, dot=0 → 90° away, dot<0 → behind
                // cos(70°)≈0.342, cos(85°)≈0.087
                const visFade = THREE.MathUtils.smoothstep(dot, 0.087, 0.342);
                opacity *= visFade;
            }

            item.material.uniforms.uOpacity.value = opacity;
            item.mesh.visible = opacity > 0.001;
        }
    }

    setHovered(id: string | null) { this.hoveredId = id; }
    setFocused(id: string | null) { this.focusedId = id; }

    dispose() {
        this.clear();
        this.root.removeFromParent();
    }

    clear() {
        this.items.forEach(i => {
            this.root.remove(i.mesh);
            i.material.dispose();
            i.mesh.geometry.dispose();
        });
        this.items = [];
    }
}
