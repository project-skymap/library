export type SceneNode = {
    id: string;
    label: string;
    level: number; // 0=testament, 1=division, 2=book, 3=chapter, etc.
    parent?: string;

    weight?: number;
    icon?: string;

    // computed visuals (optional)
    color?: string;
    size?: number;

    meta?: Record<string, unknown>;
};

export type SceneLink = { source: string; target: string };

export type SceneModel = {
    meta?: Record<string, unknown>;
    nodes: SceneNode[];
    links: SceneLink[];
};

export type ConstellationItem = {
    id: string;
    title: string;
    type: "book" | "division" | "custom";
    image: string;
    anchors: string[];
    center: [number, number, number] | null;
    radius: number;
    rotationDeg: number;
    aspectRatio?: number;
    opacity: number;
    blend: "normal" | "additive" | "screen";
    zBias: number;
    fade: {
        zoomInStart: number;
        zoomInEnd: number;
        hoverBoost: number;
        minOpacity: number;
        maxOpacity: number;
    };
};

export type ConstellationConfig = {
    version: number;
    atlasBasePath: string;
    constellations: ConstellationItem[];
};

export type Vector3Arr = [number, number, number];
export type StarArrangement = Record<string, { position: Vector3Arr }>;

export type VisualRule =
    | { when: Record<string, unknown>; value: string } // e.g. color rule
    | { when: Record<string, unknown>; field: keyof SceneNode; scale: [number, number] };

export type StarMapConfig = {
    background?: string;
    camera?: { fov?: number; z?: number; lon?: number; lat?: number };

    // Arrangement overrides
    arrangement?: StarArrangement;
    polygons?: Record<string, Vector3Arr[]>;
    editable?: boolean;
    constellations?: ConstellationConfig;

    // Display Toggles
    showBookLabels?: boolean;
    showDivisionLabels?: boolean;
    showChapterLabels?: boolean;
    showConstellationLines?: boolean;
    showDivisionBoundaries?: boolean;
    showConstellationArt?: boolean;

    // Either provide nodes/links directly, or a raw dataset + adapter
    model?: SceneModel;
    data?: any;
    adapter?: (data: any) => SceneModel;

    visuals?: {
        colorBy?: Array<{ when: Record<string, unknown>; value: string }>;
        sizeBy?: Array<{ when: Record<string, unknown>; field: "weight"; scale: [number, number] }>;
    };

    focus?: {
        nodeId?: string;
        animate?: boolean;
    };

    layout?: {
        mode?: "radial" | "grid" | "force" | "spherical" | "manual";
        radius?: number; // radial
        chapterRingSpacing?: number;
    };
};
