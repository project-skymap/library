import * as THREE from "three";
import type { StarMapConfig, SceneModel, SceneNode, StarArrangement } from "../types";
import { computeLayoutPositions } from "./layout";
import { createSmartMaterial, globalUniforms } from "./materials";
import { ConstellationArtworkLayer } from "./ConstellationArtworkLayer";
import { PROJECTIONS, BlendedProjection } from "./projections";
import type { Projection, ProjectionId } from "./projections";
import { Fader } from "./fader";

// Haptic feedback helper
function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light') {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        const durations = { light: 10, medium: 25, heavy: 50 };
        navigator.vibrate(durations[style]);
    }
}

type Handlers = {
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
    onArrangementChange?: (arrangement: StarArrangement) => void;
    onFovChange?: (fov: number) => void;
    onLongPress?: (node: SceneNode | null, x: number, y: number) => void;
};

const ENGINE_CONFIG = {
    minFov: 1,
    maxFov: 135,
    defaultFov: 50,
    dragSpeed: 0.00125,
    inertiaDamping: 0.92,
    blendStart: 35,
    blendEnd: 83,
    zenithStartFov: 75,
    zenithStrength: 0.15,
    horizonLockStrength: 0.05,
    edgePanThreshold: 0.15,
    edgePanMaxSpeed: 0.02,
    edgePanDelay: 250,

    // Touch-specific
    touchInertiaDamping: 0.85,   // Snappier than mouse (0.92)
    tapMaxDuration: 300,         // ms
    tapMaxDistance: 10,          // px
    doubleTapMaxDelay: 300,      // ms between taps
    doubleTapMaxDistance: 30,    // px between tap locations
    longPressDelay: 500,         // ms to trigger long-press
};

const ORDER_REVEAL_CONFIG = {
    globalDim: 0.85,
    pulseAmplitude: 0.6,
    pulseDuration: 2,
    delayPerChapter: 0.1
};

export function createEngine({
                                 container,
                                 onSelect,
                                 onHover,
                                 onArrangementChange,
                                 onFovChange,
                                 onLongPress,
                             }: {
    container: HTMLDivElement;
    onSelect?: Handlers["onSelect"];
    onHover?: Handlers["onHover"];
    onArrangementChange?: Handlers["onArrangementChange"];
    onFovChange?: Handlers["onFovChange"];
    onLongPress?: Handlers["onLongPress"];
}) {
    // ---------------------------
    // Interaction State
    // ---------------------------
    let hoveredBookId: string | null = null;
    let focusedBookId: string | null = null;
    let orderRevealEnabled = true;
    let activeBookIndex = -1;
    let orderRevealStrength = 0.0; // Animated 0 -> 1

    // Fly-to animation state
    let flyToActive = false;
    let flyToTargetLon = 0;
    let flyToTargetLat = 0;
    let flyToTargetFov = ENGINE_CONFIG.minFov;
    const FLY_TO_SPEED = 0.04; // lerp factor per frame

    // Hierarchy filter state
    let currentFilter: import("../types").HierarchyFilter | null = null;
    let filterStrength = 0.0; // Animated 0 -> 1
    let filterTestamentIndex = -1.0;
    let filterDivisionIndex = -1.0;
    let filterBookIndex = -1.0;
    
    // Cooldown management
    const hoverCooldowns = new Map<string, number>();
    const COOLDOWN_MS = 2000;
    
    // Map Book ID (string) to shader-friendly index (float)
    const bookIdToIndex = new Map<string, number>();
    const testamentToIndex = new Map<string, number>();
    const divisionToIndex = new Map<string, number>();

    // ---------------------------
    // Renderer / Scene / Camera
    // ---------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000); // Increased far plane to 10000
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    
    // ... (Engine State) ...

    // ... (Helpers, etc.) ...

    // ... (bottom of file) ...
    
    function setHoveredBook(id: string | null) {
        if (id === hoveredBookId) return;
        
        const now = performance.now();
        
        // If we are LEAVING a book, record timestamp
        if (hoveredBookId) {
            hoverCooldowns.set(hoveredBookId, now);
        }
        
        // If we are ENTERING a book, check cooldown
        // However, if we just left IT, we shouldn't trigger if < cooldown
        if (id) {
             const lastExit = hoverCooldowns.get(id) || 0;
             if (now - lastExit < COOLDOWN_MS) {
                 // Cooldown active, don't set as hovered for visual purposes yet
                 // But we still track it internally? 
                 // If we suppress it here, `hoveredBookId` remains null, so no effect shows.
                 // But if the user *stays* hovered, it will never trigger because setHoveredBook won't be called again.
                 // We need to allow it to trigger *eventually* if they stay hovered.
                 // So we set `hoveredBookId` but use a separate logic for "visual activation"?
                 // Or we accept that rapid re-entry is suppressed.
                 // If the user stays hovered, `tick` will see `hoveredBookId` is set.
                 // We need a way to say "visuals are suppressed until X".
                 // Let's add `visualSuppressionUntil: number` to state.
                 // Actually, simpler:
                 // If suppressed, don't set hoveredBookId? No, then if they stay, it never shows.
                 // We should set it, but in `tick`, check cooldown?
             }
        }
        
        hoveredBookId = id; 
    }
    
    // Actually, I need to modify `tick` to respect the cooldown, because `setHoveredBook` is only called on change.
    // If I set `hoveredBookId` immediately, but `tick` checks cooldown, `tick` runs every frame.
    // If `tick` sees `hoveredBookId` is set, and `now < cooldownEnd`, it keeps strength at 0.
    // Once `now > cooldownEnd`, it ramps up.
    // This supports "hover... wait... trigger".
    
    // Let's revert the complex `setHoveredBook` logic and just do state tracking there,
    // then put the check in `tick`.
    
    // Wait, I can't modify `tick` easily without replacing the whole function or a large chunk.
    // Let's see `tick` again.


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
        tempArrangement: {} as StarArrangement,

        // Touch state
        touchCount: 0,
        touchStartTime: 0,
        touchStartX: 0,
        touchStartY: 0,
        touchMoved: false,
        pinchStartDistance: 0,
        pinchStartFov: ENGINE_CONFIG.defaultFov,
        pinchCenterX: 0,
        pinchCenterY: 0,

        // Double-tap detection
        lastTapTime: 0,
        lastTapX: 0,
        lastTapY: 0,

        // Long-press detection
        longPressTimer: null as ReturnType<typeof setTimeout> | null,
        longPressTriggered: false,
    };

    const mouseNDC = new THREE.Vector2();
    let isMouseInWindow = false;
    let isTouchDevice = false;  // Set true on first touch
    let edgeHoverStart = 0;

    let handlers: Handlers = { onSelect, onHover, onArrangementChange, onFovChange, onLongPress };
    let currentConfig: StarMapConfig | undefined;
    
    // ---------------------------
    // Constellation Artwork Layer
    // ---------------------------
    const constellationLayer = new ConstellationArtworkLayer(scene);

    // ---------------------------
    // Helpers
    // ---------------------------
    function mix(a: number, b: number, t: number) { return a * (1 - t) + b * t; }

    // --- Projection system ---
    let currentProjection: Projection = new BlendedProjection(ENGINE_CONFIG.blendStart, ENGINE_CONFIG.blendEnd);

    function syncProjectionState() {
        if (currentProjection instanceof BlendedProjection) {
            currentProjection.setFov(state.fov);
            globalUniforms.uBlend.value = currentProjection.getBlend();
        }
        globalUniforms.uProjectionType.value = currentProjection.glslProjectionType;
    }

    function updateUniforms() {
        syncProjectionState();
        const fovRad = state.fov * Math.PI / 180.0;
        let scale = currentProjection.getScale(fovRad);
        const aspect = camera.aspect;

        if (currentConfig?.fitProjection) {
            // The shader does: projected.x /= uAspect
            // - Landscape (aspect > 1): x is shrunk by shader, y is limiting → divide by aspect
            // - Portrait (aspect < 1): x is EXPANDED by shader (divide by <1), x is limiting
            //   Need extra shrink to compensate: multiply by aspect²
            //   (aspect cancels the shader's 1/aspect, then aspect again to fit width)
            if (aspect >= 1.0) {
                scale /= aspect;
            } else {
                scale *= aspect * aspect;
            }
        }

        globalUniforms.uScale.value = scale;
        globalUniforms.uAspect.value = aspect;

        camera.fov = Math.min(state.fov, ENGINE_CONFIG.defaultFov);
        camera.updateProjectionMatrix();
    }

    function getMouseViewVector(fovDeg: number, aspectRatio: number) {
        syncProjectionState();
        const fovRad = fovDeg * Math.PI / 180;
        const uvX = mouseNDC.x * aspectRatio;
        const uvY = mouseNDC.y;
        const v = currentProjection.inverse(uvX, uvY, fovRad);
        return new THREE.Vector3(v.x, v.y, v.z).normalize();
    }

    function getMouseWorldVector(pixelX: number, pixelY: number, width: number, height: number) {
        const aspect = width / height;
        const ndcX = (pixelX / width) * 2 - 1;
        const ndcY = -(pixelY / height) * 2 + 1;
        syncProjectionState();
        const fovRad = state.fov * Math.PI / 180;
        const v = currentProjection.inverse(ndcX * aspect, ndcY, fovRad);
        const vView = new THREE.Vector3(v.x, v.y, v.z).normalize();
        return vView.applyQuaternion(camera.quaternion);
    }

    function smartProjectJS(worldPos: THREE.Vector3) {
        const viewPos = worldPos.clone().applyMatrix4(camera.matrixWorldInverse);
        const dir = viewPos.clone().normalize();
        const result = currentProjection.forward(dir);
        if (!result) return { x: 0, y: 0, z: dir.z };
        return result;
    }

    // ---------------------------
    // Environment
    // ---------------------------
    const groundGroup = new THREE.Group();
    scene.add(groundGroup);
    
    function createGround() {
        groundGroup.clear();
        // Extend slightly above equator (PI/2 - 0.15) to allow for mountains
        const radius = 995;
        const geometry = new THREE.SphereGeometry(radius, 128, 64, 0, Math.PI * 2, Math.PI / 2 - 0.15, Math.PI / 2 + 0.15);
        
        const material = createSmartMaterial({
            uniforms: {
                color: { value: new THREE.Color(0x010102) },
                fogColor: { value: new THREE.Color(0x0a1e3a) }
            },
            vertexShaderBody: `
                varying vec3 vPos; 
                varying vec3 vWorldPos;
                void main() { 
                    vPos = position; 
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); 
                    gl_Position = smartProject(mvPosition); 
                    vScreenPos = gl_Position.xy / gl_Position.w; 
                    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                }
            `,
            fragmentShader: `
                uniform vec3 color; 
                uniform vec3 fogColor;
                varying vec3 vPos; 
                varying vec3 vWorldPos;
                
                void main() { 
                    float alphaMask = getMaskAlpha(); 
                    if (alphaMask < 0.01) discard; 
                    
                    // Procedural Horizon (Mountains)
                    float angle = atan(vPos.z, vPos.x);
                    
                    // FBM-like terrain with increased amplitude
                    float h = 0.0;
                    h += sin(angle * 6.0) * 35.0;
                    h += sin(angle * 13.0 + 1.0) * 18.0;
                    h += sin(angle * 29.0 + 2.0) * 8.0;
                    h += sin(angle * 63.0 + 4.0) * 3.0;
                    h += sin(angle * 97.0 + 5.0) * 1.5;

                    float terrainHeight = h + 12.0;

                    if (vPos.y > terrainHeight) discard;

                    // Atmospheric rim glow just below terrain peaks
                    float rimDist = terrainHeight - vPos.y;
                    float rim = exp(-rimDist * 0.15) * 0.4;
                    vec3 rimColor = fogColor * 1.5;

                    // Atmospheric haze — stronger near horizon
                    float fogFactor = smoothstep(-120.0, terrainHeight, vPos.y);
                    vec3 finalCol = mix(color, fogColor, fogFactor * 0.6);

                    // Add rim glow near terrain peaks
                    finalCol += rimColor * rim;

                    gl_FragColor = vec4(finalCol, 1.0); 
                }
            `,
            side: THREE.BackSide, 
            transparent: false, 
            depthWrite: true, 
            depthTest: true
        });
        const ground = new THREE.Mesh(geometry, material);
        groundGroup.add(ground);
    }
    
        let atmosphereMesh: THREE.Mesh | null = null;

    function createAtmosphere() {
        const geometry = new THREE.SphereGeometry(990, 64, 64);
        
        // Inverted sphere (BackSide) so we see it from inside
        const material = createSmartMaterial({
            vertexShaderBody: `
                varying vec3 vWorldNormal;
                void main() { 
                    vWorldNormal = normalize(position);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0); 
                    gl_Position = smartProject(mv); 
                    vScreenPos = gl_Position.xy / gl_Position.w;
                }`,
            fragmentShader: `
                varying vec3 vWorldNormal;
                
                uniform float uAtmGlow;
                uniform float uAtmDark;
                uniform vec3 uColorHorizon;
                uniform vec3 uColorZenith;
                
                void main() {
                    float alphaMask = getMaskAlpha();
                    if (alphaMask < 0.01) discard;

                    // Altitude angle (Y is up)
                    float h = normalize(vWorldNormal).y;

                    // 1. Base gradient from Horizon to Zenith (wider range)
                    float t = smoothstep(-0.15, 0.7, h);

                    // Non-linear mix for realistic sky falloff
                    vec3 skyColor = mix(uColorHorizon * uAtmGlow, uColorZenith * (1.0 - uAtmDark), pow(t, 0.6));

                    // 2. Teal tint at mid-altitudes (subtle colour variation)
                    float midBand = exp(-6.0 * pow(h - 0.3, 2.0));
                    skyColor += vec3(0.05, 0.12, 0.15) * midBand * uAtmGlow;

                    // 3. Primary horizon glow band (wider than before)
                    float horizonBand = exp(-10.0 * abs(h - 0.02));
                    skyColor += uColorHorizon * horizonBand * 0.5 * uAtmGlow;

                    // 4. Warm secondary glow (light pollution / sodium scatter)
                    float warmGlow = exp(-8.0 * abs(h));
                    skyColor += vec3(0.4, 0.25, 0.15) * warmGlow * 0.3 * uAtmGlow;

                    gl_FragColor = vec4(skyColor, 1.0);
                }
            `,
            side: THREE.BackSide, depthWrite: false, depthTest: true
        });
        const atm = new THREE.Mesh(geometry, material);
        atmosphereMesh = atm;
        groundGroup.add(atm);
    }
    
    const backdropGroup = new THREE.Group();
    scene.add(backdropGroup);
    
    function createBackdropStars(count: number = 31000) {
        backdropGroup.clear();
        // Clear any existing children properly
        while(backdropGroup.children.length > 0){ 
            const c = backdropGroup.children[0];
            backdropGroup.remove(c);
            if((c as any).geometry) (c as any).geometry.dispose();
            if((c as any).material) (c as any).material.dispose();
        }

        const geometry = new THREE.BufferGeometry();
        const positions: number[] = [];
        const sizes: number[] = [];
        const colors: number[] = [];
        
        const r = 2500;
        
        for (let i = 0; i < count; i++) {
            // Purely uniform spherical distribution
            const u = Math.random();
            const v = Math.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);

            const x = r * Math.sin(phi) * Math.cos(theta);
            const y = r * Math.cos(phi);
            const z = r * Math.sin(phi) * Math.sin(theta);

            positions.push(x, y, z);

            // Log-normal distribution for size variation
            const size = 1.0 + (-Math.log(Math.random()) * 0.8) * 1.5;
            sizes.push(size);

            // Spectral colour from random temperature (Stellarium B-V inspired)
            const temp = Math.random();
            let cr, cg, cb;
            if (temp < 0.15) {
                // Hot stars: blue-white (O/B type)
                cr = 0.7 + temp * 2; cg = 0.8 + temp; cb = 1.0;
            } else if (temp < 0.6) {
                // Mid stars: white to yellow-white (A/F/G type)
                const t = (temp - 0.15) / 0.45;
                cr = 1.0; cg = 1.0 - t * 0.1; cb = 1.0 - t * 0.3;
            } else {
                // Cool stars: orange to red (K/M type)
                const t = (temp - 0.6) / 0.4;
                cr = 1.0; cg = 0.85 - t * 0.35; cb = 0.7 - t * 0.35;
            }
            colors.push(cr, cg, cb);
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = createSmartMaterial({
            uniforms: {
                pixelRatio: { value: renderer.getPixelRatio() },
                uScale: globalUniforms.uScale,
                uTime: globalUniforms.uTime
            },
            vertexShaderBody: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                uniform float pixelRatio;

                uniform float uAtmExtinction;
                uniform float uAtmTwinkle;
                uniform float uTime;

                void main() {
                    vec3 nPos = normalize(position);
                    float altitude = nPos.y;

                    // Extinction & Horizon Fade
                    float horizonFade = smoothstep(-0.1, 0.1, altitude);
                    float airmass = 1.0 / (max(0.05, altitude + 0.05));
                    float extinction = exp(-uAtmExtinction * 0.15 * airmass);

                    // Scintillation (twinkling) — stronger near horizon
                    float turbulence = 1.0 + (1.0 - smoothstep(0.0, 1.0, altitude)) * 2.0;
                    float twinkle = sin(uTime * 3.0 + position.x * 0.05 + position.z * 0.03) * 0.5 + 0.5;
                    float scintillation = mix(1.0, twinkle * 2.0, uAtmTwinkle * 0.4 * turbulence);

                    vColor = color * 3.0 * extinction * horizonFade * scintillation;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = smartProject(mvPosition);
                    vScreenPos = gl_Position.xy / gl_Position.w;

                    float zoomScale = pow(uScale, 0.5);
                    float perceptualSize = pow(size, 0.55);
                    gl_PointSize = clamp(perceptualSize * zoomScale * 0.5 * pixelRatio * (800.0 / -mvPosition.z) * horizonFade, 0.5, 20.0);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    vec2 coord = gl_PointCoord - vec2(0.5);
                    float d = length(coord) * 2.0;
                    if (d > 1.0) discard;
                    float alphaMask = getMaskAlpha();
                    if (alphaMask < 0.01) discard;

                    // Stellarium-style: sharp core + soft glow
                    float core = smoothstep(0.8, 0.4, d);
                    float glow = smoothstep(1.0, 0.0, d) * 0.08;
                    float k = core + glow;

                    vec3 finalColor = mix(vColor, vec3(1.0), core * 0.5);
                    gl_FragColor = vec4(finalColor * k * alphaMask, 1.0);
                }
            `,
            transparent: true, 
            depthWrite: false, 
            depthTest: true,
            blending: THREE.AdditiveBlending 
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

    let constellationLines: THREE.Mesh | THREE.LineSegments | null = null;
    let boundaryLines: THREE.LineSegments | null = null;
    let starPoints: THREE.Points | null = null;

    // Faders for smooth visibility transitions (Stellarium-style)
    const linesFader = new Fader(0.4);
    const artFader = new Fader(0.5);
    let lastTickTime = 0;

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
        // Lighter weight (400) for cleaner look
        const font = `400 ${fontSize}px "Inter", system-ui, sans-serif`;
        ctx.font = font;
        const metrics = ctx.measureText(text);
        const w = Math.ceil(metrics.width);
        const h = Math.ceil(fontSize * 1.2);
        canvas.width = w;
        canvas.height = h;
        ctx.font = font;
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
        bookIdToIndex.clear();
        testamentToIndex.clear();
        divisionToIndex.clear();
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
        const starPhases: number[] = [];
        const starBookIndices: number[] = [];
        const starChapterIndices: number[] = [];
        const starTestamentIndices: number[] = [];
        const starDivisionIndices: number[] = [];
        
        // Realistic Star Colors (High Brightness/Whiteness for Stellarium Look)
        const SPECTRAL_COLORS = [
            new THREE.Color(0xddeeff), // O - Blueish White
            new THREE.Color(0xeef4ff), // B - White
            new THREE.Color(0xf8fcff), // A - White
            new THREE.Color(0xfffff8), // F - White
            new THREE.Color(0xfff8ee), // G - Yellowish White
            new THREE.Color(0xffefdd), // K - Pale Orange
            new THREE.Color(0xffeacc)  // M - Light Orange
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
                    // Non-linear scaling (square root) to boost smaller chapters
                    // Range: 0.1 to 12.0
                    baseSize = 0.1 + Math.pow(t, 0.5) * 11.9;
                }
                starSizes.push(baseSize);
                
                // Assign weighted random spectral color
                // Bias towards cooler stars (index higher) using pow(r, 1.5)
                const colorIdx = Math.floor(Math.pow(Math.random(), 1.5) * SPECTRAL_COLORS.length);
                const c = SPECTRAL_COLORS[Math.min(colorIdx, SPECTRAL_COLORS.length - 1)]!;
                starColors.push(c.r, c.g, c.b);

                // Random phase for twinkling
                starPhases.push(Math.random() * Math.PI * 2);

                // Book & Chapter Indices for Interaction
                let bIdx = -1.0;
                if (n.parent) {
                    if (!bookIdToIndex.has(n.parent)) {
                         bookIdToIndex.set(n.parent, bookIdToIndex.size + 1.0); 
                    }
                    bIdx = bookIdToIndex.get(n.parent)!;
                }
                starBookIndices.push(bIdx);
                
                let cIdx = 0;
                if (n.meta?.chapter) cIdx = Number(n.meta.chapter);
                starChapterIndices.push(cIdx);

                // Testament & Division indices for hierarchy filtering
                let tIdx = -1.0;
                if (n.meta?.testament) {
                    const tName = n.meta.testament as string;
                    if (!testamentToIndex.has(tName)) {
                        testamentToIndex.set(tName, testamentToIndex.size + 1.0);
                    }
                    tIdx = testamentToIndex.get(tName)!;
                }
                starTestamentIndices.push(tIdx);

                let dIdx = -1.0;
                if (n.meta?.division) {
                    const dName = n.meta.division as string;
                    if (!divisionToIndex.has(dName)) {
                        divisionToIndex.set(dName, divisionToIndex.size + 1.0);
                    }
                    dIdx = divisionToIndex.get(dName)!;
                }
                starDivisionIndices.push(dIdx);
            }
            

            // 2. Process Labels (Level 1, 2, 3)
            if (n.level === 1 || n.level === 2 || n.level === 3) {
                let color = "#ffffff";
                if (n.level === 1) color = "#38bdf8"; // Divisions: Sky Blue
                else if (n.level === 2) {
                    const bookKey = n.meta?.bookKey as string | undefined;
                    color = (bookKey && cfg.labelColors?.[bookKey]) || "#cbd5e1";
                }
                else if (n.level === 3) color = "#94a3b8"; // Chapters: Slate 400 (Grey)
                
                let labelText = n.label;
                if (n.level === 3 && n.meta?.chapter) {
                    labelText = String(n.meta.chapter);
                }
                
                const texRes = createTextTexture(labelText, color);
                
                if (texRes) {
                    let baseScale = 0.05;
                    if (n.level === 1) baseScale = 0.08;
                    else if (n.level === 2) baseScale = 0.04; // Books: Decreased from 0.06
                    else if (n.level === 3) baseScale = 0.03; // Chapters: Small
                    
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
                        p.y += 30; // Lifted higher
                        p.multiplyScalar(1.001);
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
        starGeo.setAttribute('phase', new THREE.Float32BufferAttribute(starPhases, 1));
        starGeo.setAttribute('bookIndex', new THREE.Float32BufferAttribute(starBookIndices, 1));
        starGeo.setAttribute('chapterIndex', new THREE.Float32BufferAttribute(starChapterIndices, 1));
        starGeo.setAttribute('testamentIndex', new THREE.Float32BufferAttribute(starTestamentIndices, 1));
        starGeo.setAttribute('divisionIndex', new THREE.Float32BufferAttribute(starDivisionIndices, 1));

        const starMat = createSmartMaterial({
            uniforms: { 
                pixelRatio: { value: renderer.getPixelRatio() },
                uScale: globalUniforms.uScale,
                uTime: globalUniforms.uTime,
                uActiveBookIndex: { value: -1.0 },
                uOrderRevealStrength: { value: 0.0 },
                uGlobalDimFactor: { value: ORDER_REVEAL_CONFIG.globalDim },
                uPulseParams: { value: new THREE.Vector3(
                    ORDER_REVEAL_CONFIG.pulseDuration,
                    ORDER_REVEAL_CONFIG.delayPerChapter,
                    ORDER_REVEAL_CONFIG.pulseAmplitude
                )},
                uFilterTestamentIndex: { value: -1.0 },
                uFilterDivisionIndex: { value: -1.0 },
                uFilterBookIndex: { value: -1.0 },
                uFilterStrength: { value: 0.0 },
                uFilterDimFactor: { value: 0.08 }
            },
            vertexShaderBody: `
                attribute float size; 
                attribute vec3 color; 
                attribute float phase;
                attribute float bookIndex;
                attribute float chapterIndex;
                attribute float testamentIndex;
                attribute float divisionIndex;

                varying vec3 vColor;
                uniform float pixelRatio;

                uniform float uTime;
                uniform float uAtmExtinction;
                uniform float uAtmTwinkle;

                uniform float uActiveBookIndex;
                uniform float uOrderRevealStrength;
                uniform float uGlobalDimFactor;
                uniform vec3 uPulseParams;

                uniform float uFilterTestamentIndex;
                uniform float uFilterDivisionIndex;
                uniform float uFilterBookIndex;
                uniform float uFilterStrength;
                uniform float uFilterDimFactor;

                void main() { 
                    vec3 nPos = normalize(position);
                    
                    // 1. Altitude (Y is UP)
                    float altitude = nPos.y; 
                    
                    // 2. Atmospheric Extinction (Airmass approximation)
                    float airmass = 1.0 / (max(0.02, altitude + 0.05));
                    float extinction = exp(-uAtmExtinction * 0.1 * airmass);
                    
                    // Fade out stars below horizon
                    float horizonFade = smoothstep(-0.1, 0.05, altitude);
                    
                    // 3. Scintillation
                    float turbulence = 1.0 + (1.0 - smoothstep(0.0, 1.0, altitude)) * 2.0;
                    float twinkle = sin(uTime * 3.0 + phase + position.x * 0.01) * 0.5 + 0.5; 
                    float scintillation = mix(1.0, twinkle * 2.0, uAtmTwinkle * 0.5 * turbulence);
                    
                    // --- Order Reveal Logic ---
                    float isTarget = 1.0 - min(1.0, abs(bookIndex - uActiveBookIndex));
                    
                    // Dimming
                    float dimFactor = mix(1.0, uGlobalDimFactor, uOrderRevealStrength * (1.0 - isTarget));
                    
                    // Pulse
                    float delay = chapterIndex * uPulseParams.y;
                    float cycleDuration = uPulseParams.x * 2.5; 
                    float t = mod(uTime - delay, cycleDuration);
                    
                    float pulse = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.4, uPulseParams.x, t));
                    pulse = max(0.0, pulse);
                    
                    float activePulse = pulse * uPulseParams.z * isTarget * uOrderRevealStrength;

                    // --- Hierarchy Filter ---
                    float filtered = 0.0;
                    if (uFilterTestamentIndex >= 0.0) {
                        filtered = 1.0 - step(0.5, 1.0 - abs(testamentIndex - uFilterTestamentIndex));
                    }
                    if (uFilterDivisionIndex >= 0.0 && filtered < 0.5) {
                        filtered = 1.0 - step(0.5, 1.0 - abs(divisionIndex - uFilterDivisionIndex));
                    }
                    if (uFilterBookIndex >= 0.0 && filtered < 0.5) {
                        filtered = 1.0 - step(0.5, 1.0 - abs(bookIndex - uFilterBookIndex));
                    }
                    float filterDim = mix(1.0, uFilterDimFactor, uFilterStrength * filtered);

                    vec3 baseColor = color * extinction * horizonFade * scintillation;
                    vColor = baseColor * dimFactor * filterDim;
                    vColor += vec3(1.0, 0.8, 0.4) * activePulse;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); 
                    gl_Position = smartProject(mvPosition); 
                    vScreenPos = gl_Position.xy / gl_Position.w; 
                    
                    float sizeBoost = 1.0 + activePulse * 0.8;
                    float perceptualSize = pow(size, 0.55);
                    gl_PointSize = clamp((perceptualSize * sizeBoost * 1.5) * uScale * pixelRatio * (2000.0 / -mvPosition.z) * horizonFade, 1.0, 40.0); 
                }
            `,
            fragmentShader: `
                varying vec3 vColor; 
                void main() { 
                    vec2 coord = gl_PointCoord - vec2(0.5); 
                    float d = length(coord) * 2.0; 
                    if (d > 1.0) discard; 
                    
                    float alphaMask = getMaskAlpha(); 
                    if (alphaMask < 0.01) discard; 
                    
                    // Stellarium-style dual-layer: sharp core + soft glow
                    float core = smoothstep(0.8, 0.4, d);
                    float glow = smoothstep(1.0, 0.0, d) * 0.08;
                    float k = core + glow;

                    // White-hot core blending into coloured halo
                    vec3 finalColor = mix(vColor, vec3(1.0), core * 0.7);
                    gl_FragColor = vec4(finalColor * k * alphaMask, 1.0); 
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending
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
            // Build quad-strip mesh for glowing lines (Stellarium-style)
            const quadPositions: number[] = [];
            const quadUvs: number[] = [];
            const quadIndices: number[] = [];
            const lineWidth = 8.0; // world-space half-width for glow region

            for (let i = 0; i < linePoints.length; i += 6) {
                const ax = linePoints[i], ay = linePoints[i+1], az = linePoints[i+2];
                const bx = linePoints[i+3], by = linePoints[i+4], bz = linePoints[i+5];

                // Direction and perpendicular in 3D
                const dx = bx - ax, dy = by - ay, dz = bz - az;
                const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (len < 0.001) continue;

                // Cross with up vector to get perpendicular
                let px = dy * 0 - dz * 1, py = dz * 0 - dx * 0, pz = dx * 1 - dy * 0;
                // If nearly parallel to up, use right vector
                const pLen = Math.sqrt(px*px + py*py + pz*pz);
                if (pLen < 0.001) { px = 1; py = 0; pz = 0; }
                else { px /= pLen; py /= pLen; pz /= pLen; }

                const hw = lineWidth;
                const baseIdx = quadPositions.length / 3;

                // 4 vertices: A-left, A-right, B-left, B-right
                quadPositions.push(ax - px*hw, ay - py*hw, az - pz*hw); quadUvs.push(0, -1);
                quadPositions.push(ax + px*hw, ay + py*hw, az + pz*hw); quadUvs.push(0, 1);
                quadPositions.push(bx - px*hw, by - py*hw, bz - pz*hw); quadUvs.push(1, -1);
                quadPositions.push(bx + px*hw, by + py*hw, bz + pz*hw); quadUvs.push(1, 1);

                quadIndices.push(baseIdx, baseIdx+1, baseIdx+2, baseIdx+1, baseIdx+3, baseIdx+2);
            }

            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(quadPositions, 3));
            lineGeo.setAttribute('lineUv', new THREE.Float32BufferAttribute(quadUvs, 2));
            lineGeo.setIndex(quadIndices);

            const lineMat = createSmartMaterial({
                uniforms: {
                    color: { value: new THREE.Color(0xaaccff) },
                    uLineWidth: { value: 1.5 },
                    uGlowIntensity: { value: 0.3 }
                },
                vertexShaderBody: `
                    attribute vec2 lineUv;
                    varying vec2 vLineUv;
                    void main() {
                        vLineUv = lineUv;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_Position = smartProject(mvPosition);
                        vScreenPos = gl_Position.xy / gl_Position.w;
                    }
                `,
                fragmentShader: `
                    uniform vec3 color;
                    uniform float uLineWidth;
                    uniform float uGlowIntensity;
                    varying vec2 vLineUv;
                    void main() {
                        float alphaMask = getMaskAlpha();
                        if (alphaMask < 0.01) discard;

                        float dist = abs(vLineUv.y);

                        // Anti-aliased core line
                        float hw = uLineWidth * 0.05;
                        float base = smoothstep(hw + 0.08, hw - 0.08, dist);

                        // Soft glow extending outward
                        float glow = (1.0 - dist) * uGlowIntensity;

                        float alpha = max(glow, base);
                        if (alpha < 0.005) discard;

                        gl_FragColor = vec4(color, alpha * alphaMask);
                    }
                `,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });
            constellationLines = new THREE.Mesh(lineGeo, lineMat);
            constellationLines.frustumCulled = false;
            root.add(constellationLines);
        }

        // --- Group Labels (Level 2.5) ---
        if (cfg.groups) {
            for (const [bookId, chapters] of bookMap.entries()) {
                const bookNode = nodeById.get(bookId);
                if (!bookNode) continue;
                
                // Match key: Use meta.book if available (e.g. "Genesis") otherwise label
                const bookName = (bookNode.meta?.book as string) || bookNode.label;
                const groupList = cfg.groups[bookName.toLowerCase()];
                
                if (groupList) {
                    groupList.forEach((g, idx) => {
                        const groupId = `G:${bookId}:${idx}`;
                        
                        // 1. Calculate Position
                        let p = new THREE.Vector3();
                        let count = 0;
                        
                        // Check Arrangement First
                        if (cfg.arrangement && cfg.arrangement[groupId]) {
                            const arr = cfg.arrangement[groupId];
                            p.set(arr.position[0], arr.position[1], arr.position[2]);
                        } else {
                            // Calculate Centroid
                            const relevantChapters = chapters.filter(c => {
                                const ch = c.meta?.chapter as number;
                                return ch >= g.start && ch <= g.end;
                            });
                            
                            if (relevantChapters.length === 0) return;
                            
                            for (const c of relevantChapters) {
                                p.add(getPosition(c));
                            }
                            p.divideScalar(relevantChapters.length);
                            
                            // Push slightly outward/upward to float?
                            // p.multiplyScalar(1.02);
                        }

                        // 2. Create Label
                        const labelText = `${g.name} (${g.start}-${g.end})`;
                        const texRes = createTextTexture(labelText, "#4fa4fa80"); // Requested bright green
                        
                        if (texRes) {
                            // Scale: 0.036 (approx 90% of Book Label scale 0.04)
                            const baseScale = 0.036;
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
                            mesh.position.copy(p);
                            mesh.scale.set(size.x, size.y, 1.0);
                            mesh.frustumCulled = false;
                            mesh.userData = { id: groupId };
                            
                            root.add(mesh);
                            
                            // Fake Node
                            const node: SceneNode = {
                                id: groupId,
                                label: labelText,
                                level: 2.5, // Special Level
                                parent: bookId
                            };
                            
                            dynamicLabels.push({ obj: mesh, node, initialScale: size.clone() });
                        }
                    });
                }
            }
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
    let lastBackdropCount: number | undefined = undefined;

    function setProjection(id: ProjectionId | string) {
        if (id === 'blended') {
            currentProjection = new BlendedProjection(ENGINE_CONFIG.blendStart, ENGINE_CONFIG.blendEnd);
        } else {
            const factory = PROJECTIONS[id as ProjectionId];
            if (!factory) return;
            currentProjection = factory();
        }
        updateUniforms();
    }

    function setConfig(cfg: StarMapConfig) {
        currentConfig = cfg;

        // Update projection if provided
        if (cfg.projection) setProjection(cfg.projection);

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

        // Rebuild Backdrop Stars if count changed
        const desiredBackdropCount = typeof cfg.backdropStarsCount === 'number' ? cfg.backdropStarsCount : 4000;
        if (lastBackdropCount !== desiredBackdropCount) {
            createBackdropStars(desiredBackdropCount);
            lastBackdropCount = desiredBackdropCount;
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
                // 1. Check Arrangement (Override)
                if (cfg.arrangement && cfg.arrangement[id]) {
                    const arr = cfg.arrangement[id];
                    // If it's a 2D arrangement, project it (same logic as getPosition)
                    if (arr.position[2] === 0) {
                        const x = arr.position[0];
                        const y = arr.position[1];
                        const radius = cfg.layout?.radius ?? 2000;
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
                
                // 2. Check Scene Nodes (Stars/Anchors)
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
            // Skip Level 3 (Chapters) labels, as their position is derived from the Star position (plus offset).
            // We want the Arrangement to store the Star position, which is captured in the loop above.
            if (item.node.level === 3) continue;
            
            arr[item.node.id] = { position: [item.obj.position.x, item.obj.position.y, item.obj.position.z] };
        }
        
        // Add Constellations
        for (const item of constellationLayer.getItems()) {
            arr[item.config.id] = { position: [item.mesh.position.x, item.mesh.position.y, item.mesh.position.z] };
        }
        
        // Merge temp arrangement to ensure dragged items are up to date
        Object.assign(arr, state.tempArrangement);
        
        return arr;
    }

    function isNodeFiltered(node: SceneNode): boolean {
        if (!currentFilter) return false;
        const meta = node.meta as Record<string, unknown> | undefined;
        if (!meta) return false;
        if (currentFilter.testament && meta.testament !== currentFilter.testament) return true;
        if (currentFilter.division && meta.division !== currentFilter.division) return true;
        if (currentFilter.bookKey && meta.bookKey !== currentFilter.bookKey) return true;
        return false;
    }

    function pick(ev: MouseEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        const mX = ev.clientX - rect.left;
        const mY = ev.clientY - rect.top;
        
        // Update Global NDC for other uses
        mouseNDC.x = (mX / rect.width) * 2 - 1;
        mouseNDC.y = -(mY / rect.height) * 2 + 1;

        const uScale = globalUniforms.uScale.value;
        const uAspect = camera.aspect;
        const w = rect.width; 
        const h = rect.height;

        // 1. Pick Labels (Highest Priority - Foreground UI)
        let closestLabel = null;
        const LABEL_THRESHOLD = isTouchDevice ? 48 : 40;
        let minLabelDist = LABEL_THRESHOLD; // Pixel threshold

        for (const item of dynamicLabels) {
            if (!item.obj.visible) continue;
            if (isNodeFiltered(item.node)) continue;

            const pWorld = item.obj.position;
            const pProj = smartProjectJS(pWorld);
            
            // Back-face cull check
            if (currentProjection.isClipped(pProj.z)) continue;

            const xNDC = pProj.x * uScale / uAspect;
            const yNDC = pProj.y * uScale;
            
            const sX = (xNDC * 0.5 + 0.5) * w;
            const sY = (-yNDC * 0.5 + 0.5) * h;
            
            const dx = mX - sX; 
            const dy = mY - sY;
            const d = Math.sqrt(dx*dx + dy*dy);
            
            if (d < minLabelDist) { 
                minLabelDist = d; 
                closestLabel = item; 
            }
        }
        if (closestLabel) {
            return { type: 'label', node: closestLabel.node, object: closestLabel.obj, point: closestLabel.obj.position.clone(), index: undefined };
        }

        // 2. Pick Constellation Art (Billboards)
        let closestConst = null;
        let minConstDist = Infinity; 
        
        for (const item of constellationLayer.getItems()) {
            if (!item.mesh.visible) continue;
            
            const pWorld = item.mesh.position;
            const pProj = smartProjectJS(pWorld);
            
            if (currentProjection.isClipped(pProj.z)) continue;

            // Material Uniforms should exist if created by ConstellationArtworkLayer
            const uniforms = item.material.uniforms;
            if (!uniforms || !uniforms.uSize) continue;

            const uSize = uniforms.uSize.value;
            const uImgAspect = uniforms.uImgAspect.value;
            const uImgRotation = uniforms.uImgRotation.value;
            
            const dist = pWorld.length(); 
            // Avoid divide by zero
            if (dist < 0.001) continue;

            const scale = (uSize / dist) * uScale; 
            
            const halfH_px = (scale / 2) * (h / 2);
            const halfW_px = halfH_px * uImgAspect;
            
            const xNDC = pProj.x * uScale / uAspect;
            const yNDC = pProj.y * uScale;
            const sX = (xNDC * 0.5 + 0.5) * w;
            const sY = (-yNDC * 0.5 + 0.5) * h;
            
            const dx = mX - sX;
            const dy = mY - sY; 
            const dy_cart = -dy; 
            
            const cr = Math.cos(-uImgRotation);
            const sr = Math.sin(-uImgRotation);
            
            const localX = dx * cr - dy_cart * sr;
            const localY = dx * sr + dy_cart * cr;
            
            // Relaxed Hit Box (1.2x) to make grabbing easier
            if (Math.abs(localX) < halfW_px * 1.2 && Math.abs(localY) < halfH_px * 1.2) {
                const d = Math.sqrt(dx*dx + dy*dy);
                if (!closestConst || d < minConstDist) {
                    minConstDist = d;
                    closestConst = item;
                }
            }
        }
        if (closestConst) {
            const fakeNode: SceneNode = { 
                id: closestConst.config.id, 
                label: closestConst.config.title, 
                level: -1 
            };
            return { type: 'constellation', node: fakeNode, object: closestConst.mesh, point: closestConst.mesh.position.clone(), index: undefined };
        }

        // 3. Pick Stars (Background)
        // Ensure starPoints is valid
        if (starPoints) {
            const worldDir = getMouseWorldVector(mX, mY, rect.width, rect.height);
            raycaster.ray.origin.set(0, 0, 0);
            raycaster.ray.direction.copy(worldDir);
            raycaster.params.Points.threshold = 5.0 * (state.fov / 60);

            const hits = raycaster.intersectObject(starPoints, false);
            const pointHit = hits[0];
            if (pointHit && pointHit.index !== undefined) {
                const id = starIndexToId[pointHit.index];
                if (id) {
                    const node = nodeById.get(id);
                    if (node && !isNodeFiltered(node)) return { type: 'star', node, index: pointHit.index, point: pointHit.point, object: undefined };
                }
            }
        }
        
        return undefined;
    }
    
    function onWindowBlur() { isMouseInWindow = false; edgeHoverStart = 0; }

    function onMouseDown(e: MouseEvent) {
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
        
        // In Edit Mode, we prioritize Object Interaction and disable Camera Panning
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
                    // Group capture logic
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
                } else if (hit.type === 'constellation') {
                    // Constellation Drag
                    state.draggedGroup = null;
                    state.draggedStarIndex = -1;
                }
            }
            // In Edit Mode, always disable camera pan
            return;
        }

        // View Mode: Camera Pan
        flyToActive = false; // Cancel any fly-to animation
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
                 // Handle Constellation Drag
                 else if (state.draggedNodeId) {
                     const cItem = constellationLayer.getItems().find(c => c.config.id === state.draggedNodeId);
                     if (cItem) {
                         cItem.mesh.position.copy(newPos);
                         state.tempArrangement[state.draggedNodeId] = { position: [newPos.x, newPos.y, newPos.z] };
                     }
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

                        // At wide FOV, transition from pan (lon+lat) to pure rotation
                        // (lon only). This spins the dome around the zenith axis instead
                        // of tilting the view off-axis.
                        const rotLock = Math.max(0, Math.min(1, (state.fov - 100) / (ENGINE_CONFIG.maxFov - 100)));
                        const latFactor = 1.0 - rotLock * rotLock; // lat sensitivity fades out

                        state.targetLon += deltaX * ENGINE_CONFIG.dragSpeed * speedScale;
            state.targetLat += deltaY * ENGINE_CONFIG.dragSpeed * speedScale * latFactor;
            state.targetLat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.targetLat));
            state.velocityX = deltaX * ENGINE_CONFIG.dragSpeed * speedScale;
            state.velocityY = deltaY * ENGINE_CONFIG.dragSpeed * speedScale * latFactor;
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
        const dx = e.clientX - state.lastMouseX;
        const dy = e.clientY - state.lastMouseY;
        const movedDist = Math.sqrt(dx * dx + dy * dy);

        if (state.dragMode === 'node') {
            const fullArr = getFullArrangement();
            handlers.onArrangementChange?.(fullArr);
            state.dragMode = 'none';
            state.draggedNodeId = null; state.draggedStarIndex = -1; state.draggedGroup = null;
            document.body.style.cursor = 'default';
        } else if (state.dragMode === 'camera') {
            state.isDragging = false; state.dragMode = 'none';
            document.body.style.cursor = 'default';

            // If barely moved, treat as a click and attempt selection
            if (movedDist < 5) {
                const hit = pick(e);
                if (hit) {
                    handlers.onSelect?.(hit.node);
                    constellationLayer.setFocused(hit.node.id);
                    if (hit.node.level === 2) setFocusedBook(hit.node.id);
                    else if (hit.node.level === 3 && hit.node.parent) setFocusedBook(hit.node.parent);
                } else {
                    setFocusedBook(null);
                }
            }
        } else {
            const hit = pick(e);
            if (hit) {
                handlers.onSelect?.(hit.node);
                constellationLayer.setFocused(hit.node.id);

                // Auto-Focus for Order Reveal
                if (hit.node.level === 2) setFocusedBook(hit.node.id);
                else if (hit.node.level === 3 && hit.node.parent) setFocusedBook(hit.node.parent);

            } else {
                // Background click clears focus
                setFocusedBook(null);
            }
        }
    }
    
    function onWheel(e: WheelEvent) {
        e.preventDefault();
        flyToActive = false; // Cancel any fly-to animation
        const aspect = container.clientWidth / container.clientHeight;
        const rect = renderer.domElement.getBoundingClientRect();
        // Camera Rotate Logic still uses View Space matching to feel right
        const vBefore = getMouseViewVector(state.fov, aspect); 
        
        const zoomSpeed = 0.001 * state.fov;
        state.fov += e.deltaY * zoomSpeed;
        state.fov = Math.max(ENGINE_CONFIG.minFov, Math.min(ENGINE_CONFIG.maxFov, state.fov));
        
        handlers.onFovChange?.(state.fov);

        updateUniforms(); 
        const vAfter = getMouseViewVector(state.fov, aspect);
        
        const quaternion = new THREE.Quaternion().setFromUnitVectors(vAfter, vBefore);

        // --- FOV-based Spin Damping ---
        const dampStartFov = 40;
        const dampEndFov = 120;
        let spinAmount = 1.0;

        if (state.fov > dampStartFov) {
            const t = Math.max(0, Math.min(1, (state.fov - dampStartFov) / (dampEndFov - dampStartFov)));
            // At fov=40, t=0, spin=1. At fov=120, t=1, spin=0.2
            spinAmount = 1.0 - Math.pow(t, 1.5) * 0.8; // Use pow for a smoother falloff
        }

        // Slerp towards identity quaternion to reduce the rotation amount
        if (spinAmount < 0.999) {
            const identityQuat = new THREE.Quaternion();
            quaternion.slerp(identityQuat, 1 - spinAmount);
        }
        
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

    // ---------------------------
    // Touch Handlers
    // ---------------------------
    function getTouchDistance(t1: Touch, t2: Touch): number {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(t1: Touch, t2: Touch): { x: number, y: number } {
        return {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2
        };
    }

    function onTouchStart(e: TouchEvent) {
        e.preventDefault();
        isTouchDevice = true;

        // Clear any pending long-press timer
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }
        state.longPressTriggered = false;

        const touches = e.touches;
        state.touchCount = touches.length;

        if (touches.length === 1) {
            // Single finger - start drag
            const touch = touches[0]!;
            state.touchStartTime = performance.now();
            state.touchStartX = touch.clientX;
            state.touchStartY = touch.clientY;
            state.touchMoved = false;
            state.lastMouseX = touch.clientX;
            state.lastMouseY = touch.clientY;

            flyToActive = false;
            state.dragMode = 'camera';
            state.isDragging = true;
            state.velocityX = 0;
            state.velocityY = 0;

            // Start long-press timer
            state.longPressTimer = setTimeout(() => {
                if (!state.touchMoved && state.touchCount === 1) {
                    state.longPressTriggered = true;
                    // Get the node under the touch point
                    const rect = renderer.domElement.getBoundingClientRect();
                    const mX = state.touchStartX - rect.left;
                    const mY = state.touchStartY - rect.top;
                    mouseNDC.x = (mX / rect.width) * 2 - 1;
                    mouseNDC.y = -(mY / rect.height) * 2 + 1;
                    const syntheticEvent = {
                        clientX: state.touchStartX,
                        clientY: state.touchStartY
                    } as MouseEvent;
                    const hit = pick(syntheticEvent);
                    triggerHaptic('heavy');
                    handlers.onLongPress?.(hit?.node ?? null, state.touchStartX, state.touchStartY);
                }
            }, ENGINE_CONFIG.longPressDelay);
        } else if (touches.length === 2) {
            // Two fingers - start pinch
            const t0 = touches[0]!;
            const t1 = touches[1]!;
            state.pinchStartDistance = getTouchDistance(t0, t1);
            state.pinchStartFov = state.fov;
            const center = getTouchCenter(t0, t1);
            state.pinchCenterX = center.x;
            state.pinchCenterY = center.y;
            state.lastMouseX = center.x;
            state.lastMouseY = center.y;

            // Mark as moved to prevent tap selection
            state.touchMoved = true;
        }
    }

    function onTouchMove(e: TouchEvent) {
        e.preventDefault();

        const touches = e.touches;

        if (touches.length === 1 && state.dragMode === 'camera') {
            // Single finger drag - camera rotation
            const touch = touches[0]!;
            const deltaX = touch.clientX - state.lastMouseX;
            const deltaY = touch.clientY - state.lastMouseY;
            state.lastMouseX = touch.clientX;
            state.lastMouseY = touch.clientY;

            // Check if we've moved enough to count as a drag
            const totalDx = touch.clientX - state.touchStartX;
            const totalDy = touch.clientY - state.touchStartY;
            if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) > ENGINE_CONFIG.tapMaxDistance) {
                state.touchMoved = true;
                // Cancel long-press if moved
                if (state.longPressTimer) {
                    clearTimeout(state.longPressTimer);
                    state.longPressTimer = null;
                }
            }

            const speedScale = state.fov / ENGINE_CONFIG.defaultFov;
            const rotLock = Math.max(0, Math.min(1, (state.fov - 100) / (ENGINE_CONFIG.maxFov - 100)));
            const latFactor = 1.0 - rotLock * rotLock;

            state.targetLon += deltaX * ENGINE_CONFIG.dragSpeed * speedScale;
            state.targetLat += deltaY * ENGINE_CONFIG.dragSpeed * speedScale * latFactor;
            state.targetLat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.targetLat));
            state.velocityX = deltaX * ENGINE_CONFIG.dragSpeed * speedScale;
            state.velocityY = deltaY * ENGINE_CONFIG.dragSpeed * speedScale * latFactor;
            state.lon = state.targetLon;
            state.lat = state.targetLat;
        } else if (touches.length === 2) {
            // Two finger pinch - zoom
            const t0 = touches[0]!;
            const t1 = touches[1]!;
            const newDistance = getTouchDistance(t0, t1);
            const scale = newDistance / state.pinchStartDistance;
            const prevFov = state.fov;
            state.fov = state.pinchStartFov / scale;
            state.fov = Math.max(ENGINE_CONFIG.minFov, Math.min(ENGINE_CONFIG.maxFov, state.fov));
            handlers.onFovChange?.(state.fov);

            // Zenith pull-up when zooming out (FOV increasing)
            if (state.fov > prevFov && state.fov > ENGINE_CONFIG.zenithStartFov) {
                const range = ENGINE_CONFIG.maxFov - ENGINE_CONFIG.zenithStartFov;
                let t = (state.fov - ENGINE_CONFIG.zenithStartFov) / range;
                t = Math.max(0, Math.min(1, t));
                const bias = ENGINE_CONFIG.zenithStrength * t;
                const zenithLat = Math.PI / 2 - 0.001;
                state.lat = state.lat * (1 - bias) + zenithLat * bias;
                state.targetLat = state.lat;
            }

            // Also handle pan with pinch center
            const center = getTouchCenter(t0, t1);
            const deltaX = center.x - state.lastMouseX;
            const deltaY = center.y - state.lastMouseY;
            state.lastMouseX = center.x;
            state.lastMouseY = center.y;

            const speedScale = state.fov / ENGINE_CONFIG.defaultFov;
            state.targetLon += deltaX * ENGINE_CONFIG.dragSpeed * speedScale * 0.5;
            state.targetLat += deltaY * ENGINE_CONFIG.dragSpeed * speedScale * 0.5;
            state.targetLat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.targetLat));
            state.lon = state.targetLon;
            state.lat = state.targetLat;
        }
    }

    function onTouchEnd(e: TouchEvent) {
        e.preventDefault();

        // Clear long-press timer
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }

        const remainingTouches = e.touches.length;

        if (remainingTouches === 0) {
            // All fingers lifted
            const now = performance.now();
            const duration = now - state.touchStartTime;
            const wasTap = !state.touchMoved && duration < ENGINE_CONFIG.tapMaxDuration && !state.longPressTriggered;

            if (wasTap) {
                // Check for double-tap
                const timeSinceLastTap = now - state.lastTapTime;
                const distFromLastTap = Math.sqrt(
                    Math.pow(state.touchStartX - state.lastTapX, 2) +
                    Math.pow(state.touchStartY - state.lastTapY, 2)
                );
                const isDoubleTap = timeSinceLastTap < ENGINE_CONFIG.doubleTapMaxDelay &&
                                    distFromLastTap < ENGINE_CONFIG.doubleTapMaxDistance;

                // Simulate a pick at the touch location
                const rect = renderer.domElement.getBoundingClientRect();
                const mX = state.touchStartX - rect.left;
                const mY = state.touchStartY - rect.top;

                mouseNDC.x = (mX / rect.width) * 2 - 1;
                mouseNDC.y = -(mY / rect.height) * 2 + 1;

                // Create a synthetic mouse event for pick()
                const syntheticEvent = {
                    clientX: state.touchStartX,
                    clientY: state.touchStartY
                } as MouseEvent;

                const hit = pick(syntheticEvent);

                if (isDoubleTap) {
                    // Double-tap: fly to the picked node
                    if (hit) {
                        triggerHaptic('medium');
                        flyTo(hit.node.id, ENGINE_CONFIG.minFov);
                        handlers.onSelect?.(hit.node);
                    }
                    // Reset last tap to prevent triple-tap
                    state.lastTapTime = 0;
                    state.lastTapX = 0;
                    state.lastTapY = 0;
                } else {
                    // Single tap: select
                    if (hit) {
                        triggerHaptic('light');
                        handlers.onSelect?.(hit.node);
                        constellationLayer.setFocused(hit.node.id);
                        if (hit.node.level === 2) setFocusedBook(hit.node.id);
                        else if (hit.node.level === 3 && hit.node.parent) setFocusedBook(hit.node.parent);
                    } else {
                        setFocusedBook(null);
                    }
                    // Record this tap for double-tap detection
                    state.lastTapTime = now;
                    state.lastTapX = state.touchStartX;
                    state.lastTapY = state.touchStartY;
                }
            }

            state.isDragging = false;
            state.dragMode = 'none';
            state.touchCount = 0;
        } else if (remainingTouches === 1) {
            // Went from 2 fingers to 1 - restart single-finger drag
            const touch = e.touches[0]!;
            state.lastMouseX = touch.clientX;
            state.lastMouseY = touch.clientY;
            state.touchCount = 1;
            state.dragMode = 'camera';
            state.isDragging = true;
            state.velocityX = 0;
            state.velocityY = 0;
        }
    }

    function onTouchCancel(e: TouchEvent) {
        e.preventDefault();
        // Clear long-press timer
        if (state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
        }
        state.isDragging = false;
        state.dragMode = 'none';
        state.touchCount = 0;
        state.velocityX = 0;
        state.velocityY = 0;
    }

    function onGesturePrevent(e: Event) {
        e.preventDefault();
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
        el.addEventListener("mouseleave", onWindowBlur);
        window.addEventListener("blur", onWindowBlur);

        // Touch events
        el.addEventListener("touchstart", onTouchStart, { passive: false });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd, { passive: false });
        el.addEventListener("touchcancel", onTouchCancel, { passive: false });

        // Safari gesture prevention
        el.addEventListener("gesturestart", onGesturePrevent, { passive: false });
        el.addEventListener("gesturechange", onGesturePrevent, { passive: false });
        el.addEventListener("gestureend", onGesturePrevent, { passive: false });

        raf = requestAnimationFrame(tick);
    }
    
    function tick() {
        if (!running) return;
        raf = requestAnimationFrame(tick);
        
        const now = performance.now();
        globalUniforms.uTime.value = now / 1000.0;
        
        // --- Order Reveal Animation ---
        // Hover takes precedence for preview, falling back to focus state
        let activeId = null;
        
        if (focusedBookId) {
            activeId = focusedBookId;
        } else if (hoveredBookId) {
            // Check Cooldown
            const lastExit = hoverCooldowns.get(hoveredBookId) || 0;
            // If cooldown passed, allow it
            if (now - lastExit > COOLDOWN_MS) {
                activeId = hoveredBookId;
            }
        }
        
        const targetStrength = (orderRevealEnabled && activeId) ? 1.0 : 0.0;
        orderRevealStrength = mix(orderRevealStrength, targetStrength, 0.1);
        
        // Only update if significant
        if (orderRevealStrength > 0.001 || targetStrength > 0.0) {
             if (activeId && bookIdToIndex.has(activeId)) {
                 activeBookIndex = bookIdToIndex.get(activeId)!;
             }
             
             if (starPoints && starPoints.material) {
                 const m = starPoints.material as THREE.ShaderMaterial;
                 if (m.uniforms.uActiveBookIndex) m.uniforms.uActiveBookIndex.value = activeBookIndex;
                 if (m.uniforms.uOrderRevealStrength) m.uniforms.uOrderRevealStrength.value = orderRevealStrength;
             }
        }

        // --- Hierarchy Filter Animation ---
        const filterTarget = currentFilter ? 1.0 : 0.0;
        filterStrength = mix(filterStrength, filterTarget, 0.1);
        if (filterStrength > 0.001 || filterTarget > 0.0) {
            if (starPoints && starPoints.material) {
                const m = starPoints.material as THREE.ShaderMaterial;
                if (m.uniforms.uFilterTestamentIndex) m.uniforms.uFilterTestamentIndex.value = filterTestamentIndex;
                if (m.uniforms.uFilterDivisionIndex) m.uniforms.uFilterDivisionIndex.value = filterDivisionIndex;
                if (m.uniforms.uFilterBookIndex) m.uniforms.uFilterBookIndex.value = filterBookIndex;
                if (m.uniforms.uFilterStrength) m.uniforms.uFilterStrength.value = filterStrength;
            }
        }

        let panX = 0; let panY = 0;

        // Edge Pan Logic (Disable in Edit Mode and on Touch Devices)
        if (!state.isDragging && isMouseInWindow && !currentConfig?.editable && !isTouchDevice) {
            const t = ENGINE_CONFIG.edgePanThreshold;
            const inZoneX = mouseNDC.x < -1 + t || mouseNDC.x > 1 - t;
            const inZoneY = mouseNDC.y < -1 + t || mouseNDC.y > 1 - t;
            
            if (inZoneX || inZoneY) {
                // Start timer if not started
                if (edgeHoverStart === 0) edgeHoverStart = performance.now();
                
                // Only pan if delay exceeded
                if (performance.now() - edgeHoverStart > ENGINE_CONFIG.edgePanDelay) {
                    const speedBase = ENGINE_CONFIG.edgePanMaxSpeed * (state.fov / ENGINE_CONFIG.defaultFov);
                    if (mouseNDC.x < -1 + t) { const s = (-1 + t - mouseNDC.x) / t; panX = -s * s * speedBase; }
                    else if (mouseNDC.x > 1 - t) { const s = (mouseNDC.x - (1 - t)) / t; panX = s * s * speedBase; }
                    if (mouseNDC.y < -1 + t) { const s = (-1 + t - mouseNDC.y) / t; panY = -s * s * speedBase; }
                    else if (mouseNDC.y > 1 - t) { const s = (mouseNDC.y - (1 - t)) / t; panY = s * s * speedBase; }
                }
            } else {
                edgeHoverStart = 0;
            }
        } else {
            edgeHoverStart = 0;
        }

        // --- Fly-To Animation ---
        if (flyToActive && !state.isDragging) {
            state.lon = mix(state.lon, flyToTargetLon, FLY_TO_SPEED);
            state.lat = mix(state.lat, flyToTargetLat, FLY_TO_SPEED);
            state.fov = mix(state.fov, flyToTargetFov, FLY_TO_SPEED);
            state.targetLon = state.lon;
            state.targetLat = state.lat;
            state.velocityX = 0;
            state.velocityY = 0;
            handlers.onFovChange?.(state.fov);

            // Stop when close enough
            if (Math.abs(state.lon - flyToTargetLon) < 0.0001 &&
                Math.abs(state.lat - flyToTargetLat) < 0.0001 &&
                Math.abs(state.fov - flyToTargetFov) < 0.05) {
                flyToActive = false;
                state.lon = flyToTargetLon;
                state.lat = flyToTargetLat;
                state.fov = flyToTargetFov;
            }
        }

        if (Math.abs(panX) > 0 || Math.abs(panY) > 0) {
            state.lon += panX; state.lat += panY; state.targetLon = state.lon; state.targetLat = state.lat;
        } else if (!state.isDragging && !flyToActive) {
             state.lon += state.velocityX;
             state.lat += state.velocityY;
             const damping = isTouchDevice ? ENGINE_CONFIG.touchInertiaDamping : ENGINE_CONFIG.inertiaDamping;
             state.velocityX *= damping;
             state.velocityY *= damping;
             if (Math.abs(state.velocityX) < 0.000001) state.velocityX = 0;
             if (Math.abs(state.velocityY) < 0.000001) state.velocityY = 0;
        }

        state.lat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.lat));
        const y = Math.sin(state.lat); const r = Math.cos(state.lat);
        const x = r * Math.sin(state.lon); const z = -r * Math.cos(state.lon);
        const target = new THREE.Vector3(x, y, z);
        const idealUp = new THREE.Vector3(-Math.sin(state.lat) * Math.sin(state.lon), Math.cos(state.lat), Math.sin(state.lat) * Math.cos(state.lon)).normalize();
        camera.up.lerp(idealUp, ENGINE_CONFIG.horizonLockStrength);
        camera.up.normalize();
        camera.lookAt(target);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        updateUniforms(); 
        
        // --- Fader Updates ---
        const nowSec = now / 1000;
        const dt = lastTickTime > 0 ? Math.min(nowSec - lastTickTime, 0.1) : 0.016;
        lastTickTime = nowSec;

        linesFader.target = currentConfig?.showConstellationLines ?? false;
        linesFader.update(dt);
        artFader.target = currentConfig?.showConstellationArt ?? false;
        artFader.update(dt);

        constellationLayer.update(state.fov, artFader.eased > 0.01);
        if (artFader.eased < 1.0) {
            constellationLayer.setGlobalOpacity?.(artFader.eased);
        }
        backdropGroup.visible = currentConfig?.showBackdropStars ?? true;
        if (atmosphereMesh) atmosphereMesh.visible = currentConfig?.showAtmosphere ?? false;

        const DIVISION_THRESHOLD = 60;
        const showDivisions = state.fov > DIVISION_THRESHOLD;

        // --- Constellation Lines Visibility (faded) ---
        if (constellationLines) {
            constellationLines.visible = linesFader.eased > 0.01;
            if (constellationLines.visible && (constellationLines as THREE.Mesh).material) {
                const mat = (constellationLines as THREE.Mesh).material as THREE.ShaderMaterial;
                if (mat.uniforms?.color) {
                    mat.uniforms.color.value.setHex(0xaaccff);
                    mat.opacity = linesFader.eased;
                }
            }
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
        const showGroupLabels = currentConfig?.showGroupLabels === true;
        
        // FOV thresholds
        // showDivisions already calculated above
        const showBooks = true;
        const showChapters = state.fov < 45;

        for (const item of dynamicLabels) {
            const uniforms = (item.obj.material as THREE.ShaderMaterial).uniforms as any;
            const level = item.node.level;

            // Global Toggle Check
            let isEnabled = false;
            if (level === 2 && showBookLabels) isEnabled = true;
            else if (level === 1 && showDivisionLabels) isEnabled = true;
            else if (level === 3 && showChapterLabels) isEnabled = true;
            else if (level === 2.5 && showGroupLabels) isEnabled = true;
            
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
            
            // Optimization: If Level 2 (Books) and not zoomed in, cull immediately
            if (level === 2 && !showBooks && item.node.id !== state.draggedNodeId) {
                uniforms.uAlpha.value = THREE.MathUtils.lerp(uniforms.uAlpha.value, 0, 0.2);
                item.obj.visible = uniforms.uAlpha.value > 0.01;
                continue;
            }

            // Optimization: If Level 3 (Chapters) or Level 2.5 (Groups) and not zoomed in, cull immediately
            if ((level === 3 || level === 2.5) && !showChapters && item.node.id !== state.draggedNodeId) {
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
            labelsToCheck.push({ item, sX, sY, w: pixelW, h: pixelH, uniforms, level, ndcX, ndcY });
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
                const isWideAngle = currentProjection.id !== "perspective";
                if (isWideAngle) {
                    const dx = l.sX - screenW / 2;
                    const dy = l.sY - screenH / 2;
                    rot = Math.atan2(-dy, -dx) - Math.PI / 2;
                }
                l.uniforms.uAngle.value = THREE.MathUtils.lerp(l.uniforms.uAngle.value, rot, 0.1);
            }

            if (l.level === 2) {
                // Books: Visible if zoomed in OR special (hover/drag)
                if (showBooks || isSpecial) {
                    target = 1.0;
                    occupied.push({ x: l.sX - l.w/2, y: l.sY - l.h/2, w: l.w, h: l.h });
                }
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
            else if (l.level === 2.5 || l.level === 3) {
                // Groups & Chapters: Use showChapters threshold AND radial focus
                if (showChapters || isSpecial) {
                    target = 1.0;
                    
                    if (!isSpecial) {
                        // Radial Focus: Fade out towards periphery
                        // ndc distance from center (0,0)
                        // X is scaled by aspect in ndc calculation in loop? 
                        // Wait, previous code: ndcX = pProj.x ... / aspect.
                        // So ndcX is -1..1 (width adjusted). ndcY is -1..1.
                        // Distance is straightforward.
                        
                        const dist = Math.sqrt(l.ndcX * l.ndcX + l.ndcY * l.ndcY);
                        
                        // Focus zone: 0.0 -> 0.4 (Full opacity)
                        // Fade zone: 0.4 -> 0.7 (Fade out)
                        // Hidden: > 0.7
                        const focusFade = 1.0 - THREE.MathUtils.smoothstep(0.4, 0.7, dist);
                        target *= focusFade;
                    }
                }
            }
            
            // Apply hierarchy filter dimming
            if (target > 0 && currentFilter && filterStrength > 0.01) {
                const node = l.item.node;
                if (node.level === 3) { // Chapter
                    target = 0.0;
                } else if (node.level === 2 || node.level === 2.5) { // Book or Group
                    const nodeToCheck = (node.level === 2.5 && node.parent) ? nodeById.get(node.parent) : node;
                    if (nodeToCheck && isNodeFiltered(nodeToCheck)) {
                        target = 0.0;
                    }
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
        el.removeEventListener("mouseleave", onWindowBlur);
        window.removeEventListener("blur", onWindowBlur);

        // Touch events
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", onTouchEnd);
        el.removeEventListener("touchcancel", onTouchCancel);

        // Safari gesture events
        el.removeEventListener("gesturestart", onGesturePrevent);
        el.removeEventListener("gesturechange", onGesturePrevent);
        el.removeEventListener("gestureend", onGesturePrevent);
    }
    function dispose() { stop(); constellationLayer.dispose(); renderer.dispose(); renderer.domElement.remove(); }
    
    function setHoveredBook(id: string | null) { 
        if (id === hoveredBookId) return;
        
        // If leaving a book, mark timestamp
        if (hoveredBookId) {
            hoverCooldowns.set(hoveredBookId, performance.now());
        }
        
        hoveredBookId = id; 
    }
    function setFocusedBook(id: string | null) { focusedBookId = id; }
    function setOrderRevealEnabled(enabled: boolean) { orderRevealEnabled = enabled; }

    function flyTo(nodeId: string, targetFov?: number) {
        const node = nodeById.get(nodeId);
        if (!node) return;
        const pos = getPosition(node).normalize();
        flyToTargetLat = Math.asin(Math.max(-0.999, Math.min(0.999, pos.y)));
        flyToTargetLon = Math.atan2(pos.x, -pos.z);
        flyToTargetFov = targetFov ?? ENGINE_CONFIG.minFov;
        flyToActive = true;
        // Cancel any user drag inertia
        state.velocityX = 0;
        state.velocityY = 0;
    }

    function setHierarchyFilter(filter: import("../types").HierarchyFilter | null) {
        currentFilter = filter;
        if (filter) {
            filterTestamentIndex = filter.testament && testamentToIndex.has(filter.testament)
                ? testamentToIndex.get(filter.testament)! : -1.0;
            filterDivisionIndex = filter.division && divisionToIndex.has(filter.division)
                ? divisionToIndex.get(filter.division)! : -1.0;
            filterBookIndex = filter.bookKey && bookIdToIndex.has(`B:${filter.bookKey}`)
                ? bookIdToIndex.get(`B:${filter.bookKey}`)! : -1.0;
        } else {
            filterTestamentIndex = -1.0;
            filterDivisionIndex = -1.0;
            filterBookIndex = -1.0;
        }
    }

    return { setConfig, start, stop, dispose, setHandlers, getFullArrangement, setHoveredBook, setFocusedBook, setOrderRevealEnabled, setHierarchyFilter, flyTo, setProjection };
}
