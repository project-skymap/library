import * as THREE from "three";
import type { StarMapConfig, SceneModel, SceneNode, StarArrangement } from "../types";
import { computeLayoutPositions } from "./layout";
import { createSmartMaterial, globalUniforms } from "./materials";
import { ConstellationArtworkLayer } from "./ConstellationArtworkLayer";

type Handlers = {
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
    onArrangementChange?: (arrangement: StarArrangement) => void;
};

const ENGINE_CONFIG = {
    minFov: 10,
    maxFov: 165,
    defaultFov: 80,
    dragSpeed: 0.00125,
    inertiaDamping: 0.92,
    blendStart: 60,
    blendEnd: 165,
    zenithStartFov: 110,
    zenithStrength: 0.02,
    horizonLockStrength: 0.05,
    edgePanThreshold: 0.15,
    edgePanMaxSpeed: 0.02
};

export function createEngine({
                                 container,
                                 onSelect,
                                 onHover,
                                 onArrangementChange,
                             }: {
    container: HTMLDivElement;
    onSelect?: Handlers["onSelect"];
    onHover?: Handlers["onHover"];
    onArrangementChange?: Handlers["onArrangementChange"];
}) {
    // ---------------------------
    // Renderer / Scene / Camera
    // ---------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);

    // ---------------------------
    // Engine State
    // ---------------------------
    let running = false;
    let raf = 0;
    
    const state = {
        isDragging: false,
        lastMouseX: 0,
        lastMouseY: 0,
        velocityX: 0,
        velocityY: 0,
        lat: 0.5,
        lon: 0,
        targetLat: 0.5,
        targetLon: 0,
        fov: ENGINE_CONFIG.defaultFov,
        
        dragMode: 'none' as 'none' | 'camera' | 'node',
        draggedNodeId: null as string | null,
        draggedStarIndex: -1,
        draggedDist: 2000,
        
        draggedGroup: null as null | {
            labelInitialPos: THREE.Vector3,
            children: { index: number, initialPos: THREE.Vector3 }[]
        },
        tempArrangement: {} as StarArrangement
    };

    const mouseNDC = new THREE.Vector2();
    let isMouseInWindow = false;

    let handlers: Handlers = { onSelect, onHover, onArrangementChange };
    let currentConfig: StarMapConfig | undefined;
    
    // ---------------------------
    // Constellation Artwork Layer
    // ---------------------------
    const constellationLayer = new ConstellationArtworkLayer(scene);

    // ---------------------------
    // Helpers
    // ---------------------------
    function mix(a: number, b: number, t: number) { return a * (1 - t) + b * t; }
    
    function getBlendFactor(fov: number) {
        if (fov <= ENGINE_CONFIG.blendStart) return 0.0;
        if (fov >= ENGINE_CONFIG.blendEnd) return 1.0;
        let t = (fov - ENGINE_CONFIG.blendStart) / (ENGINE_CONFIG.blendEnd - ENGINE_CONFIG.blendStart);
        return t * t * (3.0 - 2.0 * t);
    }

    function updateUniforms() {
        const blend = getBlendFactor(state.fov);
        globalUniforms.uBlend.value = blend;
        
        const fovRad = state.fov * Math.PI / 180.0;
        const scaleLinear = 1.0 / Math.tan(fovRad / 2.0);
        const scaleStereo = 1.0 / (2.0 * Math.tan(fovRad / 4.0));
        
        globalUniforms.uScale.value = mix(scaleLinear, scaleStereo, blend);
        globalUniforms.uAspect.value = camera.aspect;
        
        camera.fov = Math.min(state.fov, ENGINE_CONFIG.defaultFov); 
        camera.updateProjectionMatrix();
    }

    function getMouseViewVector(fovDeg: number, aspectRatio: number) {
        const blend = getBlendFactor(fovDeg);
        const fovRad = fovDeg * Math.PI / 180;
        const uvX = mouseNDC.x * aspectRatio;
        const uvY = mouseNDC.y;
        const r_uv = Math.sqrt(uvX * uvX + uvY * uvY);
        
        const halfHeightLinear = Math.tan(fovRad / 2);
        const theta_lin = Math.atan(r_uv * halfHeightLinear);
        
        const halfHeightStereo = 2 * Math.tan(fovRad / 4);
        const theta_str = 2 * Math.atan((r_uv * halfHeightStereo) / 2);
        
        const theta = mix(theta_lin, theta_str, blend);
        const phi = Math.atan2(uvY, uvX);
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        
        return new THREE.Vector3(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), -cosTheta).normalize();
    }

    // Helper: Screen Pixel -> World Direction
    function getMouseWorldVector(pixelX: number, pixelY: number, width: number, height: number) {
        // Reuse view vector logic logic (but need to recalculate NDC since getMouseViewVector uses global state)
        // Actually, let's just manually calc ndc here to be safe and use getMouseViewVector logic if possible
        // But getMouseViewVector uses global `mouseNDC`.
        // Let's copy the logic or refactor.
        // Refactor: make getMouseViewVector take NDC input.
        
        // For now, simpler to just inline logic or use getMouseViewVector if we set mouseNDC first.
        // But getMouseWorldVector is called with specific pixel coords.
        const aspect = width / height;
        const ndcX = (pixelX / width) * 2 - 1;
        const ndcY = -(pixelY / height) * 2 + 1;
        
        // Temporary View Vector calculation
        const blend = getBlendFactor(state.fov);
        const fovRad = state.fov * Math.PI / 180;
        const uvX = ndcX * aspect;
        const uvY = ndcY;
        const r_uv = Math.sqrt(uvX * uvX + uvY * uvY);
        const halfHeightLinear = Math.tan(fovRad / 2);
        const theta_lin = Math.atan(r_uv * halfHeightLinear);
        const halfHeightStereo = 2 * Math.tan(fovRad / 4);
        const theta_str = 2 * Math.atan((r_uv * halfHeightStereo) / 2);
        const theta = mix(theta_lin, theta_str, blend);
        const phi = Math.atan2(uvY, uvX);
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        
        const vView = new THREE.Vector3(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), -cosTheta).normalize();
        return vView.applyQuaternion(camera.quaternion);
    }

    // Helper: World Position -> Projected Screen Coords (for Labels)
    function smartProjectJS(worldPos: THREE.Vector3) {
        // 1. Transform World -> View
        const viewPos = worldPos.clone().applyMatrix4(camera.matrixWorldInverse);
        
        // 2. Apply Custom Projection Math
        const dir = viewPos.clone().normalize();
        const zLinear = Math.max(0.01, -dir.z);
        const kStereo = 2.0 / (1.0 - dir.z);
        const kLinear = 1.0 / zLinear;
        const blend = globalUniforms.uBlend.value;
        const k = mix(kLinear, kStereo, blend);
        
        // Raw projected coords
        return { x: k * dir.x, y: k * dir.y, z: dir.z };
    }

    // ---------------------------
    // Environment
    // ---------------------------
    const groundGroup = new THREE.Group();
    scene.add(groundGroup);
    
    function createGround() {
        groundGroup.clear();
        const radius = 995;
        const geometry = new THREE.SphereGeometry(radius, 128, 64, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        const material = createSmartMaterial({
            uniforms: { color: { value: new THREE.Color(0x080a0e) } },
            vertexShaderBody: `varying vec3 vPos; void main() { vPos = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = smartProject(mvPosition); vScreenPos = gl_Position.xy / gl_Position.w; }`,
            fragmentShader: `uniform vec3 color; varying vec3 vPos; void main() { float alphaMask = getMaskAlpha(); if (alphaMask < 0.01) discard; float noise = sin(vPos.x * 0.2) * sin(vPos.z * 0.2) * 0.05; vec3 col = color + noise; vec3 n = normalize(vPos); float horizon = smoothstep(-0.02, 0.0, n.y); col += vec3(0.1, 0.15, 0.2) * horizon; gl_FragColor = vec4(col, 1.0); }`,
            side: THREE.BackSide, transparent: false, depthWrite: true, depthTest: true
        });
        const ground = new THREE.Mesh(geometry, material);
        groundGroup.add(ground);
        
        const boxGeo = new THREE.BoxGeometry(8, 30, 8);
        for(let i=0; i<12; i++) {
            const angle = (i/12) * Math.PI * 2; 
            const b = new THREE.Mesh(boxGeo, material); 
            const r = radius * 0.98;
            b.position.set(Math.cos(angle)*r, -15, Math.sin(angle)*r); 
            b.lookAt(0,0,0); 
            groundGroup.add(b);
        }
    }
    
        function createAtmosphere() {
    
            const geometry = new THREE.SphereGeometry(990, 128, 64);
    
            const material = createSmartMaterial({
    
                uniforms: { top: { value: new THREE.Color(0x000000) }, bot: { value: new THREE.Color(0x1a202c) } },
    
                vertexShaderBody: `
    
                    varying vec3 vP; 
    
                    void main() { 
    
                        vP = position; 
    
                        vec4 mv = modelViewMatrix * vec4(position, 1.0); 
    
                        gl_Position = smartProject(mv); 
    
                        vScreenPos = gl_Position.xy / gl_Position.w; 
    
                    }
    
                `,
    
                fragmentShader: `
    
                    uniform vec3 top; 
    
                    uniform vec3 bot; 
    
                    varying vec3 vP; 
    
                    void main() { 
    
                        float alphaMask = getMaskAlpha(); 
    
                        if (alphaMask < 0.01) discard; 
    
                        vec3 n = normalize(vP); 
    
                        float h = max(0.0, n.y); 
    
                        gl_FragColor = vec4(mix(bot, top, pow(h, 0.6)), 1.0); 
    
                    }
    
                `,
    
                side: THREE.BackSide, 
    
                depthWrite: false, 
    
                depthTest: true
    
            });
    
            
    
            const atm = new THREE.Mesh(geometry, material);
    
            groundGroup.add(atm);
    
        }
    
    const backdropGroup = new THREE.Group();
    scene.add(backdropGroup);
    
    function createBackdropStars() {
        backdropGroup.clear();
        const geometry = new THREE.BufferGeometry();
        const positions: number[] = [];
        const sizes: number[] = [];
        const colors: number[] = [];
        // Spectral palette for backdrop too
        const colorPalette = [ 
            new THREE.Color(0x9bb0ff), new THREE.Color(0xaabfff), new THREE.Color(0xcad7ff), 
            new THREE.Color(0xf8f7ff), new THREE.Color(0xfff4ea), new THREE.Color(0xffd2a1), 
            new THREE.Color(0xffcc6f) 
        ];

        const r = 2500;
        // Milky Way orientation (approximate tilt)
        const mwNormal = new THREE.Vector3(0, 1, 0.5).normalize(); 
        
        for (let i = 0; i < 4000; i++) {
            // 40% chance to be in Milky Way band
            const isMilkyWay = Math.random() < 0.4;
            
            let x, y, z;
            if (isMilkyWay) {
                // Generate point in a ring
                const theta = Math.random() * Math.PI * 2;
                // Gaussian scatter from plane
                const scatter = (Math.random() - 0.5) * 0.4; 
                
                // Base ring on XZ plane
                const v = new THREE.Vector3(Math.cos(theta), scatter, Math.sin(theta));
                v.normalize();
                
                // Rotate to align with Milky Way tilt (approx 60 deg)
                v.applyAxisAngle(new THREE.Vector3(1,0,0), THREE.MathUtils.degToRad(60));
                
                x = v.x * r;
                y = v.y * r;
                z = v.z * r;
            } else {
                // Uniform
                const u = Math.random();
                const v = Math.random();
                const theta = 2 * Math.PI * u;
                const phi = Math.acos(2 * v - 1);
                x = r * Math.sin(phi) * Math.cos(theta);
                y = r * Math.sin(phi) * Math.sin(theta);
                z = r * Math.cos(phi);
            }
            
            positions.push(x, y, z);
            
            const size = 0.5 + (-Math.log(Math.random()) * 0.8) * 1.5;
            sizes.push(size);
            
            const cIndex = Math.floor(Math.random() * colorPalette.length);
            const c = colorPalette[cIndex]!;
            colors.push(c.r, c.g, c.b);
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = createSmartMaterial({
            uniforms: { pixelRatio: { value: renderer.getPixelRatio() } },
            vertexShaderBody: `
                attribute float size; 
                attribute vec3 color; 
                varying vec3 vColor; 
                uniform float pixelRatio; 
                void main() { 
                    vColor = color; 
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); 
                    gl_Position = smartProject(mvPosition); 
                    vScreenPos = gl_Position.xy / gl_Position.w; 
                    gl_PointSize = size * pixelRatio * (600.0 / -mvPosition.z); 
                }
            `,
            fragmentShader: `
                varying vec3 vColor; 
                void main() { 
                    vec2 coord = gl_PointCoord - vec2(0.5); 
                    float dist = length(coord) * 2.0; 
                    if (dist > 1.0) discard; 
                    float alphaMask = getMaskAlpha(); 
                    if (alphaMask < 0.01) discard; 
                    // Use same Gaussian glow for backdrop
                    float alpha = exp(-3.0 * dist * dist);
                    gl_FragColor = vec4(vColor, alpha * alphaMask); 
                }
            `,
            transparent: true, 
            depthWrite: false, 
            depthTest: true
        });

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        backdropGroup.add(points);
    }
    
    createGround();
    createAtmosphere();
    createBackdropStars();

    // ---------------------------
    // Picking / Model content
    // ---------------------------
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 5.0; 
    const pointer = new THREE.Vector2();

    const root = new THREE.Group();
    scene.add(root);

    const nodeById = new Map<string, SceneNode>();
    const starIndexToId: string[] = [];
    
    const dynamicLabels: { obj: THREE.Mesh; node: SceneNode; initialScale: THREE.Vector2 }[] = [];
    
    // Hover Label
    const hoverLabelMat = createSmartMaterial({
        uniforms: { 
            uMap: { value: null },
            uSize: { value: new THREE.Vector2(1, 1) },
            uAlpha: { value: 0.0 },
            uAngle: { value: 0.0 }
        },
        vertexShaderBody: `
            uniform vec2 uSize;
            uniform float uAngle;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                vec4 projected = smartProject(mvPos);
                
                float c = cos(uAngle);
                float s = sin(uAngle);
                mat2 rot = mat2(c, -s, s, c);
                vec2 offset = rot * (position.xy * uSize);
                
                projected.xy += offset / vec2(uAspect, 1.0);
                gl_Position = projected;
            }
        `,
        fragmentShader: `
            uniform sampler2D uMap;
            uniform float uAlpha;
            varying vec2 vUv;
            void main() {
                float mask = getMaskAlpha();
                if (mask < 0.01) discard;
                vec4 tex = texture2D(uMap, vUv);
                gl_FragColor = vec4(tex.rgb, tex.a * uAlpha * mask);
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: false // Always on top of stars
    });
    const hoverLabelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hoverLabelMat);
    hoverLabelMesh.visible = false;
    hoverLabelMesh.renderOrder = 999;
    hoverLabelMesh.frustumCulled = false; // Ensure it's never culled
    root.add(hoverLabelMesh);
    let currentHoverNodeId: string | null = null;

    let constellationLines: THREE.LineSegments | null = null;
    let boundaryLines: THREE.LineSegments | null = null;
    let starPoints: THREE.Points | null = null;

    function clearRoot() {
        for (const child of [...root.children]) {
            root.remove(child);
            if ((child as any).geometry) (child as any).geometry.dispose();
            if ((child as any).material) {
                const m = (child as any).material;
                if (Array.isArray(m)) m.forEach((mm: any) => mm.dispose());
                else m.dispose();
            }
        }
        nodeById.clear();
        starIndexToId.length = 0;
        dynamicLabels.length = 0;
        constellationLines = null;
        boundaryLines = null;
        starPoints = null;
    }

    function createTextTexture(text: string, color: string = "#ffffff") {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        const fontSize = 96;
        ctx.font = `bold ${fontSize}px sans-serif`;
        const metrics = ctx.measureText(text);
        const w = Math.ceil(metrics.width);
        const h = Math.ceil(fontSize * 1.2);
        canvas.width = w;
        canvas.height = h;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, w / 2, h / 2);
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        return { tex, aspect: w / h };
    }

    function getPosition(n: SceneNode) {
        if (currentConfig?.arrangement) {
             const arr = currentConfig.arrangement[n.id];
             if (arr) {
                // If it's a 2D arrangement (z=0), project to sphere
                if (arr.position[2] === 0) {
                    const x = arr.position[0];
                    const y = arr.position[1];
                    const radius = currentConfig.layout?.radius ?? 2000;
                    
                    const r_norm = Math.min(1.0, Math.sqrt(x * x + y * y) / radius);
                    const phi = Math.atan2(y, x);
                    const theta = r_norm * (Math.PI / 2);
                    
                    return new THREE.Vector3(
                        Math.sin(theta) * Math.cos(phi),
                        Math.cos(theta),
                        Math.sin(theta) * Math.sin(phi)
                    ).multiplyScalar(radius);
                }
                return new THREE.Vector3(arr.position[0], arr.position[1], arr.position[2]);
             }
        }
        return new THREE.Vector3((n.meta?.x as number) ?? 0, (n.meta?.y as number) ?? 0, (n.meta?.z as number) ?? 0);
    }
    
    function getBoundaryPoint(angle: number, t: number, radius: number) {
        const y = 0.05 + t * (1.0 - 0.05);
        const rY = Math.sqrt(1 - y * y);
        const x = Math.cos(angle) * rY;
        const z = Math.sin(angle) * rY;
        return new THREE.Vector3(x, y, z).multiplyScalar(radius);
    }

    function buildFromModel(model: SceneModel, cfg: StarMapConfig) {
        clearRoot();
        scene.background = (cfg.background && cfg.background !== "transparent") ? new THREE.Color(cfg.background) : new THREE.Color(0x000000);

        const layoutCfg = { ...cfg.layout, radius: cfg.layout?.radius ?? 2000 };
        const laidOut = computeLayoutPositions(model, layoutCfg);

        // Pre-calculate Division centroids based on actual Book positions (Arrangement)
        const divisionPositions = new Map<string, THREE.Vector3>();
        if (cfg.arrangement) {
             const divMap = new Map<string, SceneNode[]>();
             for (const n of laidOut.nodes) {
                 if (n.level === 2 && n.parent) { // Book
                     const list = divMap.get(n.parent) ?? [];
                     list.push(n);
                     divMap.set(n.parent, list);
                 }
             }
             for (const [divId, books] of divMap.entries()) {
                 const centroid = new THREE.Vector3();
                 let count = 0;
                 for (const b of books) {
                     const p = getPosition(b);
                     centroid.add(p);
                     count++;
                 }
                 if (count > 0) {
                     centroid.divideScalar(count);
                     divisionPositions.set(divId, centroid);
                 }
             }
        }

        const starPositions: number[] = [];
        const starSizes: number[] = [];
        const starColors: number[] = [];
        
        // Realistic Star Colors (approx. Kelvin to Hex)
        const SPECTRAL_COLORS = [
            new THREE.Color(0x9bb0ff), // O - Blue
            new THREE.Color(0xaabfff), // B - Blue-white
            new THREE.Color(0xcad7ff), // A - White-blue
            new THREE.Color(0xf8f7ff), // F - White
            new THREE.Color(0xfff4ea), // G - Yellow-white
            new THREE.Color(0xffd2a1), // K - Yellow-orange
            new THREE.Color(0xffcc6f)  // M - Orange-red
        ];
        
        let minWeight = Infinity;
        let maxWeight = -Infinity;
        
        for (const n of laidOut.nodes) {
            nodeById.set(n.id, n);
            if (n.level === 3 && typeof n.weight === "number") {
                if (n.weight < minWeight) minWeight = n.weight;
                if (n.weight > maxWeight) maxWeight = n.weight;
            }
        }
        if (!Number.isFinite(minWeight)) { minWeight = 0; maxWeight = 1; }
        else if (minWeight === maxWeight) { maxWeight = minWeight + 1; }

        for (const n of laidOut.nodes) {
            if (n.level === 3) {
                const p = getPosition(n);
                starPositions.push(p.x, p.y, p.z);
                starIndexToId.push(n.id);

                let baseSize = 3.5;
                if (typeof n.weight === "number") {
                    const t = (n.weight - minWeight) / (maxWeight - minWeight);
                    baseSize = 3.0 + t * 4.0;
                }
                starSizes.push(baseSize);
                
                // Assign weighted random spectral color
                // Bias towards cooler stars (index higher) using pow(r, 1.5)
                const colorIdx = Math.floor(Math.pow(Math.random(), 1.5) * SPECTRAL_COLORS.length);
                const c = SPECTRAL_COLORS[Math.min(colorIdx, SPECTRAL_COLORS.length - 1)]!;
                starColors.push(c.r, c.g, c.b);
            }
            
            // 2. Process Labels (Level 1, 2, 3)
            if (n.level === 1 || n.level === 2 || n.level === 3) {
                const color = n.level === 1 ? "#38bdf8" : "#ffffff"; // Cyan for Divisions, White for Books/Chapters
                const texRes = createTextTexture(n.label, color);
                
                if (texRes) {
                    let baseScale = 0.05;
                    if (n.level === 1) baseScale = 0.08;
                    else if (n.level === 3) baseScale = 0.04;
                    
                    const size = new THREE.Vector2(baseScale * texRes.aspect, baseScale);
                    
                    const mat = createSmartMaterial({
                        uniforms: { 
                            uMap: { value: texRes.tex },
                            uSize: { value: size },
                            uAlpha: { value: 0.0 },
                            uAngle: { value: 0.0 }
                        },
                        vertexShaderBody: `
                            uniform vec2 uSize;
                            uniform float uAngle;
                            varying vec2 vUv;
                            void main() {
                                vUv = uv;
                                vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                                vec4 projected = smartProject(mvPos);
                                
                                float c = cos(uAngle);
                                float s = sin(uAngle);
                                mat2 rot = mat2(c, -s, s, c);
                                vec2 offset = rot * (position.xy * uSize);
                                
                                projected.xy += offset / vec2(uAspect, 1.0);
                                gl_Position = projected;
                            }
                        `,
                        fragmentShader: `
                            uniform sampler2D uMap;
                            uniform float uAlpha;
                            varying vec2 vUv;
                            void main() {
                                float mask = getMaskAlpha();
                                if (mask < 0.01) discard;
                                vec4 tex = texture2D(uMap, vUv);
                                gl_FragColor = vec4(tex.rgb, tex.a * uAlpha * mask);
                            }
                        `,
                        transparent: true,
                        depthWrite: false,
                        depthTest: true
                    });

                    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
                    let p = getPosition(n);
                    
                    // Override for Division Labels: Place on Horizon
                    if (n.level === 1) {
                        // Use calculated centroid from children if available (matches Voronoi layout)
                        if (divisionPositions.has(n.id)) {
                            p.copy(divisionPositions.get(n.id)!);
                        }
                        
                        const r = layoutCfg.radius * 0.95; 
                        const angle = Math.atan2(p.z, p.x);
                        p.set(r * Math.cos(angle), 150, r * Math.sin(angle)); // Lifted slightly
                    } else if (n.level === 3) {
                        // Offset chapters slightly so they hover above the star
                        p.multiplyScalar(1.002);
                    }
                    
                    mesh.position.set(p.x, p.y, p.z);
                    mesh.scale.set(size.x, size.y, 1.0); // Sync scale for raycast
                    mesh.frustumCulled = false;
                    mesh.userData = { id: n.id };
                    
                    root.add(mesh);
                    dynamicLabels.push({ obj: mesh, node: n, initialScale: size.clone() });
                }
            }
        }

        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
        starGeo.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));
        starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));

        const starMat = createSmartMaterial({
            uniforms: { pixelRatio: { value: renderer.getPixelRatio() } },
            vertexShaderBody: `
                attribute float size; 
                attribute vec3 color; 
                varying vec3 vColor; 
                uniform float pixelRatio; 
                void main() { 
                    vColor = color; 
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); 
                    gl_Position = smartProject(mvPosition); 
                    vScreenPos = gl_Position.xy / gl_Position.w; 
                    gl_PointSize = size * pixelRatio * (2000.0 / -mvPosition.z); 
                }
            `,
            fragmentShader: `
                varying vec3 vColor; 
                void main() { 
                    vec2 coord = gl_PointCoord - vec2(0.5); 
                    // Use larger drawing area for glow
                    float dist = length(coord) * 2.0; 
                    if (dist > 1.0) discard; 
                    
                    float alphaMask = getMaskAlpha(); 
                    if (alphaMask < 0.01) discard; 
                    
                    // Gaussian Glow: Sharp core, soft halo
                    float alpha = exp(-3.0 * dist * dist);
                    
                    gl_FragColor = vec4(vColor, alpha * alphaMask); 
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true
        });

        starPoints = new THREE.Points(starGeo, starMat);
        starPoints.frustumCulled = false;
        root.add(starPoints);

        const linePoints: number[] = [];
        const bookMap = new Map<string, SceneNode[]>();
        for (const n of laidOut.nodes) {
            if (n.level === 3 && n.parent) {
                const list = bookMap.get(n.parent) ?? [];
                list.push(n);
                bookMap.set(n.parent, list);
            }
        }
        for (const chapters of bookMap.values()) {
            chapters.sort((a, b) => ((a.meta?.chapter as number) || 0) - ((b.meta?.chapter as number) || 0));
            if (chapters.length < 2) continue;
            for (let i = 0; i < chapters.length - 1; i++) {
                const c1 = chapters[i]; const c2 = chapters[i+1];
                if (!c1 || !c2) continue;
                const p1 = getPosition(c1); const p2 = getPosition(c2);
                linePoints.push(p1.x, p1.y, p1.z); linePoints.push(p2.x, p2.y, p2.z);
            }
        }
        if (linePoints.length > 0) {
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
            const lineMat = createSmartMaterial({
                uniforms: { color: { value: new THREE.Color(0xaaccff) } },
                vertexShaderBody: `uniform vec3 color; varying vec3 vColor; void main() { vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = smartProject(mvPosition); vScreenPos = gl_Position.xy / gl_Position.w; }`,
                fragmentShader: `varying vec3 vColor; void main() { float alphaMask = getMaskAlpha(); if (alphaMask < 0.01) discard; gl_FragColor = vec4(vColor, 0.4 * alphaMask); }`,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
            });
            constellationLines = new THREE.LineSegments(lineGeo, lineMat);
            constellationLines.frustumCulled = false;
            root.add(constellationLines);
        }

        const boundaries = (laidOut.meta?.divisionBoundaries as number[]) ?? [];
        if (boundaries.length > 0) {
            const boundaryMat = createSmartMaterial({
                uniforms: { color: { value: new THREE.Color(0x557799) } },
                vertexShaderBody: `uniform vec3 color; varying vec3 vColor; void main() { vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = smartProject(mvPosition); vScreenPos = gl_Position.xy / gl_Position.w; }`,
                fragmentShader: `varying vec3 vColor; void main() { float alphaMask = getMaskAlpha(); if (alphaMask < 0.01) discard; gl_FragColor = vec4(vColor, 0.10 * alphaMask); }`,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
            });
            const boundaryGeo = new THREE.BufferGeometry();
            const bPoints: number[] = [];
            boundaries.forEach(angle => {
                const steps = 32;
                for (let i = 0; i < steps; i++) {
                    const t1 = i / steps; const t2 = (i + 1) / steps;
                    const p1 = getBoundaryPoint(angle, t1, layoutCfg.radius!); const p2 = getBoundaryPoint(angle, t2, layoutCfg.radius!);
                    bPoints.push(p1.x, p1.y, p1.z); bPoints.push(p2.x, p2.y, p2.z);
                }
            });
            boundaryGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPoints, 3));
            boundaryLines = new THREE.LineSegments(boundaryGeo, boundaryMat);
            boundaryLines.frustumCulled = false;
            root.add(boundaryLines);
        }

        // Render Voronoi Polygons (Cell Lines)
        if (cfg.polygons) {
            const polyPoints: number[] = [];
            const rBase = layoutCfg.radius;
            
            for (const pts of Object.values(cfg.polygons)) {
                if (pts.length < 2) continue;
                for (let i = 0; i < pts.length; i++) {
                    const p1_2d = pts[i];
                    const p2_2d = pts[(i + 1) % pts.length];
                    if (!p1_2d || !p2_2d) continue;

                    // Project 2D -> 3D Sphere
                    const project2dTo3d = (p: number[]) => {
                        const x = p[0]!;
                        const y = p[1]!;
                        const r_norm = Math.sqrt(x * x + y * y);
                        const phi = Math.atan2(y, x);
                        // Map r_norm (0..1) to angle from zenith (0..PI/2)
                        // Horizon is at 0.05 in some other places, but let's use full PI/2 for cells
                        const theta = r_norm * (Math.PI / 2);
                        
                        return new THREE.Vector3(
                            Math.sin(theta) * Math.cos(phi),
                            Math.cos(theta),
                            Math.sin(theta) * Math.sin(phi)
                        ).multiplyScalar(rBase);
                    };

                    const v1 = project2dTo3d(p1_2d);
                    const v2 = project2dTo3d(p2_2d);

                    polyPoints.push(v1.x, v1.y, v1.z);
                    polyPoints.push(v2.x, v2.y, v2.z);
                }
            }
            if (polyPoints.length > 0) {
                const polyGeo = new THREE.BufferGeometry();
                polyGeo.setAttribute('position', new THREE.Float32BufferAttribute(polyPoints, 3));
                
                // Use a brighter color for cell lines and higher opacity
                const polyMat = createSmartMaterial({
                    uniforms: { color: { value: new THREE.Color(0x38bdf8) } }, // Cyan-ish
                    vertexShaderBody: `uniform vec3 color; varying vec3 vColor; void main() { vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = smartProject(mvPosition); vScreenPos = gl_Position.xy / gl_Position.w; }`,
                    fragmentShader: `varying vec3 vColor; void main() { float alphaMask = getMaskAlpha(); if (alphaMask < 0.01) discard; gl_FragColor = vec4(vColor, 0.2 * alphaMask); }`,
                    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
                });
                
                const polyLines = new THREE.LineSegments(polyGeo, polyMat);
                polyLines.frustumCulled = false;
                root.add(polyLines);
            }
        }
        
        resize();
    }

    let lastData: any = undefined;
    let lastAdapter: any = undefined;
    let lastModel: SceneModel | undefined = undefined;
    let lastAppliedLon: number | undefined = undefined;
    let lastAppliedLat: number | undefined = undefined;

    function setConfig(cfg: StarMapConfig) {
        currentConfig = cfg;
        
        // Update Camera Orientation if provided and changed
        if (typeof cfg.camera?.lon === 'number' && cfg.camera.lon !== lastAppliedLon) {
             state.lon = cfg.camera.lon;
             state.targetLon = cfg.camera.lon;
             lastAppliedLon = cfg.camera.lon;
        }
        if (typeof cfg.camera?.lat === 'number' && cfg.camera.lat !== lastAppliedLat) {
             state.lat = cfg.camera.lat;
             state.targetLat = cfg.camera.lat;
             lastAppliedLat = cfg.camera.lat;
        }

        let shouldRebuild = false;
        let model = cfg.model;
        if (!model && cfg.data && cfg.adapter) {
            if (cfg.data !== lastData || cfg.adapter !== lastAdapter) {
                model = cfg.adapter(cfg.data);
                shouldRebuild = true;
                lastData = cfg.data; lastAdapter = cfg.adapter; lastModel = model;
            } else { model = lastModel; }
        } else if (model) {
            shouldRebuild = true; lastData = undefined; lastAdapter = undefined; lastModel = model;
        }
        if (shouldRebuild && model) { buildFromModel(model, cfg); }
        else if (cfg.arrangement && starPoints) { if (lastModel) buildFromModel(lastModel, cfg); }
        
        if (cfg.constellations) {
            constellationLayer.load(cfg.constellations, (id) => {
                const n = nodeById.get(id);
                return n ? getPosition(n) : null;
            });
        }
    }
    
    function setHandlers(next: Handlers) { handlers = next; }
    
    function getFullArrangement(): StarArrangement {
        const arr: StarArrangement = {};
        if (starPoints && starPoints.geometry.attributes.position) {
            const attr = starPoints.geometry.attributes.position;
            for (let i = 0; i < starIndexToId.length; i++) {
                const id = starIndexToId[i];
                if (id) {
                    const x = attr.getX(i);
                    const y = attr.getY(i);
                    const z = attr.getZ(i);
                    arr[id] = { position: [x, y, z] };
                }
            }
        }
        
        for (const item of dynamicLabels) {
            arr[item.node.id] = { position: [item.obj.position.x, item.obj.position.y, item.obj.position.z] };
        }
        
        // Merge temp arrangement to ensure dragged items are up to date
        Object.assign(arr, state.tempArrangement);
        
        return arr;
    }

    function pick(ev: MouseEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mX = ev.clientX - rect.left;
        const mY = ev.clientY - rect.top;
        mouseNDC.x = (mX / rect.width) * 2 - 1;
        mouseNDC.y = -(mY / rect.height) * 2 + 1;

        // 1. Pick Labels (2D Screen Distance - robust for billboards)
        let closestLabel = null;
        let minLabelDist = 40; // Pixel threshold
        const uScale = globalUniforms.uScale.value;
        const uAspect = camera.aspect;
        const w = rect.width; const h = rect.height;

        for (const item of dynamicLabels) {
            if (!item.obj.visible) continue;
            // Project Anchor Position (World -> View -> Projected)
            const pWorld = item.obj.position;
            const pProj = smartProjectJS(pWorld);
            
            const xNDC = pProj.x * uScale / uAspect;
            const yNDC = pProj.y * uScale;
            
            const sX = (xNDC * 0.5 + 0.5) * w;
            const sY = (-yNDC * 0.5 + 0.5) * h;
            
            const dx = mX - sX; const dy = mY - sY;
            const d = Math.sqrt(dx*dx + dy*dy);
            
            // Back-face cull check
            const isBehind = (globalUniforms.uBlend.value > 0.5 && pProj.z > 0.4) || (globalUniforms.uBlend.value < 0.1 && pProj.z > -0.1);
            if (!isBehind && d < minLabelDist) { minLabelDist = d; closestLabel = item; }
        }
        if (closestLabel) return { type: 'label', node: closestLabel.node, object: closestLabel.obj, point: closestLabel.obj.position.clone(), index: undefined };

        // 2. Pick Stars (Custom World Ray)
        const worldDir = getMouseWorldVector(mX, mY, rect.width, rect.height);
        raycaster.ray.origin.set(0, 0, 0);
        raycaster.ray.direction.copy(worldDir);
        raycaster.params.Points.threshold = 5.0 * (state.fov / 60);

        const hits = raycaster.intersectObject(starPoints!, false);
        const pointHit = hits[0];
        if (pointHit && pointHit.index !== undefined) {
            const id = starIndexToId[pointHit.index];
            if (id) {
                const node = nodeById.get(id);
                if (node) return { type: 'star', node, index: pointHit.index, point: pointHit.point, object: undefined };
            }
        }
        return undefined;
    }
    
    function onMouseDown(e: MouseEvent) {
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
        if (currentConfig?.editable) {
            const hit = pick(e);
            if (hit) {
                state.dragMode = 'node';
                state.draggedNodeId = hit.node.id;
                state.draggedDist = hit.point.length(); 
                document.body.style.cursor = 'crosshair';
                if (hit.type === 'star') {
                    state.draggedStarIndex = hit.index ?? -1;
                    state.draggedGroup = null;
                } else if (hit.type === 'label') {
                    // Group capture
                    const bookId = hit.node.id;
                    const children: { index: number, initialPos: THREE.Vector3 }[] = [];
                    if (starPoints && starPoints.geometry.attributes.position) {
                        const positions = starPoints.geometry.attributes.position.array;
                        for (let i = 0; i < starIndexToId.length; i++) {
                            const starId = starIndexToId[i];
                            if (starId) {
                                const starNode = nodeById.get(starId);
                                if (starNode && starNode.parent === bookId) {
                                    children.push({ index: i, initialPos: new THREE.Vector3(positions[i*3], positions[i*3+1], positions[i*3+2]) });
                                }
                            }
                        }
                    }
                    state.draggedGroup = { labelInitialPos: hit.object!.position.clone(), children };
                    state.draggedStarIndex = -1;
                }
                return;
            }
        }
        state.dragMode = 'camera';
        state.isDragging = true;
        state.velocityX = 0; state.velocityY = 0;
        state.tempArrangement = {};
        document.body.style.cursor = 'grabbing';
    }

    function onMouseMove(e: MouseEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mX = e.clientX - rect.left;
        const mY = e.clientY - rect.top;
        mouseNDC.x = (mX / rect.width) * 2 - 1;
        mouseNDC.y = -(mY / rect.height) * 2 + 1;
        isMouseInWindow = true;

        if (state.dragMode === 'node') {
             // Drag in World Space
             const worldDir = getMouseWorldVector(mX, mY, rect.width, rect.height);
             const newPos = worldDir.multiplyScalar(state.draggedDist);
             
             if (state.draggedStarIndex !== -1 && starPoints) {
                 const idx = state.draggedStarIndex;
                 const attr = starPoints.geometry.attributes.position as THREE.BufferAttribute;
                 attr.setXYZ(idx, newPos.x, newPos.y, newPos.z);
                 attr.needsUpdate = true;
             } 
             else if (state.draggedGroup && state.draggedNodeId) {
                 const group = state.draggedGroup;
                 const item = dynamicLabels.find(l => l.node.id === state.draggedNodeId);
                 if (item) {
                     item.obj.position.copy(newPos);
                     state.tempArrangement[item.node.id] = { position: [newPos.x, newPos.y, newPos.z] };
                 }
                 
                 // Rotate children based on World Vectors
                 const vStart = group.labelInitialPos.clone().normalize();
                 const vEnd = newPos.clone().normalize();
                 const q = new THREE.Quaternion().setFromUnitVectors(vStart, vEnd);
                 
                 if (starPoints && group.children.length > 0) {
                     const attr = starPoints.geometry.attributes.position as THREE.BufferAttribute;
                     const tempVec = new THREE.Vector3();
                     for (const child of group.children) {
                         tempVec.copy(child.initialPos).applyQuaternion(q);
                         attr.setXYZ(child.index, tempVec.x, tempVec.y, tempVec.z);
                         
                         const id = starIndexToId[child.index];
                         if (id) {
                             state.tempArrangement[id] = { position: [tempVec.x, tempVec.y, tempVec.z] };
                         }
                     }
                     attr.needsUpdate = true;
                 }
             }
        } else if (state.dragMode === 'camera') {
            const deltaX = e.clientX - state.lastMouseX;
            const deltaY = e.clientY - state.lastMouseY;
            state.lastMouseX = e.clientX; state.lastMouseY = e.clientY;
                        const speedScale = state.fov / ENGINE_CONFIG.defaultFov;
                        
                        state.targetLon += deltaX * ENGINE_CONFIG.dragSpeed * speedScale;
            state.targetLat += deltaY * ENGINE_CONFIG.dragSpeed * speedScale;
            state.targetLat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.targetLat));
            state.velocityX = deltaX * ENGINE_CONFIG.dragSpeed * speedScale;
            state.velocityY = deltaY * ENGINE_CONFIG.dragSpeed * speedScale;
            state.lon = state.targetLon; state.lat = state.targetLat;
        } else {
            const hit = pick(e);
            
            // Hover Label Logic
            if (hit && hit.type === 'star') {
                if (currentHoverNodeId !== hit.node.id) {
                    currentHoverNodeId = hit.node.id;
                    const res = createTextTexture(hit.node.label, "#ffd700"); // Gold
                    if (res) {
                        hoverLabelMat.uniforms.uMap.value = res.tex;
                        const baseScale = 0.03;
                        const size = new THREE.Vector2(baseScale * res.aspect, baseScale);
                        hoverLabelMat.uniforms.uSize.value = size;
                        hoverLabelMesh.scale.set(size.x, size.y, 1);
                    }
                }
                // Position at the star
                hoverLabelMesh.position.copy(hit.point);
                // No lookAt needed for billboard shader
                hoverLabelMat.uniforms.uAlpha.value = 1.0;
                hoverLabelMesh.visible = true;
            } else {
                currentHoverNodeId = null;
                hoverLabelMat.uniforms.uAlpha.value = 0.0;
                hoverLabelMesh.visible = false;
            }

            if (hit?.node.id !== (handlers as any)._lastHoverId) {
                (handlers as any)._lastHoverId = hit?.node.id;
                handlers.onHover?.(hit?.node);
                constellationLayer.setHovered(hit?.node.id ?? null);
            }
            document.body.style.cursor = hit ? (currentConfig?.editable ? 'crosshair' : 'pointer') : 'default';
        }
    }

    function onMouseUp(e: MouseEvent) {
        if (state.dragMode === 'node') {
            const fullArr = getFullArrangement();
            handlers.onArrangementChange?.(fullArr);
            state.dragMode = 'none';
            state.draggedNodeId = null; state.draggedStarIndex = -1; state.draggedGroup = null;
            document.body.style.cursor = 'default';
        } else if (state.dragMode === 'camera') {
            state.isDragging = false; state.dragMode = 'none';
            document.body.style.cursor = 'default';
        } else {
            const hit = pick(e);
            if (hit) {
                handlers.onSelect?.(hit.node);
                constellationLayer.setFocused(hit.node.id);
            }
        }
    }
    
    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const aspect = container.clientWidth / container.clientHeight;
        const rect = renderer.domElement.getBoundingClientRect();
        // Camera Rotate Logic still uses View Space matching to feel right
        const vBefore = getMouseViewVector(state.fov, aspect); 
        
        const zoomSpeed = 0.001 * state.fov;
        state.fov += e.deltaY * zoomSpeed;
        state.fov = Math.max(ENGINE_CONFIG.minFov, Math.min(ENGINE_CONFIG.maxFov, state.fov));
        
        updateUniforms(); 
        const vAfter = getMouseViewVector(state.fov, aspect);
        
        const quaternion = new THREE.Quaternion().setFromUnitVectors(vAfter, vBefore);
        const y = Math.sin(state.lat); const r = Math.cos(state.lat);
        const x = r * Math.sin(state.lon); const z = -r * Math.cos(state.lon);
        const currentLook = new THREE.Vector3(x, y, z);
        const camForward = currentLook.clone().normalize();
        const camUp = camera.up.clone();
        const camRight = new THREE.Vector3().crossVectors(camForward, camUp).normalize();
        const camUpOrtho = new THREE.Vector3().crossVectors(camRight, camForward).normalize();
        const mat = new THREE.Matrix4().makeBasis(camRight, camUpOrtho, camForward.clone().negate());
        const qOld = new THREE.Quaternion().setFromRotationMatrix(mat);
        const qNew = qOld.clone().multiply(quaternion);
        const newForward = new THREE.Vector3(0, 0, -1).applyQuaternion(qNew);
        state.lat = Math.asin(Math.max(-0.999, Math.min(0.999, newForward.y)));
        state.lon = Math.atan2(newForward.x, -newForward.z);
        const newUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qNew);
        camera.up.copy(newUp);
        
        if (e.deltaY > 0 && state.fov > ENGINE_CONFIG.zenithStartFov) {
            const range = ENGINE_CONFIG.maxFov - ENGINE_CONFIG.zenithStartFov;
            let t = (state.fov - ENGINE_CONFIG.zenithStartFov) / range; t = Math.max(0, Math.min(1, t));
            const bias = ENGINE_CONFIG.zenithStrength * t; const zenithLat = Math.PI / 2 - 0.001;
            state.lat = mix(state.lat, zenithLat, bias);
        }
        state.targetLat = state.lat; state.targetLon = state.lon;
    }

    function resize() {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        updateUniforms();
    }

    function start() {
        if (running) return;
        running = true;
        resize();
        window.addEventListener("resize", resize);
        const el = renderer.domElement;
        el.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove); 
        window.addEventListener("mouseup", onMouseUp);
        el.addEventListener("wheel", onWheel, { passive: false });
        el.addEventListener("mouseenter", () => { isMouseInWindow = true; });
        el.addEventListener("mouseleave", () => { isMouseInWindow = false; });
        raf = requestAnimationFrame(tick);
    }
    
    function tick() {
        if (!running) return;
        raf = requestAnimationFrame(tick);
        
        if (!state.isDragging && isMouseInWindow) {
            const t = ENGINE_CONFIG.edgePanThreshold;
            const speedBase = ENGINE_CONFIG.edgePanMaxSpeed * (state.fov / ENGINE_CONFIG.defaultFov);
            let panX = 0; let panY = 0;
            if (mouseNDC.x < -1 + t) { const s = (-1 + t - mouseNDC.x) / t; panX = -s * s * speedBase; }
            else if (mouseNDC.x > 1 - t) { const s = (mouseNDC.x - (1 - t)) / t; panX = s * s * speedBase; }
            if (mouseNDC.y < -1 + t) { const s = (-1 + t - mouseNDC.y) / t; panY = -s * s * speedBase; }
            else if (mouseNDC.y > 1 - t) { const s = (mouseNDC.y - (1 - t)) / t; panY = s * s * speedBase; }
            if (Math.abs(panX) > 0 || Math.abs(panY) > 0) {
                state.lon += panX; state.lat += panY; state.targetLon = state.lon; state.targetLat = state.lat;
            } else {
                state.lon += state.velocityX; state.lat += state.velocityY;
                state.velocityX *= ENGINE_CONFIG.inertiaDamping; state.velocityY *= ENGINE_CONFIG.inertiaDamping;
                if (Math.abs(state.velocityX) < 0.000001) state.velocityX = 0;
                if (Math.abs(state.velocityY) < 0.000001) state.velocityY = 0;
            }
        } else if (!state.isDragging) {
             state.lon += state.velocityX; state.lat += state.velocityY;
             state.velocityX *= ENGINE_CONFIG.inertiaDamping; state.velocityY *= ENGINE_CONFIG.inertiaDamping;
        }

        state.lat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.lat));
        const y = Math.sin(state.lat); const r = Math.cos(state.lat);
        const x = r * Math.sin(state.lon); const z = -r * Math.cos(state.lon);
        const target = new THREE.Vector3(x, y, z);
        const idealUp = new THREE.Vector3(-Math.sin(state.lat) * Math.sin(state.lon), Math.cos(state.lat), Math.sin(state.lat) * Math.cos(state.lon)).normalize();
        camera.up.lerp(idealUp, ENGINE_CONFIG.horizonLockStrength);
        camera.up.normalize();
        camera.lookAt(target);
        updateUniforms(); 
        
        constellationLayer.update(state.fov, currentConfig?.showConstellationArt ?? false);

        const DIVISION_THRESHOLD = 60;
        const showDivisions = state.fov > DIVISION_THRESHOLD;

        // --- Constellation Lines Visibility ---
        if (constellationLines) {
            constellationLines.visible = currentConfig?.showConstellationLines ?? false;
        }
        if (boundaryLines) {
            boundaryLines.visible = currentConfig?.showDivisionBoundaries ?? false;
        }
        
        // --- Polished Label Management ---
        // 1. Collect and Project
        const rect = renderer.domElement.getBoundingClientRect();
        const screenW = rect.width;
        const screenH = rect.height;
        const aspect = screenW / screenH;
        const labelsToCheck = [];
        const occupied: {x:number, y:number, w:number, h:number}[] = [];

        function isOverlapping(x:number, y:number, w:number, h:number) {
            for (const r of occupied) {
                if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return true;
            }
            return false;
        }

        const showBookLabels = currentConfig?.showBookLabels === true;
        const showDivisionLabels = currentConfig?.showDivisionLabels === true;
        const showChapterLabels = currentConfig?.showChapterLabels === true;
        
        // FOV thresholds
        // showDivisions already calculated above
        const showChapters = state.fov < 35;

        for (const item of dynamicLabels) {
            const uniforms = (item.obj.material as THREE.ShaderMaterial).uniforms as any;
            const level = item.node.level;

            // Global Toggle Check
            let isEnabled = false;
            if (level === 2 && showBookLabels) isEnabled = true;
            else if (level === 1 && showDivisionLabels) isEnabled = true;
            else if (level === 3 && showChapterLabels) isEnabled = true;
            
            if (!isEnabled) {
                 uniforms.uAlpha.value = THREE.MathUtils.lerp(uniforms.uAlpha.value, 0, 0.2);
                 item.obj.visible = uniforms.uAlpha.value > 0.01;
                 continue;
            }

            // Project to Screen
            const pWorld = item.obj.position;
            const pProj = smartProjectJS(pWorld);
            
            // Frustum Cull
            if (pProj.z > 0.2) { 
                 uniforms.uAlpha.value = THREE.MathUtils.lerp(uniforms.uAlpha.value, 0, 0.2);
                 item.obj.visible = uniforms.uAlpha.value > 0.01;
                 continue;
            } 
            
            // Optimization: If Level 3 (Chapters) and not zoomed in, cull immediately
            if (level === 3 && !showChapters && item.node.id !== state.draggedNodeId) {
                 uniforms.uAlpha.value = THREE.MathUtils.lerp(uniforms.uAlpha.value, 0, 0.2);
                 item.obj.visible = uniforms.uAlpha.value > 0.01;
                 continue;
            }

            // Calculate screen coords
            const ndcX = pProj.x * globalUniforms.uScale.value / aspect;
            const ndcY = pProj.y * globalUniforms.uScale.value;
            const sX = (ndcX * 0.5 + 0.5) * screenW;
            const sY = (-ndcY * 0.5 + 0.5) * screenH;
            
            // Dimensions
            const size = (uniforms.uSize.value as THREE.Vector2);
            const pixelH = size.y * screenH * 0.8; 
            const pixelW = size.x * screenH * 0.8; 
            
            // Push to check list
            labelsToCheck.push({ item, sX, sY, w: pixelW, h: pixelH, uniforms, level });
        }
        
        // 2. Sort by Priority
        const hoverId = (handlers as any)._lastHoverId;
        const selectedId = state.draggedNodeId; 
        
        labelsToCheck.sort((a, b) => {
            const getScore = (l: typeof a) => {
                if (l.item.node.id === selectedId) return 10;
                if (l.item.node.id === hoverId) return 9;
                const level = l.level;
                if (level === 2) return 5; 
                if (level === 1) return showDivisions ? 6 : 1; 
                return 0;
            };
            return getScore(b) - getScore(a);
        });

        // 3. Collision & Target Alpha
        for (const l of labelsToCheck) {
            let target = 0.0;
            const isSpecial = l.item.node.id === selectedId || l.item.node.id === hoverId;
            
            // Rotation Logic for Divisions (Level 1)
            if (l.level === 1) {
                let rot = 0;
                const blend = globalUniforms.uBlend.value;
                if (blend > 0.5) {
                    const dx = l.sX - screenW / 2;
                    const dy = l.sY - screenH / 2;
                    rot = Math.atan2(-dy, -dx) - Math.PI / 2;
                }
                l.uniforms.uAngle.value = THREE.MathUtils.lerp(l.uniforms.uAngle.value, rot, 0.1);
            }

            if (l.level === 2) {
                // Books: Always visible if enabled
                target = 1.0;
                occupied.push({ x: l.sX - l.w/2, y: l.sY - l.h/2, w: l.w, h: l.h });
            } 
            else if (l.level === 1) {
                // Divisions: Check overlaps
                if (showDivisions || isSpecial) {
                    const pad = -5;
                    if (!isOverlapping(l.sX - l.w/2 - pad, l.sY - l.h/2 - pad, l.w + pad*2, l.h + pad*2)) {
                        target = 1.0;
                        occupied.push({ x: l.sX - l.w/2, y: l.sY - l.h/2, w: l.w, h: l.h });
                    }
                }
            }
            else if (l.level === 3) {
                // Chapters: No overlap check, just zoom check
                if (showChapters || isSpecial) {
                    target = 1.0;
                }
            }
            
            l.uniforms.uAlpha.value = THREE.MathUtils.lerp(l.uniforms.uAlpha.value, target, 0.1);
            l.item.obj.visible = l.uniforms.uAlpha.value > 0.01;
        }
        renderer.render(scene, camera);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        const el = renderer.domElement;
        el.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        el.removeEventListener("wheel", onWheel as any);
    }
    function dispose() { stop(); constellationLayer.dispose(); renderer.dispose(); renderer.domElement.remove(); }

    return { setConfig, start, stop, dispose, setHandlers, getFullArrangement };
}
