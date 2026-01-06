import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { DragControls } from "three/examples/jsm/controls/DragControls";
import type { StarMapConfig, SceneModel, SceneNode, StarArrangement } from "../types";
import { computeLayoutPositions } from "./layout";
import { applyVisuals } from "./materials";

type Handlers = {
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
    onArrangementChange?: (arrangement: StarArrangement) => void;
};

type EngineConfig = {
    // Stellarium-ish “stand in the middle and look out”
    skyRadius?: number; // radius for procedural backdrop stars
    groundRadius?: number; // radius of the ground hemisphere used to occlude “below horizon”
    horizonGlow?: boolean;

    // Zoom behaviour (FOV-based)
    defaultFov?: number;
    minFov?: number;
    maxFov?: number;
    fovWheelSensitivity?: number; // deg per wheel deltaY unit (scaled for ctrlKey pinch)
    resetFovOnDblClick?: boolean;

    // Click-to-focus behaviour
    focusOnSelect?: boolean;
    focusZoomFov?: number; // fov to animate to on focus
    focusDurationMs?: number;
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
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);
    // Ensure canvas fills the container (fixes HiDPI center alignment)
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    // Prevent browser gestures from fighting pointer controls
    (renderer.domElement.style as any).touchAction = "none";

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 5000);
    // Tiny offset so OrbitControls has a radius to work with (like your Angular app)
    camera.position.set(0, 0, 0.01);
    camera.up.set(0, 1, 0);

    // ---------------------------
    // Controls: “look around”
    // ---------------------------
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableRotate = true;
    controls.enablePan = false;
    controls.enableZoom = false; // wheel controls FOV (not dolly)
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
    // Stellarium-ish environment
    // ---------------------------
    const env = {
        skyRadius: 2800,
        groundRadius: 995,
        horizonGlow: true,

        defaultFov: 90,
        minFov: 1,
        maxFov: 110,
        fovWheelSensitivity: 0.04,
        resetFovOnDblClick: true,

        focusOnSelect: false,
        focusZoomFov: 18,
        focusDurationMs: 650,
    } satisfies EngineConfig;

    // Ground group: an inside-facing lower hemisphere that WRITES depth
    // => hides below-horizon stars (very Stellarium)
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
            // A simple deep-blue to near-horizon glow-ish ramp
            c.setRGB(
                THREE.MathUtils.lerp(0x06 / 255, 0x15 / 255, t),
                THREE.MathUtils.lerp(0x10 / 255, 0x23 / 255, t),
                THREE.MathUtils.lerp(0x17 / 255, 0x35 / 255, t)
            );
            colors.set([c.r, c.g, c.b], i * 3);
        }
        hemi.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const groundMat = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.FrontSide,
            depthWrite: true, // important: occlude stars under horizon
            depthTest: true,
        });

        const hemiMesh = new THREE.Mesh(hemi, groundMat);
        groundGroup.add(hemiMesh);

        if (env.horizonGlow) {
            const inner = radius * 0.985;
            const outer = radius * 1.005;
            const ringGeo = new THREE.RingGeometry(inner, outer, 128);
            ringGeo.rotateX(-Math.PI / 2);

            const ringMat = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
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
            float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
            // peak glow near inner edge, fade outwards
            float a = pow(1.0 - t, 2.2) * 0.35;
            gl_FragColor = vec4(uColor, a);
          }
        `,
            });

            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.y = 0.0;
            groundGroup.add(ring);
        }
    }

    buildGroundHemisphere(env.groundRadius);

    // Backdrop stars (procedural points) far beyond your “model stars”
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
    const pointer = new THREE.Vector2();

    const root = new THREE.Group();
    scene.add(root);

    let raf = 0;
    let running = false;
    let handlers: Handlers = { onSelect, onHover, onArrangementChange };
    let hoveredId: string | null = null;
    let isDragging = false;
    
    let dragControls: DragControls | null = null;
    let currentConfig: StarMapConfig | undefined;

    const nodeById = new Map<string, SceneNode>();
    const meshById = new Map<string, THREE.Object3D>();
    const lineByBookId = new Map<string, THREE.Line>();
    const dynamicObjects: { obj: THREE.Object3D; initialScale: THREE.Vector3; type: "star" | "label" }[] = [];

    function getFullArrangement(): StarArrangement {
        const arr: StarArrangement = {};
        for (const [id, mesh] of meshById.entries()) {
            arr[id] = {
                position: [mesh.position.x, mesh.position.y, mesh.position.z]
            };
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

        // Gather draggable objects (Level 3 stars)
        const draggables: THREE.Object3D[] = [];
        for (const [id, mesh] of meshById.entries()) {
            const node = nodeById.get(id);
            if (node?.level === 3) {
                draggables.push(mesh);
            }
        }

        if (dragControls) {
            dragControls.dispose();
        }

        dragControls = new DragControls(draggables, camera, renderer.domElement);

        dragControls.addEventListener("dragstart", () => {
            controls.enabled = false;
            isDragging = true;
        });

        dragControls.addEventListener("dragend", (event) => {
            controls.enabled = true;
            setTimeout(() => { isDragging = false; }, 0);

            const obj = event.object;
            const id = obj.userData.id;
            
            if (id && currentConfig) {
                // We update the local mesh position already (done by DragControls)
                // Now we notify the handler with the FULL arrangement
                handlers.onArrangementChange?.(getFullArrangement());
            }
        });
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
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, w / 2, h / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            depthTest: true,
        });

        const sprite = new THREE.Sprite(mat);

        // World-size label (you can later do Stellarium-style pixel fitting if you want)
        const targetHeight = 2;
        const aspect = w / h;
        sprite.scale.set(targetHeight * aspect, targetHeight, 1);

        return sprite;
    }

    function createStarTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d")!;

        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
        gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.8)");
        gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.2)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);

        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    }

    const starTexture = createStarTexture();

    function clearRoot() {
        for (const child of [...root.children]) {
            root.remove(child);
            disposeObject(child);
        }
        nodeById.clear();
        meshById.clear();
        lineByBookId.clear();
        dynamicObjects.length = 0;
    }

    function buildFromModel(model: SceneModel, cfg: StarMapConfig) {
        clearRoot();

        // background + camera
        if (cfg.background && cfg.background !== "transparent") {
            scene.background = new THREE.Color(cfg.background);
        } else {
            scene.background = null;
        }

        // Respect config FOV if provided, otherwise use Stellarium-ish default
        camera.fov = cfg.camera?.fov ?? env.defaultFov;
        camera.updateProjectionMatrix();

        // Default to placing content at a "sky-like" radius if not specified
        const layoutCfg = {
            ...cfg.layout,
            radius: cfg.layout?.radius ?? 2000,
        };
        const laidOut = computeLayoutPositions(model, layoutCfg);

        // Create meshes
        for (const n of laidOut.nodes) {
            nodeById.set(n.id, n);

            let x = (n.meta?.x as number) ?? 0;
            let y = (n.meta?.y as number) ?? 0;
            let z = (n.meta?.z as number) ?? 0;

            if (cfg.arrangement && cfg.arrangement[n.id]) {
                const pos = cfg.arrangement[n.id].position;
                x = pos[0];
                y = pos[1];
                z = pos[2];
            }

            // Level 3: Chapters -> Stars (Sprites)
            if (n.level === 3) {
                const mat = new THREE.SpriteMaterial({ 
                    map: starTexture, 
                    color: 0xffffff,
                    transparent: true,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                });
                const sprite = new THREE.Sprite(mat);

                sprite.position.set(x, y, z);
                sprite.userData = { id: n.id, level: n.level };
                
                // Base size for stars
                const baseScale = 2.0;
                sprite.scale.setScalar(baseScale);

                // Add to dynamic scaling list
                dynamicObjects.push({ obj: sprite, initialScale: sprite.scale.clone(), type: "star" });

                // Hidden label for hover
                if (n.label) {
                    const labelSprite = createTextSprite(n.label);
                    if (labelSprite) {
                        labelSprite.position.set(0, 1.2, 0);
                        labelSprite.visible = false;
                        sprite.add(labelSprite);
                    }
                }

                root.add(sprite);
                meshById.set(n.id, sprite);
            }
            // Level 1 (Division) or 2 (Book) -> Text Labels on the Sky
            else if (n.level === 1 || n.level === 2) {
                if (n.label) {
                    // Level 1 (e.g. "Gospels") vs Level 2 (e.g. "John")
                    const isBook = n.level === 2;
                    const color = isBook ? "#ffffff" : "#38bdf8";
                    
                    // Division labels: smaller, static
                    // Book labels: larger, dynamic
                    const baseScale = isBook ? 3.0 : 7.0; 

                    const labelSprite = createTextSprite(n.label, color); 
                    if (labelSprite) {
                        labelSprite.position.set(x, y, z);
                        labelSprite.scale.multiplyScalar(baseScale);
                        root.add(labelSprite);

                        // Only add Books to dynamicObjects so they scale/fade.
                        // Divisions stay static.
                        if (isBook) {
                            dynamicObjects.push({ obj: labelSprite, initialScale: labelSprite.scale.clone(), type: "label" });
                        }
                    }
                }
            }
        }

        applyVisuals({ model: laidOut, cfg, meshById });


        // ---------------------------
        // Draw Constellation Lines (Sequential)
        // ---------------------------
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x445566,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        // Group by book
        const bookMap = new Map<string, SceneNode[]>();
        for (const n of laidOut.nodes) {
            if (n.level === 3 && n.parent) {
                const list = bookMap.get(n.parent) ?? [];
                list.push(n);
                bookMap.set(n.parent, list);
            }
        }

        for (const [bookId, chapters] of bookMap.entries()) {
            // Sort by chapter number
            chapters.sort((a, b) => {
                const cA = (a.meta?.chapter as number) || 0;
                const cB = (b.meta?.chapter as number) || 0;
                return cA - cB;
            });

            if (chapters.length < 2) continue;

            const points: THREE.Vector3[] = [];
            for (const c of chapters) {
                const x = (c.meta?.x as number) ?? 0;
                const y = (c.meta?.y as number) ?? 0;
                const z = (c.meta?.z as number) ?? 0;
                points.push(new THREE.Vector3(x, y, z));
            }

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geo, lineMat);
            root.add(line);
            lineByBookId.set(bookId, line);
        }

        resize();
    }

    function applyFocus(targetId: string | undefined, animate: boolean = true) {
        if (!targetId) {
            // Reset: show all full opacity
            for (const [id, mesh] of meshById.entries()) {
                mesh.traverse((obj: any) => {
                    if (obj.material) obj.material.opacity = 1.0;
                });
                mesh.userData.interactive = true;
            }
            for (const line of lineByBookId.values()) {
                line.visible = true;
                (line.material as THREE.LineBasicMaterial).opacity = 0.3;
            }
            return;
        }

        // 1. Build downward graph
        const childrenMap = new Map<string, string[]>();
        for (const n of nodeById.values()) {
            if (n.parent) {
                const list = childrenMap.get(n.parent) ?? [];
                list.push(n.id);
                childrenMap.set(n.parent, list);
            }
        }

        // 2. Find all descendants of targetId
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

        // 3. Update visuals and interaction
        for (const [id, mesh] of meshById.entries()) {
            const isActive = activeIds.has(id);
            const opacity = isActive ? 1.0 : 0.1;
            
            mesh.traverse((obj: any) => {
                if (obj.material) obj.material.opacity = opacity;
            });
            
            mesh.userData.interactive = isActive;
        }

        // 4. Update lines
        for (const [bookId, line] of lineByBookId.entries()) {
            const isActive = activeIds.has(bookId);
            (line.material as THREE.LineBasicMaterial).opacity = isActive ? 0.3 : 0.05;
        }

        // 5. Animate (Focus)
        if (animate) {
            const targetMesh = meshById.get(targetId);
            if (targetMesh) {
                animateFocusTo(targetMesh);
            } else {
                // If no direct mesh, find centroid of all visible children
                const sum = new THREE.Vector3();
                let count = 0;
                
                // Iterate over all active IDs (descendants)
                for (const id of activeIds) {
                    const mesh = meshById.get(id);
                    if (mesh) {
                        sum.add(mesh.getWorldPosition(new THREE.Vector3()));
                        count++;
                    }
                }

                if (count > 0) {
                    const centroid = sum.divideScalar(count);
                    animateFocusTo(centroid);
                }
            }
        }
    }

    let lastData: any = undefined;
    let lastAdapter: any = undefined;
    let lastModel: SceneModel | undefined = undefined;

    function setConfig(cfg: StarMapConfig) {
        currentConfig = cfg;
        let shouldRebuild = false;
        let model = cfg.model;

        // 1. Resolve Model and check for changes
        if (!model && cfg.data && cfg.adapter) {
            if (cfg.data !== lastData || cfg.adapter !== lastAdapter) {
                model = cfg.adapter(cfg.data);
                shouldRebuild = true;
                lastData = cfg.data;
                lastAdapter = cfg.adapter;
                lastModel = model;
            } else {
                model = lastModel; // reuse
            }
        } else if (model) {
            // direct model provided: assume it might have changed if strictly equal? 
            // Or just always rebuild if 'model' prop is used directly (simpler).
            shouldRebuild = true;
            lastData = undefined;
            lastAdapter = undefined;
            lastModel = model;
        }

        if (shouldRebuild && model) {
            buildFromModel(model, cfg);
        } else if (cfg.arrangement) {
             // If not rebuilding, apply arrangement positions to existing meshes
             for (const [id, val] of Object.entries(cfg.arrangement)) {
                 const mesh = meshById.get(id);
                 if (mesh) {
                     mesh.position.set(val.position[0], val.position[1], val.position[2]);
                 }
             }
        }

        // 2. Apply Visuals (if not rebuilding, we might still need to update visuals?)
        // For now, let's assume visuals are static unless rebuild happens.
        // Actually, 'applyVisuals' depends on the mesh map which is stable. 
        // If we want to support dynamic visuals without rebuild, we'd call applyVisuals here.
        // But the prompt specifically asked to fix the Zoom Reset issue, which is caused by buildFromModel.
        
        // 3. Apply Focus
        if (cfg.focus?.nodeId) {
            applyFocus(cfg.focus.nodeId, cfg.focus.animate);
        } else {
             // Reset if no focus provided
             applyFocus(undefined, false);
        }
        
        updateDragControls(!!cfg.editable);
    }

    function setHandlers(next: Handlers) {
        handlers = next;
    }

    function pick(ev: MouseEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);

        raycaster.setFromCamera(pointer, camera);
        
        const hits = raycaster.intersectObjects(root.children, true);
        // pick meshes or sprites, but only if they are interactive
        const hit = hits.find((h) => 
            (h.object.type === "Mesh" || h.object.type === "Sprite") && 
            (h.object.userData.interactive !== false)
        );
        const id = hit?.object?.userData?.id as string | undefined;
        return id ? nodeById.get(id) : undefined;
    }

    // ---------------------------
    // Hover logic (labels on L3)
    // ---------------------------
    function onPointerMove(ev: PointerEvent) {
        const node = pick(ev);
        const nextId = node?.id ?? null;

        if (nextId !== hoveredId) {
            // hide previous hovered L3 label
            if (hoveredId) {
                const prevMesh = meshById.get(hoveredId);
                const prevNode = nodeById.get(hoveredId);
                if (prevMesh && prevNode && prevNode.level === 3) {
                    const label = prevMesh.children.find((c) => c instanceof THREE.Sprite);
                    if (label) label.visible = false;
                }
            }

            hoveredId = nextId;

            // show current hovered L3 label
            if (nextId) {
                const mesh = meshById.get(nextId);
                const n = nodeById.get(nextId);
                if (mesh && n && n.level === 3) {
                    const label = mesh.children.find((c) => c instanceof THREE.Sprite);
                    if (label) {
                        label.visible = true;
                        // Since we are using sprites now, they look at camera.
                        // We might want to offset the label so it doesn't overlap the star.
                        label.position.set(0, 0.8, 0); 
                    }

                    // Brighten lines on hover
                    if (n.parent) {
                        const line = lineByBookId.get(n.parent);
                        if (line) (line.material as THREE.LineBasicMaterial).opacity = 0.8;
                    }
                }
            }

            handlers.onHover?.(node);
        }
    }

    function onPointerDown() {
        isDragging = false;
    }

    function onChange() {
        // OrbitControls fires change while dragging
        isDragging = true;
    }

    // ---------------------------
    // Stellarium-ish zoom (FOV)
    // ---------------------------
    const onWheelFov = (ev: WheelEvent) => {
        ev.preventDefault();

        // Trackpad pinch on macOS tends to come through as wheel w/ ctrlKey=true
        const speed = (ev.ctrlKey ? 0.15 : 1) * env.fovWheelSensitivity!;
        const next = THREE.MathUtils.clamp(
            camera.fov + ev.deltaY * speed,
            env.minFov!,
            env.maxFov!
        );

        if (next !== camera.fov) {
            camera.fov = next;
            camera.updateProjectionMatrix();
        }
    };

    const onDblClick = (ev: MouseEvent) => {
        const node = pick(ev);
        if (node) {
            const mesh = meshById.get(node.id);
            if (mesh) {
                animateFocusTo(mesh);
                return;
            }
        }

        if (!env.resetFovOnDblClick) return;
        camera.fov = env.defaultFov!;
        camera.updateProjectionMatrix();
    };

    // ---------------------------
    // Click-to-focus (aim + zoom)
    // ---------------------------
    let focusAnimRaf = 0;

    function cancelFocusAnim() {
        if (focusAnimRaf) cancelAnimationFrame(focusAnimRaf);
        focusAnimRaf = 0;
    }

    function getControlsAnglesSafe() {
        // OrbitControls exposes getAzimuthalAngle/getPolarAngle
        const getAz = (controls as any).getAzimuthalAngle?.bind(controls);
        const getPol = (controls as any).getPolarAngle?.bind(controls);
        return {
            azimuth: typeof getAz === "function" ? getAz() : 0,
            polar: typeof getPol === "function" ? getPol() : Math.PI / 4,
        };
    }

    function setControlsAnglesSafe(azimuth: number, polar: number) {
        // Newer three exposes setAzimuthalAngle / setPolarAngle.
        const setAz = (controls as any).setAzimuthalAngle?.bind(controls);
        const setPol = (controls as any).setPolarAngle?.bind(controls);

        if (typeof setAz === "function" && typeof setPol === "function") {
            setAz(azimuth);
            setPol(polar);
            controls.update();
            return;
        }

        // Fallback: rotate camera directly to look at a direction
        // (keeps the “standing in the middle” feel even if controls lacks setters)
        const dir = new THREE.Vector3();
        dir.setFromSphericalCoords(1, polar, azimuth);
        const lookAt = dir.clone().multiplyScalar(10);
        camera.lookAt(lookAt);
    }

    function aimAtWorldPoint(worldPoint: THREE.Vector3) {
        // We’re “at the origin”, so direction is point normalized.
        // OrbitControls places camera relative to target. To look AT 'dir', camera must be at '-dir'.
        const dir = worldPoint.clone().normalize().negate();
        // Convert direction -> spherical angles compatible with OrbitControls
        // In three: Spherical(phi=polar from +Y, theta=azimuth around Y from +Z toward +X)
        const spherical = new THREE.Spherical().setFromVector3(dir);
        let targetPolar = spherical.phi;
        let targetAz = spherical.theta;

        // Clamp to our allowed range (zenith..horizon)
        targetPolar = THREE.MathUtils.clamp(targetPolar, controls.minPolarAngle, controls.maxPolarAngle);

        return { targetAz, targetPolar };
    }

    function easeInOutCubic(t: number) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animateFocusTo(target: THREE.Object3D | THREE.Vector3) {
        cancelFocusAnim();

        const { azimuth: startAz, polar: startPolar } = getControlsAnglesSafe();
        const startFov = camera.fov;

        const targetPos = target instanceof THREE.Object3D 
            ? target.getWorldPosition(new THREE.Vector3()) 
            : target;

        const { targetAz, targetPolar } = aimAtWorldPoint(targetPos);
        const endFov = THREE.MathUtils.clamp(env.focusZoomFov!, env.minFov!, env.maxFov!);

        const start = performance.now();
        const dur = Math.max(120, env.focusDurationMs || 650);

        const tick = (now: number) => {
            const t = THREE.MathUtils.clamp((now - start) / dur, 0, 1);
            const k = easeInOutCubic(t);

            // Interpolate angles (shortest path for azimuth)
            let dAz = targetAz - startAz;
            // wrap to [-PI, PI]
            dAz = ((dAz + Math.PI) % (Math.PI * 2)) - Math.PI;

            const curAz = startAz + dAz * k;
            const curPolar = THREE.MathUtils.lerp(startPolar, targetPolar, k);
            setControlsAnglesSafe(curAz, curPolar);

            camera.fov = THREE.MathUtils.lerp(startFov, endFov, k);
            camera.updateProjectionMatrix();

            if (t < 1) {
                focusAnimRaf = requestAnimationFrame(tick);
            } else {
                focusAnimRaf = 0;
            }
        };

        focusAnimRaf = requestAnimationFrame(tick);
    }

    function onPointerUp(ev: PointerEvent) {
        if (isDragging) return;

        const node = pick(ev);
        if (!node) return;

        // fire your existing handler
        handlers.onSelect?.(node);

        // optional: also do Stellarium-like “aim + zoom” on select
        if (env.focusOnSelect) {
            const mesh = meshById.get(node.id);
            if (mesh) animateFocusTo(mesh);
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

        // wheel FOV zoom (passive:false so preventDefault works)
        renderer.domElement.addEventListener("wheel", onWheelFov, { passive: false });

        renderer.domElement.addEventListener("dblclick", onDblClick);

        controls.addEventListener("change", onChange);

        const tick = () => {
            raf = requestAnimationFrame(tick);
            
            // Damping rotation sensitivity based on zoom level
            controls.rotateSpeed = camera.fov / (env.defaultFov || 90);
            
            // Dynamic scaling based on FOV (Zoomed out = larger stars/labels)
            // Reference: FOV 15 is "close up" (scale 1x). FOV 90 is "wide" (scale larger).
            // Formula: scale = 1 + (fov - 15) * factor
            const fov = camera.fov;
            const minZoomFov = 15; // The FOV where items should be "normal size"
            
            // Factor to control how much they grow. 
            // We want stars to stay point-like but be visible.
            const scaleFactor = Math.max(1, 1 + (fov - minZoomFov) * 0.05);

            // Gaze-based fading for labels
            const cameraDir = new THREE.Vector3();
            camera.getWorldDirection(cameraDir);
            
            // Re-use vector to avoid GC
            const objPos = new THREE.Vector3();
            const objDir = new THREE.Vector3();

            for (let i = 0; i < dynamicObjects.length; i++) {
                const item = dynamicObjects[i];
                // Scale from INITIAL vector to preserve aspect ratio
                item.obj.scale.copy(item.initialScale).multiplyScalar(scaleFactor);

                // Gaze check for labels
                if (item.type === "label") {
                    const sprite = item.obj as THREE.Sprite;
                    
                    // Get direction to object
                    // Since camera is at 0,0,0 (mostly), direction is just position normalized.
                    // But our camera might be slightly offset (0,0,0.01).
                    // Let's be precise:
                    sprite.getWorldPosition(objPos);
                    objDir.subVectors(objPos, camera.position).normalize();
                    
                    // Dot product: 1.0 = direct center, 0.0 = 90 deg off
                    const dot = cameraDir.dot(objDir);
                    
                    // Define "focus cone"
                    // 1.0 -> 0.95 (approx 18 deg): Full opacity
                    // 0.95 -> 0.85 (approx 30 deg): Fade out
                    // < 0.85: Invisible
                    const fullVisibleDot = 0.96;
                    const invisibleDot = 0.88;
                    
                    let opacity = 0;
                    if (dot >= fullVisibleDot) {
                        opacity = 1;
                    } else if (dot > invisibleDot) {
                        opacity = (dot - invisibleDot) / (fullVisibleDot - invisibleDot);
                    }
                    
                    // Smooth transition or direct? Direct is fine for now, standard lerp.
                    sprite.material.opacity = opacity;
                    sprite.visible = opacity > 0.01;

                    // Also fade the corresponding constellation lines
                    const bookId = nodeById.get(item.obj.userData.id)?.id;
                    if (bookId) {
                        const line = lineByBookId.get(bookId);
                        if (line) {
                            (line.material as THREE.LineBasicMaterial).opacity = 0.05 + opacity * 0.45;
                        }
                    }
                }
            }

            controls.update();
            renderer.render(scene, camera);
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

        controls.removeEventListener("change", onChange);
    }

    function dispose() {
        stop();
        clearRoot();

        // env groups
        for (const child of [...groundGroup.children]) {
            groundGroup.remove(child);
            disposeObject(child);
        }
        for (const child of [...backdropGroup.children]) {
            backdropGroup.remove(child);
            disposeObject(child);
        }

        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
    }

    return { setConfig, start, stop, dispose, setHandlers, getFullArrangement };
}
