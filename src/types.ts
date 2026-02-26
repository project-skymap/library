import type { Vec3 } from "./engine/projections";

export type StarId = string;
export type ConstellationId = string;
export type NodeId = StarId | ConstellationId;

export type StarRecord = {
    id: StarId;
    ra: number;
    dec: number;
    vmag: number;
    proper?: string;
};

export type ConstellationRecord = {
    id: ConstellationId;
    name: string;
    centerRa: number;
    centerDec: number;
    lines: [StarId, StarId][];
};

export type SceneNode = {
    id: string;
    label: string;
    level: number; // 0: root, 1: testament, 2: book, 3: chapter
    parent?: string;
    children?: string[];
    weight?: number; // e.g., number of verses
    icon?: string;
    meta?: Record<string, unknown>; // ra, dec, book, chapter, etc.
};

export type SceneModel = {
    nodes: SceneNode[];
    links?: SceneLink[];
    meta?: Record<string, unknown>;
};

export type LayoutAlgorithm = "phyllotaxis" | "voronoi";

export type LayoutConfig = {
    algorithm: LayoutAlgorithm;
    radius?: number;
    // Voronoi specific
    voronoi?: {
        width: number;
        height: number;
    }
};

export type StarArrangement = {
    [id: string]: {
        position: [number, number, number];
    }
};

export type StarMapConfig = {
    // Data
    data?: any;
    adapter?: (data: any) => SceneModel;
    model?: SceneModel;
    
    // Layout & Arrangement
    layout: LayoutConfig;
    arrangement?: StarArrangement;
    polygons?: Record<string, [number, number][]>;

    // Visuals
    background?: string; // "transparent" or hex color
    labelColors?: Record<string, string>; // key: book id (e.g. "GEN"), value: hex color
    constellations?: any; // constellation data
    showConstellationArt?: boolean;
    constellationBaseOpacity?: number; // Multiplier for all constellation artwork opacity (default 1.0).
    showConstellationLines?: boolean;
    showDivisionBoundaries?: boolean;
    showBackdropStars?: boolean;
    backdropStarsCount?: number;
    showAtmosphere?: boolean;
    starSizeExponent?: number; // Power curve exponent for weight→size mapping. Default 2.8. Higher = more dramatic spread.
    starSizeScale?: number;    // Uniform multiplier applied to all star sizes. Default 1.0.
    showBookLabels?: boolean;
    showChapterLabels?: boolean;
    showDivisionLabels?: boolean;
    showGroupLabels?: boolean;
    groups?: Record<string, { name: string, start: number, end: number }[]>;

    // Interaction & Camera
    editable?: boolean;
    projection?: "perspective" | "stereographic" | "blended";
    camera?: { lon?: number, lat?: number };
    fitProjection?: boolean;
};

export type SceneLink = {
    source: string;
    target: string;
};

export type ConstellationConfig = {
    version: number;
    atlasBasePath: string;
    constellations: {
        id: string;
        title: string;
        type: string;
        image: string;
        anchors: string[];
        center: null | [number, number];
        radius: number;
        rotationDeg: number;
        aspectRatio?: number;
        opacity: number;
        blend: string;
        zBias: number;
        linePaths?: {
            weight?: "thin" | "normal" | "bold";
            nodes: string[];
        }[];
        lineSegments?: {
            weight?: "thin" | "normal" | "bold";
            from: string;
            to: string;
        }[];
        fade: {
            zoomInStart: number;
            zoomInEnd: number;
            hoverBoost: number;
            minOpacity: number;
            maxOpacity: number;
        }
    }[];
};

export type ConstellationItem = ConstellationConfig['constellations'][number];

export type HierarchyFilter = {
    testament?: string;
    division?: string;
    bookKey?: string;
};
