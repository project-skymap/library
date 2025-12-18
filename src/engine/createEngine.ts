import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import type { StarMapConfig, SceneModel, SceneNode } from "../types";
import { computeLayoutPositions } from "./layout";
import { applyVisuals } from "./materials";

type Handlers = {
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
};

export function createEngine({
                                 container,
                                 onSelect,
                                 onHover
                             }: {
    container: HTMLDivElement;
    onSelect?: Handlers["onSelect"];
    onHover?: Handlers["onHover"];
}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    camera.position.set(0, 0, 400);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const root = new THREE.Group();
    scene.add(root);

    let raf = 0;
    let running = false;
    let handlers: Handlers = { onSelect, onHover };
    let hoveredId: string | null = null;
    let isDragging = false;

    const nodeById = new Map<string, SceneNode>();
    const meshById = new Map<string, THREE.Object3D>();

    function resize() {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }


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

        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        
        const targetHeight = 2;
        const aspect = w / h;
        sprite.scale.set(targetHeight * aspect, targetHeight, 1);
        
        return sprite;
    }

    function clearRoot() {
        for (const child of [...root.children]) {
            root.remove(child);
            disposeObject(child);
        }
        nodeById.clear();
        meshById.clear();
    }

    function buildFromModel(model: SceneModel, cfg: StarMapConfig) {
        clearRoot();

        // background + camera
        if (cfg.background) scene.background = new THREE.Color(cfg.background);
        if (cfg.camera?.fov) camera.fov = cfg.camera.fov;
        if (typeof cfg.camera?.z === "number") camera.position.z = cfg.camera.z;
        camera.updateProjectionMatrix();

        const laidOut = computeLayoutPositions(model, cfg.layout);

        // Create meshes
        for (const n of laidOut.nodes) {
            nodeById.set(n.id, n);

            const geom = new THREE.SphereGeometry(1, 16, 16);
            const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });

            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set((n.meta?.x as number) ?? 0, (n.meta?.y as number) ?? 0, (n.meta?.z as number) ?? 0);

            // Add Label
            if (n.label) {
                const labelSprite = createTextSprite(n.label);
                if (labelSprite) {
                    labelSprite.position.set(0, 2.5, 0); 
                    labelSprite.visible = n.level < 3; // only show higher levels by default
                    mesh.add(labelSprite);
                }
            }

            mesh.userData = { id: n.id, level: n.level };
            root.add(mesh);
            meshById.set(n.id, mesh);
        }

        // Apply visuals (color/size rules)
        applyVisuals({ model: laidOut, cfg, meshById });

        resize();
    }

    function setConfig(cfg: StarMapConfig) {
        let model = cfg.model;
        if (!model && cfg.data && cfg.adapter) {
            model = cfg.adapter(cfg.data);
        }

        if (!model) {
            clearRoot();
            return;
        }
        buildFromModel(model, cfg);
    }

    function setHandlers(next: Handlers) {
        handlers = next;
    }

    function pick(ev: PointerEvent) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);

        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(root.children, true);
        // Only pick the spheres (not their labels)
        const hit = hits.find(h => h.object.type === "Mesh");
        const id = hit?.object?.userData?.id as string | undefined;
        return id ? nodeById.get(id) : undefined;
    }

    function onPointerMove(ev: PointerEvent) {
        const node = pick(ev);
        const nextId = node?.id ?? null;
        
        if (nextId !== hoveredId) {
            // Restore previous hovered visibility if it was level 3
            if (hoveredId) {
                const prevMesh = meshById.get(hoveredId);
                const prevNode = nodeById.get(hoveredId);
                if (prevMesh && prevNode && prevNode.level === 3) {
                    const label = prevMesh.children.find(c => c instanceof THREE.Sprite);
                    if (label) label.visible = false;
                }
            }

            hoveredId = nextId;

            // Show current hovered visibility if it is level 3
            if (nextId) {
                const mesh = meshById.get(nextId);
                const n = nodeById.get(nextId);
                if (mesh && n && n.level === 3) {
                    const label = mesh.children.find(c => c instanceof THREE.Sprite);
                    if (label) label.visible = true;
                }
            }

            handlers.onHover?.(node);
        }
    }

    function onPointerDown(ev: PointerEvent) {
        isDragging = false;
    }

    function onPointerUp(ev: PointerEvent) {
        if (isDragging) return;
        const node = pick(ev);
        if (node) handlers.onSelect?.(node);
    }

    function onChange() {
        isDragging = true;
    }

    function start() {
        if (running) return;
        running = true;

        window.addEventListener("resize", resize);
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerdown", onPointerDown);
        renderer.domElement.addEventListener("pointerup", onPointerUp);
        controls.addEventListener("change", onChange);

        const tick = () => {
            raf = requestAnimationFrame(tick);
            controls.update();
            renderer.render(scene, camera);
        };
        tick();
    }

    function stop() {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        controls.removeEventListener("change", onChange);
    }

    function dispose() {
        stop();
        clearRoot();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
    }

    return { setConfig, start, stop, dispose, setHandlers };
}
