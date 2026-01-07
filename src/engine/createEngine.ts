import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { DragControls } from "three/examples/jsm/controls/DragControls";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import type { StarMapConfig, SceneModel, SceneNode, StarArrangement } from "../types";
import { computeLayoutPositions } from "./layout";
import { applyVisuals, createVisualResolver } from "./materials";

type Handlers = {
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
    onArrangementChange?: (arrangement: StarArrangement) => void;
};

type RenderMode = "basic" | "cinematic";

type EngineConfig = {
    // Stellarium-ish “stand in the middle and look out”
    skyRadius?: number; // radius for procedural backdrop stars
    groundRadius?: number; // radius of the ground hemisphere used to occlude “below horizon”
    horizonGlow?: boolean;

    // Rendering
    renderModeDefault?: RenderMode;

    // Zoom behaviour (FOV-based)
    defaultFov?: number;
    minFov?: number;
    maxFov?: number;
    /** If true, you cannot zoom out beyond the initial FOV ("no zooming backwards"). */
    lockZoomOutToInitialFov?: boolean;
    /** Exponential zoom intensity. Larger = faster zoom. */
    fovWheelSensitivity?: number;
    /** Lerp factor applied each frame when easing camera.fov -> targetFov */
    zoomLerp?: number;
    resetFovOnDblClick?: boolean;

    // Click-to-focus behaviour
    focusOnSelect?: boolean;
    focusZoomFov?: number; // fov to animate to on focus
    focusDurationMs?: number;

    // Cinematic star points
    starPxPerScale?: number; // converts style scale -> pixel size
    starMinPx?: number;
    starMaxPx?: number;
    starTwinkleStrength?: number;
    inactiveDim?: number;

    // Bloom / tone mapping (cinematic)
    bloomEnabled?: boolean;
    bloomStrength?: number;
    bloomRadius?: number;
    bloomThreshold?: number;
    toneMappingExposure?: number;
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
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 5000);
    // Tiny offset so OrbitControls has a radius to work with
    camera.position.set(0, 0, 0.01);
    camera.up.set(0, 1, 0);

    // ---------------------------
    // Controls: “look around”
    // ---------------------------
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableRotate = true;
    controls.enablePan = false;
    controls.enableZoom = false; // we control FOV (not dolly)
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = false;

    // Free yaw; clamp pitch so we don’t go “under” the horizon.
    const EPS = THREE.MathUtils.degToRad(0.05);
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;

    // OrbitControls: 0=top(looking down), PI=bottom(looking up).
    // We want to look UP at the sky, so we need range [PI/2, PI].
    controls.minPolarAngle = Math.PI / 2 + EPS;
    controls.maxPolarAngle = Math.PI - EPS;
    controls.update();

    // ---------------------------
    // Stellarium-ish environment defaults
    // ---------------------------
    const env = {
        skyRadius: 2800,
        groundRadius: 995,
        horizonGlow: true,

        renderModeDefault: "basic" as RenderMode,

        defaultFov: 80,
        minFov: 6,
        maxFov: 110,
        lockZoomOutToInitialFov: true,
        // Exponential zoom intensity: smaller numbers are gentler, better for trackpads
        fovWheelSensitivity: 0.0022,
        zoomLerp: 0.12,
        resetFovOnDblClick: true,

        focusOnSelect: false,
        focusZoomFov: 18,
        focusDurationMs: 650,

        starPxPerScale: 2.2,
        starMinPx: 2.0,
        starMaxPx: 16.0,
        starTwinkleStrength: 0.22,
        inactiveDim: 0.10,

        bloomEnabled: true,
        bloomStrength: 0.28,
        bloomRadius: 0.2,
        bloomThreshold: 0.92,
        toneMappingExposure: 1.0,
    } satisfies EngineConfig;

    let targetFov = env.defaultFov!;
    let zoomOutLimitFov = env.defaultFov!;
    let currentRenderMode: RenderMode = env.renderModeDefault!;
    let focusActiveIds: Set<string> | null = null;

    // ---------------------------
    // Post-processing (cinematic)
    // ---------------------------
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;

    function configurePostProcessing(mode: RenderMode, cfg: StarMapConfig) {
        const anyCfg = cfg as any;
        const renderCfg = anyCfg?.render ?? {};
        const bloomCfg = renderCfg?.bloom ?? {};

        const wantBloom =
            mode === "cinematic" &&
            (bloomCfg.enabled ?? renderCfg.bloomEnabled ?? env.bloomEnabled);

        if (mode === "cinematic") {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = renderCfg.exposure ?? env.toneMappingExposure!;
        } else {
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.toneMappingExposure = 1.0;
        }

        if (!wantBloom) {
            composer = null;
            bloomPass = null;
            return;
        }

        if (!composer) {
            composer = new EffectComposer(renderer);
            composer.addPass(new RenderPass(scene, camera));

            bloomPass = new UnrealBloomPass(
                new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1),
                env.bloomStrength!,
                env.bloomRadius!,
                env.bloomThreshold!
            );
            composer.addPass(bloomPass);
        }

        if (bloomPass) {
            bloomPass.strength = bloomCfg.strength ?? env.bloomStrength!;
            bloomPass.radius = bloomCfg.radius ?? env.bloomRadius!;
            bloomPass.threshold = bloomCfg.threshold ?? env.bloomThreshold!;
        }
    }

    // ---------------------------
    // Ground / Horizon occlusion
    // ---------------------------
    const groundGroup = new THREE.Group();
    scene.add(groundGroup);

    function buildGroundHemisphere(radius: number) {
        groundGroup.clear();

        // inside-facing lower hemisphere
        const hemi = new THREE.SphereGeometry(radius, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI);
        hemi.scale(-1, 1, 1);

        // vertex color gradient: darker down, brighter near horizon
        const count = (hemi.attributes.position as THREE.BufferAttribute).count;
        const colors = new Float32Array(count * 3);
        const pos = hemi.attributes.position as THREE.BufferAttribute;
        const c = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const y = pos.getY(i); // [-radius, 0]
            const t = THREE.MathUtils.clamp(1 - Math.abs(y) / radius, 0, 1);
            c.setRGB(
                THREE.MathUtils.lerp(0x06 / 255, 0x15 / 255, t),
                THREE.MathUtils.lerp(0x10 / 255, 0x23 / 255, t),
                THREE.MathUtils.lerp(0x17 / 255, 0x35 / 255, t)
            );
            colors.set([c.r, c.g, c.b], i * 3);
        }

        hemi.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.BackSide,
            depthWrite: true,
            depthTest: true,
        });

        const mesh = new THREE.Mesh(hemi, mat);
        groundGroup.add(mesh);
    }

    function buildHorizonGlow(radius: number) {
        if (!env.horizonGlow) return;

        const ring = new THREE.RingGeometry(radius * 0.95, radius * 1.03, 96);
        ring.rotateX(Math.PI / 2);
        ring.scale(1, 1, 1);

        const inner = radius * 0.95;
        const outer = radius * 1.03;

        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uInner: { value: inner },
                uOuter: { value: outer },
                uColor: { value: new THREE.Color(0x7aa2ff) },
            },
            vertexShader: `
              varying vec2 vXY;
              void main() {
                vXY = position.xz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: `
              uniform float uInner;
              uniform float uOuter;
              uniform vec3 uColor;
              varying vec2 vXY;
              void main() {
                float r = length(vXY);
                float t = smoothstep(uOuter, uInner, r);
                gl_FragColor = vec4(uColor, t * 0.25);
              }
            `,
        });

        const glow = new THREE.Mesh(ring, mat);
        glow.renderOrder = 1;
        groundGroup.add(glow);
    }

    buildGroundHemisphere(env.groundRadius);
    buildHorizonGlow(env.groundRadius);

    // ---------------------------
    // Backdrop stars (procedural)
    // ---------------------------
    const backdropGroup = new THREE.Group();
    scene.add(backdropGroup);

    function buildBackdropStars(radius: number, count: number) {
        backdropGroup.clear();

        const starGeo = new THREE.BufferGeometry();
        const starPos = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const r = radius + Math.random() * (radius * 0.5);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            starPos[i * 3 + 2] = r * Math.cos(phi);
        }

        starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0x9aa6b2,
            size: 0.5,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
        });

        const stars = new THREE.Points(starGeo, starMat);
        backdropGroup.add(stars);
    }

    buildBackdropStars(env.skyRadius, 6500);

    // ---------------------------
    // Picking / Model content
    // ---------------------------
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = 10; // tuned later in tick
    const pointer = new THREE.Vector2();

    const root = new THREE.Group();
    scene.add(root);

    let raf = 0;
    let running = false;
    let handlers: Handlers = { onSelect, onHover, onArrangementChange };
    let hoveredId: string | null = null;
    let hoveredLineBookId: string | null = null;
    let isDragging = false;

    let dragControls: DragControls | null = null;
    let currentConfig: StarMapConfig | undefined;

    const nodeById = new Map<string, SceneNode>();
    const meshById = new Map<string, THREE.Object3D>(); // sprites/meshes only
    const lineByBookId = new Map<string, THREE.Line>();
    const dynamicObjects: { obj: THREE.Object3D; initialScale: THREE.Vector3; type: "star" | "label" }[] = [];

    // Chapter points (cinematic mode)
    let chapterPoints: THREE.Points | null = null;
    let chapterPointIds: string[] = [];
    const chapterPointIndexById = new Map<string, number>();
    let chapterPosAttr: THREE.BufferAttribute | null = null;
    let chapterActiveAttr: THREE.BufferAttribute | null = null;
    let chapterMat: THREE.ShaderMaterial | null = null;

    // Single hover label sprite
    let hoverLabelSprite: THREE.Sprite | null = null;
    let hoverLabelCanvas: HTMLCanvasElement | null = null;
    let hoverLabelCtx: CanvasRenderingContext2D | null = null;
    let hoverLabelTex: THREE.CanvasTexture | null = null;

    function clampFov(v: number) {
        const max = env.lockZoomOutToInitialFov ? Math.min(env.maxFov!, zoomOutLimitFov) : env.maxFov!;
        return THREE.MathUtils.clamp(v, env.minFov!, max);
    }

    function resolveRenderMode(cfg: StarMapConfig): RenderMode {
        const anyCfg = cfg as any;
        const requested = (anyCfg?.renderMode ?? anyCfg?.render?.mode) as any;
        const mode: RenderMode =
            requested === "cinematic" || requested === "basic" ? requested : env.renderModeDefault!;
        return mode;
    }

    function getRenderedNodePosition(id: string): THREE.Vector3 | null {
        const mesh = meshById.get(id);
        if (mesh) return mesh.position.clone();

        const idx = chapterPointIndexById.get(id);
        if (idx !== undefined && chapterPosAttr) {
            return new THREE.Vector3(
                chapterPosAttr.getX(idx),
                chapterPosAttr.getY(idx),
                chapterPosAttr.getZ(idx)
            );
        }
        return null;
    }

    function setRenderedNodePosition(id: string, pos: THREE.Vector3) {
        const mesh = meshById.get(id);
        if (mesh) {
            mesh.position.copy(pos);
            return;
        }

        const idx = chapterPointIndexById.get(id);
        if (idx !== undefined && chapterPosAttr) {
            chapterPosAttr.setXYZ(idx, pos.x, pos.y, pos.z);
            chapterPosAttr.needsUpdate = true;
        }
    }

    function translateRenderedNodeById(id: string, delta: THREE.Vector3) {
        const p = getRenderedNodePosition(id);
        if (!p) return;
        p.add(delta);
        setRenderedNodePosition(id, p);
    }

    function setHoverLabel(text: string, color: string = "#ffffff") {
        if (!hoverLabelSprite || !hoverLabelCanvas || !hoverLabelCtx || !hoverLabelTex) {
            hoverLabelCanvas = document.createElement("canvas");
            hoverLabelCtx = hoverLabelCanvas.getContext("2d");
            if (!hoverLabelCtx) return;

            hoverLabelTex = new THREE.CanvasTexture(hoverLabelCanvas);
            hoverLabelTex.minFilter = THREE.LinearFilter;
            hoverLabelTex.magFilter = THREE.LinearFilter;

            const mat = new THREE.SpriteMaterial({
                map: hoverLabelTex,
                transparent: true,
                depthWrite: false,
                depthTest: true,
            });

            hoverLabelSprite = new THREE.Sprite(mat);
            hoverLabelSprite.visible = false;
            hoverLabelSprite.renderOrder = 10;
            root.add(hoverLabelSprite);
        }

        const ctx = hoverLabelCtx!;
        const canvas = hoverLabelCanvas!;
        const fontSize = 48;
        const font = `bold ${fontSize}px sans-serif`;

        ctx.font = font;
        const metrics = ctx.measureText(text);
        const w = Math.ceil(metrics.width);
        const h = Math.ceil(fontSize * 1.2);

        canvas.width = Math.max(2, w);
        canvas.height = Math.max(2, h);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = font;
        ctx.textBaseline = "top";
        ctx.fillStyle = color;
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 6;
        ctx.fillText(text, 0, 0);

        hoverLabelTex!.needsUpdate = true;

        // world-size label
        const targetHeight = 2;
        const aspect = canvas.width / canvas.height;
        hoverLabelSprite!.scale.set(targetHeight * aspect, targetHeight, 1);
    }

    function hideHoverLabel() {
        if (hoverLabelSprite) hoverLabelSprite.visible = false;
    }

    // ---------------------------
    // Star texture (basic mode sprites)
    // ---------------------------
    function createStarTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, "rgba(255,255,255,1)");
        grd.addColorStop(0.2, "rgba(255,255,255,0.9)");
        grd.addColorStop(1, "rgba(255,255,255,0)");

        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(32, 32, 32, 0, Math.PI * 2);
        ctx.fill();

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        return tex;
    }

    const starTexture = createStarTexture();

    function createTextSprite(text: string, color: string = "#ffffff") {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        const fontSize = 48;
        const font = `bold ${fontSize}px sans-serif`;
        ctx.font = font;

        const metrics = ctx.measureText(text);
        const w = Math.ceil(metrics.width);
        const h = Math.ceil(fontSize * 1.2);

        canvas.width = w;
        canvas.height = h;

        ctx.font = font;
        ctx.textBaseline = "top";
        ctx.fillStyle = color;
        ctx.shadowColor = "rgba(0,0,0,0.7)";
        ctx.shadowBlur = 6;
        ctx.fillText(text, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            depthTest: true,
        });

        const sprite = new THREE.Sprite(mat);

        const targetHeight = 2;
        const aspect = w / h;
        sprite.scale.set(targetHeight * aspect, targetHeight, 1);

        return sprite;
    }

    // ---------------------------
    // Dispose helpers
    // ---------------------------
    function disposeObject(obj: THREE.Object3D) {
        obj.traverse((o: any) => {
            if (o.geometry) o.geometry.dispose?.();
            if (o.material) {
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach((m: any) => {
                    if (m.map) m.map.dispose?.();
                    m.dispose?.();
                });
            }
        });
    }

    function clearRoot() {
        for (const child of [...root.children]) {
            root.remove(child);
            disposeObject(child);
        }
        nodeById.clear();
        meshById.clear();
        lineByBookId.clear();
        dynamicObjects.length = 0;

        chapterPoints = null;
        chapterPointIds = [];
        chapterPointIndexById.clear();
        chapterPosAttr = null;
        chapterActiveAttr = null;
        chapterMat = null;
        hoveredLineBookId = null;
        hoveredId = null;
        focusActiveIds = null;
        hideHoverLabel();
    }

    // ---------------------------
    // Constellation line helpers
    // ---------------------------
    function updateBookLine(bookId: string) {
        const line = lineByBookId.get(bookId);
        if (!line) return;

        const chapters: SceneNode[] = [];
        for (const n of nodeById.values()) {
            if (n.parent === bookId && n.level === 3) chapters.push(n);
        }

        chapters.sort((a, b) => {
            const cA = (a.meta?.chapter as number) || 0;
            const cB = (b.meta?.chapter as number) || 0;
            return cA - cB;
        });

        const points: THREE.Vector3[] = [];
        for (const c of chapters) {
            const p = getRenderedNodePosition(c.id);
            if (p) points.push(p);
        }

        if (points.length > 1) {
            line.geometry.setFromPoints(points);
        }
    }

    function setLineBaseOpacity(bookId: string, base: number) {
        const line = lineByBookId.get(bookId);
        if (!line) return;
        (line.userData as any).baseOpacity = base;
        if (hoveredLineBookId !== bookId) {
            (line.material as THREE.LineBasicMaterial).opacity = base;
        }
    }

    // ---------------------------
    // Chapter points (cinematic mode)
    // ---------------------------
    function buildChapterPoints(model: SceneModel, cfg: StarMapConfig) {
        // remove existing, if any
        if (chapterPoints) {
            root.remove(chapterPoints);
            disposeObject(chapterPoints);
            chapterPoints = null;
        }
        chapterPointIds = [];
        chapterPointIndexById.clear();

        const resolver = createVisualResolver(model, cfg);

        const chapters = (model.nodes as any[]).filter((n) => n.level === 3);
        const n = chapters.length;

        const positions = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        const alphas = new Float32Array(n);
        const sizes = new Float32Array(n);
        const actives = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const node = chapters[i] as any as SceneNode;
            chapterPointIds.push(node.id);
            chapterPointIndexById.set(node.id, i);

            const x = (node.meta?.x as number) ?? 0;
            const y = (node.meta?.y as number) ?? 0;
            const z = (node.meta?.z as number) ?? 0;

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            const { color, opacity } = resolver.color(node);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            alphas[i] = opacity;

            // Size:
            // Prefer absolute scale from style rules (same as sprites), then map to pixels.
            const baseScale = 2.0;
            const s = resolver.scale(node) ?? baseScale;
            const px = THREE.MathUtils.clamp(
                s * env.starPxPerScale!,
                env.starMinPx!,
                env.starMaxPx!
            );
            sizes[i] = px;
            actives[i] = 1.0;
        }

        const geo = new THREE.BufferGeometry();
        chapterPosAttr = new THREE.BufferAttribute(positions, 3);
        chapterActiveAttr = new THREE.BufferAttribute(actives, 1);

        geo.setAttribute("position", chapterPosAttr);
        geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
        geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
        geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute("aActive", chapterActiveAttr);

        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
                uInactiveDim: { value: env.inactiveDim! },
                uTwinkleStrength: { value: env.starTwinkleStrength! },
            },
            vertexShader: `
                attribute vec3 aColor;
                attribute float aAlpha;
                attribute float aSize;
                attribute float aActive;

                uniform float uTime;
                uniform float uPixelRatio;
                uniform float uTwinkleStrength;

                varying vec4 vColor;
                varying float vActive;
                varying float vTwinkle;

                void main() {
                    vColor = vec4(aColor, aAlpha);
                    vActive = aActive;

                    float tw = 1.0;
                    if (uTwinkleStrength > 0.0) {
                        tw = 1.0 + 0.5 * uTwinkleStrength * sin(
                            uTime * 0.001 +
                            position.x * 0.02 +
                            position.y * 0.017 +
                            position.z * 0.013
                        );
                    }
                    vTwinkle = tw;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    // Constant pixel size (planetarium feel)
                    gl_PointSize = aSize * uPixelRatio;
                }
            `,
            fragmentShader: `
                uniform float uInactiveDim;

                varying vec4 vColor;
                varying float vActive;
                varying float vTwinkle;

                void main() {
                    vec2 uv = gl_PointCoord * 2.0 - 1.0;
                    float r = length(uv);

                    float core = smoothstep(0.85, 0.0, r);
                    float halo = smoothstep(1.15, 0.0, r) * 0.35;
                    float a = core + halo;

                    if (a <= 0.001) discard;

                    float dim = mix(uInactiveDim, 1.0, vActive);
                    vec3 col = vColor.rgb * vTwinkle;

                    gl_FragColor = vec4(col, vColor.a * a * dim);
                }
            `,
        });

        chapterMat = mat;

        chapterPoints = new THREE.Points(geo, mat);
        chapterPoints.userData = { kind: "chapterPoints", interactive: true };
        root.add(chapterPoints);
    }

    function setChapterFocusMask(activeIds: Set<string> | null) {
        focusActiveIds = activeIds;

        if (!chapterActiveAttr) return;
        for (let i = 0; i < chapterPointIds.length; i++) {
            const id = chapterPointIds[i];
            const active = !activeIds || activeIds.has(id) ? 1 : 0;
            chapterActiveAttr.setX(i, active);
        }
        chapterActiveAttr.needsUpdate = true;
    }

    // ---------------------------
    // Build scene from model
    // ---------------------------
    function buildFromModel(model: SceneModel, cfg: StarMapConfig, mode: RenderMode) {
        clearRoot();

        // background
        if (cfg.background && cfg.background !== "transparent") {
            scene.background = new THREE.Color(cfg.background);
        } else {
            scene.background = null;
        }

        // camera
        camera.fov = cfg.camera?.fov ?? env.defaultFov!;
        camera.updateProjectionMatrix();
        targetFov = camera.fov;
        zoomOutLimitFov = camera.fov;

        // layout
        const laidOut = computeLayoutPositions(model, cfg.layout);

        // nodes (sprites for labels, sprites or points for chapters)
        const wantChapterSprites = mode === "basic";

        for (const n of laidOut.nodes) {
            nodeById.set(n.id, n);

            let x = (n.meta?.x as number) ?? 0;
            let y = (n.meta?.y as number) ?? 0;
            let z = (n.meta?.z as number) ?? 0;

            if (cfg.arrangement && (cfg.arrangement as any)[n.id]) {
                const pos = (cfg.arrangement as any)[n.id].position;
                x = pos[0];
                y = pos[1];
                z = pos[2];
            }

            // Keep meta in sync with rendered position (used by points + line building)
            (n.meta as any).x = x;
            (n.meta as any).y = y;
            (n.meta as any).z = z;

            // Level 3: Chapters -> Stars
            if (n.level === 3 && wantChapterSprites) {
                if (!starTexture) continue;

                const sprite = new THREE.Sprite(
                    new THREE.SpriteMaterial({
                        map: starTexture,
                        transparent: true,
                        opacity: 1,
                        depthWrite: false,
                        depthTest: true,
                        blending: THREE.AdditiveBlending,
                    })
                );

                sprite.position.set(x, y, z);
                sprite.userData = { id: n.id, level: n.level, interactive: true };

                // Base size for stars (styles may override)
                sprite.scale.setScalar(2.0);

                dynamicObjects.push({ obj: sprite, initialScale: sprite.scale.clone(), type: "star" });

                root.add(sprite);
                meshById.set(n.id, sprite);
            }

            // Level 1 (Division) or 2 (Book) -> Text Labels on the Sky
            if (n.level === 1 || n.level === 2) {
                if (!n.label) continue;

                const isBook = n.level === 2;
                const color = isBook ? "#ffffff" : "#38bdf8";

                const labelSprite = createTextSprite(n.label, color);
                if (!labelSprite) continue;

                labelSprite.position.set(x, y, z);
                labelSprite.userData = { id: n.id, level: n.level, interactive: isBook };

                // Division labels: bigger, static; Book labels: smaller, dynamic
                const baseScale = isBook ? 3.0 : 7.0;
                labelSprite.scale.multiplyScalar(baseScale);

                root.add(labelSprite);
                meshById.set(n.id, labelSprite);

                if (isBook) {
                    dynamicObjects.push({ obj: labelSprite, initialScale: labelSprite.scale.clone(), type: "label" });
                }
            }
        }

        // Apply visuals to any sprites we built (stars in basic mode, labels always)
        applyVisuals({ model: laidOut, cfg, meshById });

        // Build chapter points if cinematic
        if (mode === "cinematic") {
            buildChapterPoints(laidOut, cfg);
        }

        // Constellation lines (sequential)
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x445566,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        // group chapters by book
        const bookMap = new Map<string, SceneNode[]>();
        for (const n of laidOut.nodes) {
            if (n.level === 3 && n.parent) {
                const list = bookMap.get(n.parent) ?? [];
                list.push(n);
                bookMap.set(n.parent, list);
            }
        }

        for (const [bookId, chapters] of bookMap.entries()) {
            chapters.sort((a, b) => {
                const cA = (a.meta?.chapter as number) || 0;
                const cB = (b.meta?.chapter as number) || 0;
                return cA - cB;
            });

            if (chapters.length < 2) continue;

            const points: THREE.Vector3[] = [];
            for (const c of chapters) {
                const p = getRenderedNodePosition(c.id);
                if (p) points.push(p);
            }
            if (points.length < 2) continue;

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geo, lineMat.clone());
            (line.userData as any).baseOpacity = 0.3;

            root.add(line);
            lineByBookId.set(bookId, line);
        }

        // Ensure focus mask is reset after rebuild
        setChapterFocusMask(null);
        hoveredLineBookId = null;

        // Postprocessing for this build
        configurePostProcessing(mode, cfg);

        resize();
    }

    // ---------------------------
    // Focus (dims unrelated nodes + lines, and updates chapter point mask)
    // ---------------------------
    let focusAnimRaf = 0;

    function cancelFocusAnim() {
        if (focusAnimRaf) {
            cancelAnimationFrame(focusAnimRaf);
            focusAnimRaf = 0;
        }
    }

    function getControlsAnglesSafe() {
        // OrbitControls stores spherical coords internally; these getters are stable
        return {
            azimuth: controls.getAzimuthalAngle(),
            polar: controls.getPolarAngle(),
        };
    }

    function setControlsAnglesSafe(azimuth: number, polar: number) {
        // Clamp to our allowed range
        const clampedPolar = THREE.MathUtils.clamp(polar, controls.minPolarAngle, controls.maxPolarAngle);
        controls.setAzimuthalAngle(azimuth);
        controls.setPolarAngle(clampedPolar);
        controls.update();
    }

    function aimAtWorldPoint(targetPos: THREE.Vector3) {
        const v = targetPos.clone().normalize();
        // Convert direction to OrbitControls angles
        // OrbitControls uses spherical coords: polar is angle from positive Y, azimuth around Y.
        const polar = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));
        const azimuth = Math.atan2(v.x, v.z);
        return { targetAz: azimuth, targetPolar: polar };
    }

    function animateFocusTo(target: THREE.Object3D | THREE.Vector3) {
        cancelFocusAnim();

        const { azimuth: startAz, polar: startPolar } = getControlsAnglesSafe();
        const startFov = camera.fov;

        const targetPos =
            target instanceof THREE.Object3D ? target.getWorldPosition(new THREE.Vector3()) : target;

        const { targetAz, targetPolar } = aimAtWorldPoint(targetPos);
        const endFov = clampFov(env.focusZoomFov!);

        const start = performance.now();
        const dur = Math.max(120, env.focusDurationMs || 650);

        const tick = () => {
            const t = (performance.now() - start) / dur;
            const k = t >= 1 ? 1 : (1 - Math.pow(1 - t, 3)); // easeOutCubic

            const curAz = THREE.MathUtils.lerp(startAz, targetAz, k);
            const curPolar = THREE.MathUtils.lerp(startPolar, targetPolar, k);
            setControlsAnglesSafe(curAz, curPolar);

            camera.fov = THREE.MathUtils.lerp(startFov, endFov, k);
            camera.updateProjectionMatrix();
            targetFov = camera.fov;

            if (t < 1) {
                focusAnimRaf = requestAnimationFrame(tick);
            } else {
                focusAnimRaf = 0;
            }
        };

        focusAnimRaf = requestAnimationFrame(tick);
    }

    function applyFocus(targetId: string | undefined, animate: boolean = true) {
        if (!targetId) {
            // Reset: show all full opacity
            for (const mesh of meshById.values()) {
                mesh.traverse((obj: any) => {
                    if (obj.material) obj.material.opacity = 1.0;
                });
                (mesh.userData as any).interactive = true;
            }
            for (const [bookId] of lineByBookId.entries()) {
                setLineBaseOpacity(bookId, 0.3);
            }
            setChapterFocusMask(null);
            return;
        }

        // Build downward graph
        const childrenMap = new Map<string, string[]>();
        for (const n of nodeById.values()) {
            if (n.parent) {
                const list = childrenMap.get(n.parent) ?? [];
                list.push(n.id);
                childrenMap.set(n.parent, list);
            }
        }

        // Find all descendants of targetId
        const activeIds = new Set<string>();
        const queue = [targetId];
        activeIds.add(targetId);

        while (queue.length > 0) {
            const curr = queue.pop()!;
            const kids = childrenMap.get(curr);
            if (kids) {
                for (const k of kids) {
                    activeIds.add(k);
                    queue.push(k);
                }
            }
        }

        // Update sprites/meshes
        for (const [id, mesh] of meshById.entries()) {
            const isActive = activeIds.has(id);
            const opacity = isActive ? 1.0 : 0.1;

            mesh.traverse((obj: any) => {
                if (obj.material) obj.material.opacity = opacity;
            });

            (mesh.userData as any).interactive = isActive;
        }

        // Update lines (by book id)
        for (const [bookId] of lineByBookId.entries()) {
            const isActive = activeIds.has(bookId);
            setLineBaseOpacity(bookId, isActive ? 0.3 : 0.05);
        }

        // Update chapter points mask
        setChapterFocusMask(activeIds);

        // Animate focus
        if (animate) {
            const p = getRenderedNodePosition(targetId);
            if (p) animateFocusTo(p);
        }
    }

    // ---------------------------
    // Drag controls (editable mode)
    // ---------------------------
    function getFullArrangement(): StarArrangement {
        const arr: StarArrangement = {};
        for (const id of nodeById.keys()) {
            const p = getRenderedNodePosition(id);
            if (!p) continue;
            arr[id] = { position: [p.x, p.y, p.z] };
        }
        return arr;
    }

    function updateDragControls(editable: boolean) {
        if (!editable) {
            if (dragControls) {
                dragControls.dispose();
                dragControls = null;
            }
            return;
        }

        // Gather draggable objects:
        // - Book labels (level 2)
        // - Chapter stars (level 3) only when in basic mode (sprites exist)
        const draggables: THREE.Object3D[] = [];

        for (const [id, mesh] of meshById.entries()) {
            const node = nodeById.get(id);
            if (!node) continue;

            if (node.level === 2 && mesh instanceof THREE.Sprite) {
                draggables.push(mesh);
            } else if (node.level === 3 && currentRenderMode === "basic") {
                draggables.push(mesh);
            }
        }

        if (dragControls) {
            dragControls.dispose();
            dragControls = null;
        }

        if (draggables.length === 0) return;

        dragControls = new DragControls(draggables, camera, renderer.domElement);

        const lastPos = new THREE.Vector3();

        dragControls.addEventListener("dragstart", (event: any) => {
            controls.enabled = false;
            isDragging = true;
            lastPos.copy(event.object.position);
        });

        dragControls.addEventListener("drag", (event: any) => {
            const obj = event.object;
            const id = obj.userData.id as string | undefined;
            if (!id) return;

            const node = nodeById.get(id);
            if (!node) return;

            if (node.level === 2) {
                // Book Label Drag -> Move constellation (all chapter nodes for that book)
                const currentPos = obj.position;
                const delta = new THREE.Vector3().subVectors(currentPos, lastPos);

                const bookId = id;
                for (const [nId, n] of nodeById.entries()) {
                    if (n.parent === bookId && n.level === 3) {
                        translateRenderedNodeById(nId, delta);
                    }
                }

                updateBookLine(bookId);
                lastPos.copy(currentPos);
            } else if (node.level === 3) {
                // Chapter Star Drag -> Update its parent line
                if (node.parent) updateBookLine(node.parent);
            }
        });

        dragControls.addEventListener("dragend", () => {
            controls.enabled = true;
            setTimeout(() => {
                isDragging = false;
            }, 0);

            if (currentConfig) {
                handlers.onArrangementChange?.(getFullArrangement());
            }
        });
    }

    // ---------------------------
    // Picking / Hover / Click
    // ---------------------------
    function pick(ev: MouseEvent | PointerEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);

        raycaster.setFromCamera(pointer, camera);

        const hits = raycaster.intersectObjects(root.children, true);

        for (const h of hits) {
            const obj = h.object as any;

            if (obj.type === "Sprite" || obj.type === "Mesh") {
                if (obj.userData?.interactive === false) continue;
                const id = obj.userData?.id as string | undefined;
                if (!id) continue;
                return nodeById.get(id);
            }

            if (obj.type === "Points" && obj.userData?.kind === "chapterPoints") {
                const idx = (h as any).index as number | undefined;
                if (idx === undefined) continue;

                const id = chapterPointIds[idx];
                if (!id) continue;

                // Respect focus mask: don't pick inactive points
                if (focusActiveIds && !focusActiveIds.has(id)) continue;

                return nodeById.get(id);
            }
        }

        return undefined;
    }

    function onPointerMove(ev: PointerEvent) {
        const node = pick(ev);
        const nextId = node?.id ?? null;

        // Restore previous hovered line
        if (hoveredLineBookId && hoveredLineBookId !== (node?.parent ?? null)) {
            const line = lineByBookId.get(hoveredLineBookId);
            if (line) {
                const base = (line.userData as any).baseOpacity ?? 0.3;
                (line.material as THREE.LineBasicMaterial).opacity = base;
            }
            hoveredLineBookId = null;
        }

        if (nextId !== hoveredId) {
            hoveredId = nextId;

            // Hide hover label
            hideHoverLabel();

            // Show hover label for chapters
            if (node && node.level === 3 && node.label) {
                setHoverLabel(node.label, "#ffffff");

                const p = getRenderedNodePosition(node.id);
                if (p && hoverLabelSprite) {
                    // Offset label slightly outward along the radial direction
                    const dir = p.clone().normalize();
                    hoverLabelSprite.position.copy(p).addScaledVector(dir, 6);
                    hoverLabelSprite.visible = true;
                }

                // Brighten lines on hover
                if (node.parent) {
                    const line = lineByBookId.get(node.parent);
                    if (line) {
                        (line.material as THREE.LineBasicMaterial).opacity = 0.8;
                        hoveredLineBookId = node.parent;
                    }
                }
            }

            handlers.onHover?.(node);
        }
    }

    function onPointerDown() {
        isDragging = false;
    }

    function onPointerUp(ev: PointerEvent) {
        if (isDragging) return;

        const node = pick(ev);
        if (!node) return;

        handlers.onSelect?.(node);

        if (env.focusOnSelect) {
            const p = getRenderedNodePosition(node.id);
            if (p) animateFocusTo(p);
        }
    }

    // ---------------------------
    // Zoom / double-click behaviour
    // ---------------------------
    const onWheelFov = (ev: WheelEvent) => {
        ev.preventDefault();

        // Trackpad pinch on macOS tends to come through as wheel w/ ctrlKey=true
        const pinch = ev.ctrlKey ? 0.55 : 1.0;
        const intensity = env.fovWheelSensitivity! * pinch;

        // Exponential zoom for telescope-like feel
        const factor = Math.exp(ev.deltaY * intensity);
        targetFov = clampFov(targetFov * factor);
    };

    const onDblClick = (ev: MouseEvent) => {
        const node = pick(ev);
        if (node) {
            const p = getRenderedNodePosition(node.id);
            if (p) {
                animateFocusTo(p);
                return;
            }
        }

        if (!env.resetFovOnDblClick) return;
        targetFov = env.defaultFov!;
    };

    // ---------------------------
    // Model/config plumbing
    // ---------------------------
    let lastData: any = undefined;
    let lastAdapter: any = undefined;
    let lastModel: SceneModel | undefined = undefined;

    function setConfig(cfg: StarMapConfig) {
        currentConfig = cfg;

        let shouldRebuild = false;
        let model = cfg.model;

        // Resolve model from adapter/data
        if (!model && cfg.data && cfg.adapter) {
            if (cfg.data !== lastData || cfg.adapter !== lastAdapter) {
                model = cfg.adapter(cfg.data);
                shouldRebuild = true;
                lastData = cfg.data;
                lastAdapter = cfg.adapter;
                lastModel = model;
            } else {
                model = lastModel;
            }
        } else if (model) {
            // direct model: safest behaviour is rebuild
            shouldRebuild = true;
            lastModel = model;
            lastData = undefined;
            lastAdapter = undefined;
        }

        const nextMode = resolveRenderMode(cfg);
        if (nextMode !== currentRenderMode) {
            shouldRebuild = true;
        }

        if (shouldRebuild && model) {
            currentRenderMode = nextMode;
            buildFromModel(model, cfg, nextMode);
        } else {
            // Apply arrangement deltas without rebuild
            if (cfg.arrangement) {
                const touchedBooks = new Set<string>();

                for (const [id, val] of Object.entries(cfg.arrangement as any)) {
                    const pos = val.position as [number, number, number];
                    setRenderedNodePosition(id, new THREE.Vector3(pos[0], pos[1], pos[2]));

                    const n = nodeById.get(id);
                    if (n) {
                        (n.meta as any).x = pos[0];
                        (n.meta as any).y = pos[1];
                        (n.meta as any).z = pos[2];
                        if (n.parent && n.level === 3) touchedBooks.add(n.parent);
                    }
                }

                for (const b of touchedBooks) updateBookLine(b);
            }

            // Post processing might change even without rebuild
            configurePostProcessing(currentRenderMode, cfg);
        }

        // Apply focus
        if (cfg.focus?.nodeId) {
            applyFocus(cfg.focus.nodeId, cfg.focus.animate);
        } else {
            applyFocus(undefined, false);
        }

        updateDragControls(!!cfg.editable);
    }

    function setHandlers(next: Handlers) {
        handlers = next;
    }

    // ---------------------------
    // Resize
    // ---------------------------
    function resize() {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();

        if (composer) {
            composer.setSize(w, h);
        }
    }

    // ---------------------------
    // Lifecycle
    // ---------------------------
    function start() {
        if (running) return;
        running = true;

        resize();
        window.addEventListener("resize", resize);

        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointerup", onPointerUp);
        renderer.domElement.addEventListener("wheel", onWheelFov, { passive: false });
        renderer.domElement.addEventListener("dblclick", onDblClick);

        const objPos = new THREE.Vector3();
        const objDir = new THREE.Vector3();
        const cameraDir = new THREE.Vector3();

        const tick = () => {
            raf = requestAnimationFrame(tick);

            // Smooth zoom
            if (Math.abs(camera.fov - targetFov) > 0.001) {
                camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, env.zoomLerp!);
                camera.updateProjectionMatrix();
            }

            // Damping rotation sensitivity based on zoom level
            // More aggressive slowdown when zoomed in
            const zoomRatio = camera.fov / (env.defaultFov || 80);
            controls.rotateSpeed = Math.max(0.25, Math.pow(zoomRatio, 1.2));

            // Improve points raycasting threshold as you zoom in/out
            raycaster.params.Points!.threshold = THREE.MathUtils.clamp(14 * zoomRatio, 2, 20);

            // Dynamic scaling & fade for labels (keep readable, but reduce clutter)
            const fov = camera.fov;
            const minZoomFov = 15;
            const scaleFactor = Math.max(1, 1 + (fov - minZoomFov) * 0.05);

            camera.getWorldDirection(cameraDir);

            for (const item of dynamicObjects) {
                if (item.type === "star" && currentRenderMode === "basic") {
                    const s = item.initialScale.clone().multiplyScalar(scaleFactor);
                    item.obj.scale.copy(s);
                } else if (item.type === "label") {
                    const s = item.initialScale.clone().multiplyScalar(scaleFactor * 0.75);
                    item.obj.scale.copy(s);

                    const sprite = item.obj as THREE.Sprite;

                    sprite.getWorldPosition(objPos);
                    objDir.subVectors(objPos, camera.position).normalize();

                    const dot = cameraDir.dot(objDir);

                    const fullVisibleDot = 0.96;
                    const invisibleDot = 0.88;

                    let opacity = 0;
                    if (dot >= fullVisibleDot) opacity = 1;
                    else if (dot > invisibleDot) opacity = (dot - invisibleDot) / (fullVisibleDot - invisibleDot);

                    // Smooth enough for now
                    (sprite.material as THREE.SpriteMaterial).opacity = opacity;
                    sprite.visible = opacity > 0.01;

                    // Optionally modulate matching line opacity, but preserve focus/hover base opacity
                    const bookId = sprite.userData.id as string | undefined;
                    if (bookId) {
                        const line = lineByBookId.get(bookId);
                        if (line && hoveredLineBookId !== bookId) {
                            const base = (line.userData as any).baseOpacity ?? 0.3;
                            (line.material as THREE.LineBasicMaterial).opacity = THREE.MathUtils.clamp(base * (0.4 + opacity * 0.9), 0, 1);
                        }
                    }
                }
            }

            // Update cinematic uniforms
            if (chapterMat) {
                chapterMat.uniforms.uTime.value = performance.now();
                chapterMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
                chapterMat.uniforms.uInactiveDim.value = env.inactiveDim!;
                chapterMat.uniforms.uTwinkleStrength.value = env.starTwinkleStrength!;
            }

            controls.update();

            if (composer) composer.render();
            else renderer.render(scene, camera);
        };

        tick();
    }

    function stop() {
        running = false;
        cancelAnimationFrame(raf);
        cancelFocusAnim();

        window.removeEventListener("resize", resize);

        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener("wheel", onWheelFov as any);
        renderer.domElement.removeEventListener("dblclick", onDblClick);
    }

    function dispose() {
        stop();

        clearRoot();

        for (const child of [...groundGroup.children]) {
            groundGroup.remove(child);
            disposeObject(child);
        }
        for (const child of [...backdropGroup.children]) {
            backdropGroup.remove(child);
            disposeObject(child);
        }

        if (hoverLabelTex) hoverLabelTex.dispose();

        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
    }

    return { setConfig, start, stop, dispose, setHandlers, getFullArrangement };
}
