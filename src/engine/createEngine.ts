import * as THREE from "three";
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
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    camera.position.set(0, 0, 100);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const root = new THREE.Group();
    scene.add(root);

    let raf = 0;
    let running = false;
    let handlers: Handlers = { onSelect, onHover };
    let hoveredId: string | null = null;

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
                if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.());
                else o.material.dispose?.();
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

            mesh.userData = { id: n.id };
            root.add(mesh);
            meshById.set(n.id, mesh);
        }

        // Apply visuals (color/size rules)
        applyVisuals({ model: laidOut, cfg, meshById });

        resize();
    }

    function setConfig(cfg: StarMapConfig) {
        if (!cfg.model) {
            clearRoot();
            return;
        }
        buildFromModel(cfg.model, cfg);
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
        const id = hits[0]?.object?.userData?.id as string | undefined;
        return id ? nodeById.get(id) : undefined;
    }

    function onPointerMove(ev: PointerEvent) {
        const node = pick(ev);
        const nextId = node?.id ?? null;
        if (nextId !== hoveredId) {
            hoveredId = nextId;
            handlers.onHover?.(node);
        }
    }

    function onPointerDown(ev: PointerEvent) {
        const node = pick(ev);
        if (node) handlers.onSelect?.(node);
    }

    function start() {
        if (running) return;
        running = true;

        window.addEventListener("resize", resize);
        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerdown", onPointerDown);

        const tick = () => {
            raf = requestAnimationFrame(tick);
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
    }

    function dispose() {
        stop();
        clearRoot();
        renderer.dispose();
        renderer.domElement.remove();
    }

    return { setConfig, start, stop, dispose, setHandlers };
}
