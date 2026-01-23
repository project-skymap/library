import * as THREE from "three";
import { ConstellationConfig, ConstellationItem } from "../types";
import { createSmartMaterial } from "./materials";

export class ConstellationArtworkLayer {
    private root: THREE.Group;
    private items: {
        config: ConstellationItem;
        mesh: THREE.Mesh;
        material: THREE.ShaderMaterial;
        baseOpacity: number;
    }[] = [];
    private textureLoader = new THREE.TextureLoader();
    private hoveredId: string | null = null;
    private focusedId: string | null = null;

    constructor(root: THREE.Group) {
        this.root = new THREE.Group();
        this.root.renderOrder = -1; // Render early, but zBias handles depth
        root.add(this.root);
    }

    getItems() { return this.items; }

    setPosition(id: string, pos: THREE.Vector3) {
        const item = this.items.find(i => i.config.id === id);
        if (item) {
            item.mesh.position.copy(pos);
        }
    }

    load(config: ConstellationConfig, getPosition: (id: string) => THREE.Vector3 | null) {
        this.clear();
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
                // If we have an explicit position, we still need a radius for sizing.
                // If anchors exist, use them for radius? Or default?
                if (c.anchors.length > 0) {
                     // Try to guess radius from anchors even if position is overridden
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
                center.set(c.center[0], c.center[1], c.center[2]);
                valid = true;
            } else if (c.anchors.length > 0) {
                const points: THREE.Vector3[] = [];
                for (const anchorId of c.anchors) {
                    const p = getPosition(anchorId);
                    if (p) points.push(p);
                }
                
                if (points.length > 0) {
                    // Centroid
                    for (const p of points) center.add(p);
                    center.divideScalar(points.length);
                    
                    // Normalize to dome radius
                    const len = center.length();
                    if (len > 0.001) {
                        // Infer radius from anchor points if possible, or use constant
                        // We use the length of the first anchor as "dome radius"
                        radius = points[0].length();
                        center.normalize().multiplyScalar(radius);
                    }
                    valid = true;
                }
            }

            if (!valid) return;

            // 2. Orientation
            // Normal (Z for the plane) should face 0,0,0 (Camera)
            // So Normal = -center.normalized()
            const normal = center.clone().normalize().negate();
            const upVec = center.clone().normalize(); // This is "Up" in world space (away from center)

            // Calculate "Right" and "Top" for the image plane
            let right = new THREE.Vector3(1, 0, 0); 
            
            if (c.anchors.length >= 2) {
                 const p0 = getPosition(c.anchors[0]);
                 const p1 = getPosition(c.anchors[1]);
                 if (p0 && p1) {
                     const diff = new THREE.Vector3().subVectors(p1, p0);
                     // Project diff onto the plane tangent to 'upVec'
                     // right = diff - (diff . upVec) * upVec
                     right.copy(diff).sub(upVec.clone().multiplyScalar(diff.dot(upVec))).normalize();
                 }
            } else {
                // Default right
                if (Math.abs(upVec.y) > 0.9) right.set(1, 0, 0).cross(upVec).normalize();
                else right.set(0, 1, 0).cross(upVec).normalize();
            }

            // "Top" (Y axis of plane)
            const top = new THREE.Vector3().crossVectors(upVec, right).normalize();
            
            // Re-orthogonalize Right
            right.crossVectors(top, upVec).normalize();

            // Construct Rotation Matrix for the Mesh
            // Plane Geometry: X=Right, Y=Top, Z=Normal
            // Our target basis:
            // X axis -> right
            // Y axis -> top
            // Z axis -> normal (which is -upVec, pointing IN to center)
            const basis = new THREE.Matrix4().makeBasis(right, top, normal); 
            
            // 3. Geometry & Mesh
            // We use a Screen-Space Billboard technique to ensure the image remains
            // a flat, undistorted 2D "card" regardless of camera projection or position.
            
            // Base Geometry: Unit Quad (1x1)
            const geometry = new THREE.PlaneGeometry(1, 1); 
            
            // Size: JSON radius -> Diameter (approx)
            let size = c.radius;
            if (size <= 1.0) size *= radius; 
            size *= 2; // Radius to Diameter

            // Texture
            const texPath = `${basePath}/${c.image}`;
            
            // Blending
            let blending = THREE.NormalBlending;
            if (c.blend === "additive") blending = THREE.AdditiveBlending;
            
            // Create Material with Billboard Shader
            const material = createSmartMaterial({
                uniforms: {
                    uMap: { value: this.textureLoader.load(texPath) }, // Placeholder, updated below
                    uOpacity: { value: c.opacity },
                    uSize: { value: size },
                    uImgRotation: { value: THREE.MathUtils.degToRad(c.rotationDeg) },
                    uImgAspect: { value: c.aspectRatio ?? 1.0 },
                    // uScale, uAspect (screen) are injected by createSmartMaterial/globalUniforms
                },
                vertexShaderBody: `
                    uniform float uSize;
                    uniform float uImgRotation;
                    uniform float uImgAspect;
                    
                    varying vec2 vUv;
                    
                    void main() {
                        vUv = uv;
                        
                        // 1. Project Center Point (Proven Method)
                        vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                        vec4 clipCenter = smartProject(mvCenter);
                        
                        // 2. Project "Up" Point (World Zenith)
                        // Transform World Up (0,1,0) to View Space
                        vec3 viewUpDir = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
                        // Offset center by a significant amount (1000.0) to ensure screen delta
                        vec4 mvUp = mvCenter + vec4(viewUpDir * 1000.0, 0.0);
                        vec4 clipUp = smartProject(mvUp);
                        
                        // 3. Calculate Horizon Angle
                        vec2 screenCenter = clipCenter.xy / clipCenter.w;
                        vec2 screenUp = clipUp.xy / clipUp.w;
                        vec2 screenDelta = screenUp - screenCenter;
                        
                        float horizonAngle = 0.0;
                        if (length(screenDelta) > 0.001) {
                             vec2 screenDir = normalize(screenDelta);
                             horizonAngle = atan(screenDir.y, screenDir.x) - 1.5708; // -90 deg
                        }
                        
                        // 4. Combine with User Rotation
                        float finalAngle = uImgRotation + horizonAngle;
                        
                        // 5. Billboard Offset
                        vec2 offset = position.xy;
                        
                        float cr = cos(finalAngle);
                        float sr = sin(finalAngle);
                        vec2 rotated = vec2(
                            offset.x * cr - offset.y * sr,
                            offset.x * sr + offset.y * cr
                        );
                        
                        rotated.x *= uImgAspect;
                        
                        float dist = length(mvCenter.xyz);
                        float scale = (uSize / dist) * uScale;
                        
                        rotated *= scale;
                        rotated.x /= uAspect;
                        
                        gl_Position = clipCenter;
                        gl_Position.xy += rotated * clipCenter.w;
                        
                        vScreenPos = gl_Position.xy / gl_Position.w;
                    }
                `,
                fragmentShader: `
                    uniform sampler2D uMap;
                    uniform float uOpacity;
                    varying vec2 vUv;
                    void main() {
                        float mask = getMaskAlpha();
                        if (mask < 0.01) discard;
                        vec4 tex = texture2D(uMap, vUv);
                        gl_FragColor = vec4(tex.rgb, tex.a * uOpacity * mask);
                    }
                `,
                transparent: true,
                depthWrite: false,
                depthTest: true,
                blending: blending,
                side: THREE.DoubleSide
            });

            // Load Texture & Update Aspect Ratio
            material.uniforms.uMap.value = this.textureLoader.load(texPath, (tex) => {
                 if (c.aspectRatio === undefined && tex.image.width && tex.image.height) {
                     const natAspect = tex.image.width / tex.image.height;
                     material.uniforms.uImgAspect.value = natAspect;
                 }
            });
            
            if (c.zBias) {
                material.polygonOffset = true;
                material.polygonOffsetFactor = -c.zBias; 
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.frustumCulled = false; // Important: Custom vertex shader displaces geometry, so we must disable frustum culling.
            mesh.userData = { id: c.id, type: 'constellation' };
            
            mesh.position.copy(center);
            // We DO NOT rotate the mesh geometry base. 
            // The orientation is handled in the shader via uImgRotation (Z-roll).
            // But we might want the mesh's coordinate system to face the center?
            // No, the billboard shader ignores mesh orientation (it uses mvCenter).
            // So mesh rotation is irrelevant, except maybe for 'up' if we used it.
            // But we just project (0,0,0). So Mesh Rotation is ignored.
            
            this.root.add(mesh);
            this.items.push({ config: c, mesh, material, baseOpacity: c.opacity });
        });
    }

    update(fov: number, showArt: boolean) {
        this.root.visible = showArt;
        if (!showArt) return;

        for (const item of this.items) {
            const { fade } = item.config;
            
            let opacity = fade.maxOpacity;

            // Logic: "Fade Out when Zooming In"
            // High FOV (Zoom Out) -> Max Opacity
            // Low FOV (Zoom In) -> Min Opacity
            
            if (fov >= fade.zoomInStart) {
                // Fully Zoomed Out
                opacity = fade.maxOpacity;
            } else if (fov <= fade.zoomInEnd) {
                // Fully Zoomed In
                opacity = fade.minOpacity;
            } else {
                // Transition
                // t = 0 at Start (60), 1 at End (20)
                const t = (fade.zoomInStart - fov) / (fade.zoomInStart - fade.zoomInEnd);
                opacity = THREE.MathUtils.lerp(fade.maxOpacity, fade.minOpacity, t);
            }
            
            // Clamp
            opacity = Math.min(Math.max(opacity, 0), 1);

            item.material.uniforms.uOpacity.value = opacity;
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
