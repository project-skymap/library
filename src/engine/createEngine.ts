import * as THREE from "three";
import type { StarMapConfig, SceneModel, SceneNode, StarArrangement } from "../types";
import { computeLayoutPositions } from "./layout";
import { createSmartMaterial, globalUniforms } from "./materials";

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
            pivotInitialPos: THREE.Vector3,
            stars: { index: number, initialPos: THREE.Vector3 }[],
            labels: { item: any, initialPos: THREE.Vector3 }[]
        }
    };

    const mouseNDC = new THREE.Vector2();
    let isMouseInWindow = false;

    let handlers: Handlers = { onSelect, onHover, onArrangementChange };
    let currentConfig: StarMapConfig | undefined;

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
    
    const dynamicLabels: { obj: THREE.Mesh; node: SceneNode; initialScale: THREE.Vector2; type: 'book' | 'group' | 'chapter' }[] = [];
    
    // Map starId -> list of indices in the line position attribute
    const starLineIndices = new Map<string, number[]>();
    const parentToStarIndices = new Map<string, number[]>();
    const textureCache = new Map<string, { tex: THREE.Texture; aspect: number }>();

    let constellationLines: THREE.LineSegments | null = null;
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
        starLineIndices.clear();
        textureCache.clear();
        constellationLines = null;
        starPoints = null;
    }

    function updateLabelCentroids() {
        if (!starPoints) return;
        const positions = starPoints.geometry.attributes.position.array;
        
        for (const item of dynamicLabels) {
            // Only update Book and Group labels
            if (item.type === 'book' || item.type === 'group') {
                // If user is actively dragging THIS label, don't auto-center it (fight)
                if (state.dragMode === 'node' && state.draggedNodeId === item.node.id) continue;

                let sumX = 0, sumY = 0, sumZ = 0, count = 0;

                // Helper to add stars from a specific parent (recursive check not needed if we map correctly)
                // We need all descendants. 
                // Since we don't have a fast "get all descendants" map, let's rely on the fact that
                // Groups have direct star children.
                // Books have Group children (who have stars) OR direct star children.
                
                // Fast path: Use `parentToStarIndices` which we will populate to include deep descendants
                const indices = parentToStarIndices.get(item.node.id);
                if (indices) {
                    for (const idx of indices) {
                        sumX += positions[idx*3];
                        sumY += positions[idx*3+1];
                        sumZ += positions[idx*3+2];
                        count++;
                    }
                }

                if (count > 0) {
                    const cx = sumX / count;
                    const cy = sumY / count;
                    const cz = sumZ / count;
                    
                    // Smooth lerp for visual stability, or snap? Snap is better for accuracy.
                    item.obj.position.set(cx, cy, cz);
                    
                    // Offset Book labels slightly "up" (towards zenith/camera?) or just keep centered?
                    // Previous logic had an offset. Let's keep them centered for now as per request "track the centre".
                    // Maybe slight Y bias for books to be above groups?
                    if (item.type === 'book') {
                        // Simple heuristic: push slightly towards normal
                        // const n = new THREE.Vector3(cx, cy, cz).normalize().multiplyScalar(10);
                        // item.obj.position.add(n);
                    }
                }
            }
        }
    }

    function createTextTexture(text: string, color: string = "#ffffff") {
        const key = `${text}:${color}`;
        if (textureCache.has(key)) return textureCache.get(key)!;

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
        
        const res = { tex, aspect: w / h };
        textureCache.set(key, res);
        return res;
    }

    function getPosition(n: SceneNode) {
        if (currentConfig?.arrangement) {
             const arr = currentConfig.arrangement[n.id];
             if (arr) return new THREE.Vector3(arr.position[0], arr.position[1], arr.position[2]);
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
        try {
            clearRoot();
            scene.background = (cfg.background && cfg.background !== "transparent") ? new THREE.Color(cfg.background) : new THREE.Color(0x000000);

            const layoutCfg = { ...cfg.layout, radius: cfg.layout?.radius ?? 2000 };
            const laidOut = computeLayoutPositions(model, layoutCfg);
            console.log(`[Engine] Total nodes in layout: ${laidOut.nodes.length}`);

            const starPositions: number[] = [];
        const starSizes: number[] = [];
        const starColors: number[] = [];
        
        let starCount = 0;
        let groupLabelCount = 0;
        
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
            if (n.meta?.chapter && typeof n.weight === "number") {
                if (n.weight < minWeight) minWeight = n.weight;
                if (n.weight > maxWeight) maxWeight = n.weight;
            }
        }
        if (!Number.isFinite(minWeight)) { minWeight = 0; maxWeight = 1; }
        else if (minWeight === maxWeight) { maxWeight = minWeight + 1; }

        for (const n of laidOut.nodes) {
            // 1. Stars (Chapters)
            if (n.meta?.chapter) {
                starCount++;
                const p = getPosition(n);
                starPositions.push(p.x, p.y, p.z);
                starIndexToId.push(n.id);

                let baseSize = 3.5;
                if (typeof n.weight === "number") {
                    const t = (n.weight - minWeight) / (maxWeight - minWeight);
                    baseSize = 5.0 + t * 5.0; // Increased base size for better visibility
                }
                starSizes.push(baseSize);
                
                const colorIdx = Math.floor(Math.pow(Math.random(), 1.5) * SPECTRAL_COLORS.length);
                const c = SPECTRAL_COLORS[Math.min(colorIdx, SPECTRAL_COLORS.length - 1)]!;
                starColors.push(c.r, c.g, c.b);

                // Create Chapter Number Label
                const chNum = n.meta.chapter;
                if (chNum) {
                    const texRes = createTextTexture(String(chNum), "#88ccff");
                    if (texRes) {
                        const baseScale = 0.04; // Doubled from 0.02
                        const size = new THREE.Vector2(baseScale * texRes.aspect, baseScale);
                        
                        const mat = createSmartMaterial({
                            uniforms: { 
                                uMap: { value: texRes.tex },
                                uSize: { value: size },
                                uAlpha: { value: 0.0 } 
                            },
                            vertexShaderBody: `
                                uniform vec2 uSize;
                                varying vec2 vUv;
                                void main() {
                                    vUv = uv;
                                    vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                                    gl_Position = smartProject(mvPos);
                                    // Offset label slightly above star
                                    gl_Position.y += 0.015 * gl_Position.w; 
                                    vec2 offset = position.xy * uSize;
                                    gl_Position.xy += offset / vec2(uAspect, 1.0);
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
                            transparent: true, depthWrite: false, depthTest: false // Always on top of star
                        });

                        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
                        mesh.position.set(p.x, p.y, p.z);
                        mesh.scale.set(size.x, size.y, 1.0);
                        mesh.frustumCulled = false;
                        mesh.userData = { id: n.id };
                        root.add(mesh);
                        dynamicLabels.push({ obj: mesh, node: n, initialScale: size.clone(), type: 'chapter' });
                    }
                }
            }
            // 2. Process Labels (Level 2 = Books, Level 3 = Groups)
            else if (n.level === 2 || (n.level === 3 && n.meta?.group)) {
                if (n.level === 3) groupLabelCount++;
                const color = n.level === 2 ? "#ffffff" : "#ddeeff"; // Brighter for groups
                const texRes = createTextTexture(n.label, color);
                
                if (texRes) {
                    // Make groups smaller but visible
                    const scaleFactor = n.level === 2 ? 1.0 : 0.85;
                    const baseScale = 0.05 * scaleFactor; 
                    const size = new THREE.Vector2(baseScale * texRes.aspect, baseScale);
                    
                    const mat = createSmartMaterial({
                        uniforms: { 
                            uMap: { value: texRes.tex },
                            uSize: { value: size },
                            uAlpha: { value: 0.0 } 
                        },
                        vertexShaderBody: `
                            uniform vec2 uSize;
                            varying vec2 vUv;
                            void main() {
                                vUv = uv;
                                vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                                vec4 projected = smartProject(mvPos);
                                vec2 offset = position.xy * uSize;
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
                    const p = getPosition(n);
                    mesh.position.set(p.x, p.y, p.z);
                    mesh.scale.set(size.x, size.y, 1.0);
                    mesh.frustumCulled = false;
                    mesh.userData = { id: n.id };
                    
                    root.add(mesh);
                    dynamicLabels.push({ obj: mesh, node: n, initialScale: size.clone(), type: n.level === 2 ? 'book' : 'group' });
                }
            }
        }
        console.log(`[Engine] Found ${starCount} stars, ${groupLabelCount} group labels.`);

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

        // Populate Parent -> Star Indices Map (Deep)
        parentToStarIndices.clear();
        for (let i = 0; i < starIndexToId.length; i++) {
            const sid = starIndexToId[i];
            if (!sid) continue;
            const starNode = nodeById.get(sid);
            if (!starNode) continue;
            
            // Traverse up to find all ancestors
            let curr: SceneNode | undefined = starNode;
            while (curr && curr.parent) {
                const pid = curr.parent;
                if (!parentToStarIndices.has(pid)) parentToStarIndices.set(pid, []);
                parentToStarIndices.get(pid)!.push(i);
                curr = nodeById.get(pid);
            }
        }
        
        // Initial centroid update
        updateLabelCentroids();

        const linePoints: number[] = [];
        const bookMap = new Map<string, SceneNode[]>();
        for (const n of laidOut.nodes) {
            // Identify chapters by meta.chapter (regardless of level)
            if (n.meta?.chapter && n.parent) {
                const list = bookMap.get(n.parent) ?? [];
                list.push(n);
                bookMap.set(n.parent, list);
            }
        }
        console.log(`[Engine] Found ${bookMap.size} parents with chapters.`);
        
        for (const chapters of bookMap.values()) {
            chapters.sort((a, b) => ((a.meta?.chapter as number) || 0) - ((b.meta?.chapter as number) || 0));
            if (chapters.length < 2) continue;

            for (let i = 0; i < chapters.length - 1; i++) {
                const c1 = chapters[i]; const c2 = chapters[i+1];
                if (!c1 || !c2) continue;
                // No need for explicit groupIndex check here, as they are separated by parent (Group Node)
                const p1 = getPosition(c1); const p2 = getPosition(c2);
                
                // Track indices
                const idx1 = linePoints.length / 3;
                const idx2 = idx1 + 1;
                
                if (!starLineIndices.has(c1.id)) starLineIndices.set(c1.id, []);
                if (!starLineIndices.has(c2.id)) starLineIndices.set(c2.id, []);
                starLineIndices.get(c1.id)!.push(idx1);
                starLineIndices.get(c2.id)!.push(idx2);

                linePoints.push(p1.x, p1.y, p1.z); linePoints.push(p2.x, p2.y, p2.z);
            }
        }
        console.log(`[Engine] Generated ${linePoints.length / 6} line segments.`);
        if (linePoints.length > 0) {
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
            const lineMat = createSmartMaterial({
                uniforms: { color: { value: new THREE.Color(0x88ccff) } },
                vertexShaderBody: `uniform vec3 color; varying vec3 vColor; void main() { vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = smartProject(mvPosition); vScreenPos = gl_Position.xy / gl_Position.w; }`,
                fragmentShader: `varying vec3 vColor; void main() { float alphaMask = getMaskAlpha(); if (alphaMask < 0.01) discard; gl_FragColor = vec4(vColor, 0.6 * alphaMask); }`,
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
            const boundaryLines = new THREE.LineSegments(boundaryGeo, boundaryMat);
            boundaryLines.frustumCulled = false;
            root.add(boundaryLines);
        }
        resize();
        console.log("[Engine] buildFromModel completed successfully.");
        } catch (e) {
            console.error("[Engine] Error in buildFromModel:", e);
        }
    }

    let lastData: any = undefined;
    let lastAdapter: any = undefined;
    let lastModel: SceneModel | undefined = undefined;

    function setConfig(cfg: StarMapConfig) {
        currentConfig = cfg;
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
    }
    
    function setHandlers(next: Handlers) { handlers = next; }
    
    function getFullArrangement(): StarArrangement {
        const arr: StarArrangement = {};
        if (starPoints && starPoints.geometry.attributes.position) {
            const positions = starPoints.geometry.attributes.position.array;
            for (let i = 0; i < starIndexToId.length; i++) {
                const id = starIndexToId[i];
                if (id) {
                    const x = positions[i*3] ?? 0; const y = positions[i*3+1] ?? 0; const z = positions[i*3+2] ?? 0;
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                        arr[id] = { position: [x, y, z] };
                    }
                }
            }
        }
        for (const item of dynamicLabels) {
            arr[item.node.id] = { position: [item.obj.position.x, item.obj.position.y, item.obj.position.z] };
        }
        return arr;
    }

    function pick(ev: MouseEvent) {
        if (!starPoints) return undefined;

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
                    const parentId = hit.node.id;
                    const stars: { index: number, initialPos: THREE.Vector3 }[] = [];
                    const labels: { item: any, initialPos: THREE.Vector3 }[] = [];
                    
                    const isDescendant = (nodeId: string, ancestorId: string) => {
                        let curr = nodeById.get(nodeId);
                        while (curr && curr.parent) {
                            if (curr.parent === ancestorId) return true;
                            curr = nodeById.get(curr.parent);
                        }
                        return false;
                    };

                    if (starPoints && starPoints.geometry.attributes.position) {
                        const positions = starPoints.geometry.attributes.position.array;
                        for (let i = 0; i < starIndexToId.length; i++) {
                            const sid = starIndexToId[i];
                            if (sid && isDescendant(sid, parentId)) {
                                stars.push({ index: i, initialPos: new THREE.Vector3(positions[i*3], positions[i*3+1], positions[i*3+2]) });
                            }
                        }
                    }
                    
                    for (const item of dynamicLabels) {
                        if (item.node.id !== parentId && isDescendant(item.node.id, parentId)) {
                            labels.push({ item, initialPos: item.obj.position.clone() });
                        }
                    }

                    state.draggedGroup = { pivotInitialPos: hit.object!.position.clone(), stars, labels };
                    state.draggedStarIndex = -1;
                }
                return;
            }
            // In editable mode, if we didn't hit anything, don't start camera pan
            return;
        }
        state.dragMode = 'camera';
        state.isDragging = true;
        state.velocityX = 0; state.velocityY = 0;
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
             
             if (state.draggedStarIndex !== -1 && starPoints && newPos.lengthSq() > 0.1) {
                 const idx = state.draggedStarIndex;
                 const attr = starPoints.geometry.attributes.position as THREE.BufferAttribute;
                 attr.setXYZ(idx, newPos.x, newPos.y, newPos.z);
                 attr.needsUpdate = true;
                 
                 // Update lines for single star drag
                 const starId = starIndexToId[idx];
                 const lineAttr = constellationLines?.geometry.attributes.position as THREE.BufferAttribute | undefined;
                 if (starId && lineAttr && starLineIndices.has(starId)) {
                     const indices = starLineIndices.get(starId)!;
                     for (const lIdx of indices) {
                         lineAttr.setXYZ(lIdx, newPos.x, newPos.y, newPos.z);
                     }
                     lineAttr.needsUpdate = true;
                 }
             } 
             else if (state.draggedGroup && state.draggedNodeId) {
                 const group = state.draggedGroup;
                 const pivotItem = dynamicLabels.find(l => l.node.id === state.draggedNodeId);
                 if (pivotItem) pivotItem.obj.position.copy(newPos);
                 
                 // Rotate children based on World Vectors
                 // Safety Check: Ensure vectors are valid to avoid NaN
                 if (group.pivotInitialPos.lengthSq() > 0.1 && newPos.lengthSq() > 0.1) {
                     const vStart = group.pivotInitialPos.clone().normalize();
                     const vEnd = newPos.clone().normalize();
                     
                     // Only rotate if vectors are significantly different
                     if (vStart.distanceToSquared(vEnd) > 0.000001) {
                         const q = new THREE.Quaternion().setFromUnitVectors(vStart, vEnd);
                         
                         // Move Stars
                         if (starPoints && group.stars.length > 0) {
                             const attr = starPoints.geometry.attributes.position as THREE.BufferAttribute;
                             const lineAttr = constellationLines?.geometry.attributes.position as THREE.BufferAttribute | undefined;
                             const tempVec = new THREE.Vector3();
                             
                             for (const star of group.stars) {
                                 tempVec.copy(star.initialPos).applyQuaternion(q);
                                 attr.setXYZ(star.index, tempVec.x, tempVec.y, tempVec.z);
                                 
                                 // Update connected lines
                                 const starId = starIndexToId[star.index];
                                 if (starId && lineAttr && starLineIndices.has(starId)) {
                                     const indices = starLineIndices.get(starId)!;
                                     for (const lIdx of indices) {
                                         lineAttr.setXYZ(lIdx, tempVec.x, tempVec.y, tempVec.z);
                                     }
                                 }
                             }
                             attr.needsUpdate = true;
                             if (lineAttr) lineAttr.needsUpdate = true;
                         }

                         // Move Child Labels
                         const tempLabelVec = new THREE.Vector3();
                         for (const label of group.labels) {
                             tempLabelVec.copy(label.initialPos).applyQuaternion(q);
                             label.item.obj.position.copy(tempLabelVec);
                         }
                     }
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
            if (hit?.node.id !== (handlers as any)._lastHoverId) {
                (handlers as any)._lastHoverId = hit?.node.id;
                handlers.onHover?.(hit?.node);
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
            if (hit) handlers.onSelect?.(hit.node);
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
        
        if (!state.isDragging && isMouseInWindow && !currentConfig?.editable) {
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

        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        const objPos = new THREE.Vector3();
        const objDir = new THREE.Vector3();
        const SHOW_LABELS_FOV = 60;
        const SHOW_CHAPTERS_FOV = 25;

        // Continuously update centroids to handle dragged stars
        updateLabelCentroids();

        for (const item of dynamicLabels) {
            const uniforms = (item.obj.material as THREE.ShaderMaterial).uniforms as any;
            let targetAlpha = 0.0;
            const threshold = item.type === 'chapter' ? SHOW_CHAPTERS_FOV : SHOW_LABELS_FOV;
            
            if (state.fov < threshold) {
                item.obj.getWorldPosition(objPos);
                objDir.subVectors(objPos, camera.position).normalize();
                const dot = cameraDir.dot(objDir);
                // Chapters need stricter gaze or just distance?
                // Let's keep same gaze logic for now, maybe relax it for chapters so they all show up when zoomed in
                const fullVisibleDot = item.type === 'chapter' ? 0.8 : 0.95; 
                const invisibleDot = item.type === 'chapter' ? 0.6 : 0.85;
                
                let gazeOpacity = 0;
                if (dot >= fullVisibleDot) gazeOpacity = 1;
                else if (dot > invisibleDot) gazeOpacity = (dot - invisibleDot) / (fullVisibleDot - invisibleDot);
                
                const zoomFactor = 1.0 - THREE.MathUtils.smoothstep(threshold * 0.5, threshold, state.fov);
                targetAlpha = gazeOpacity * zoomFactor;
            }
            if (uniforms.uAlpha) {
                uniforms.uAlpha.value = THREE.MathUtils.lerp(uniforms.uAlpha.value, targetAlpha, 0.1);
                item.obj.visible = uniforms.uAlpha.value > 0.01;
            }
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
    function dispose() { stop(); renderer.dispose(); renderer.domElement.remove(); }

    return { setConfig, start, stop, dispose, setHandlers, getFullArrangement };
}
