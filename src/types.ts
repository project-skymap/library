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
        position?: [number, number, number];  // star / label position
        center?: [number, number, number];    // constellation art center
        rotationDeg?: number;                 // constellation art rotation override
        radius?: number;                      // constellation art size override
    }
};

export type LabelClassKey = "division" | "book" | "group" | "chapter";

export type LabelClassBehavior = {
    minFov?: number;
    maxFov?: number;
    priority?: number;
    mode?: "floating" | "pinned";
    maxOverlapPx?: number;
    radialFadeStart?: number;
    radialFadeEnd?: number;
    fadeDuration?: number;
};

export type LabelBehaviorConfig = {
    hideBackFacing?: boolean;
    overlapPaddingPx?: number;
    reappearDelayMs?: number;
    classes?: Partial<Record<LabelClassKey, LabelClassBehavior>>;
};

export type HorizonSamplePoint = {
    azDeg: number;
    altDeg: number;
};

export type HorizonProfile = {
    listMode?: "azDeg_altDeg";
    angleRotateZDeg?: number;
    points: HorizonSamplePoint[];
};

export type HorizonAtmosphereConfig = {
    fogVisible?: boolean;
    fogBandTopAltDeg?: number;
    fogBandBottomAltDeg?: number;
    fogIntensity?: number;
    minimalBrightness?: number;
    minimalAltitudeDeg?: number;
};

export type HorizonThemeConfig = {
    id: string;
    label: string;
    source: "procedural" | "polygonal" | "fisheye" | "spherical";
    profile?: HorizonProfile;
    groundColor?: string;
    horizonLineColor?: string;
    horizonLineThickness?: number;
    atmosphere?: HorizonAtmosphereConfig;
    notes?: string;
};

export type SceneMechanicsDebugConfig = {
    projectionBlendOverride?: number | null; // null = normal, 0..1 forces blended projection factor
    disableZenithBias?: boolean;
    disableZenithFlatten?: boolean;
    disableHorizonTheme?: boolean;
    horizonDiagnostics?: boolean;
    freezeBandStartFov?: number;
    freezeBandEndFov?: number;
    zenithBiasStartFov?: number;
    verticalPanDampStartFov?: number;
    verticalPanDampEndFov?: number;
    verticalPanDampLatStartDeg?: number;
    verticalPanDampLatEndDeg?: number;
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
    backdropWideFovGain?: number; // Multiplier at wide FOV (0..1). Lower = dimmer backdrop when zoomed out.
    backdropSizeExponent?: number; // Exponent for backdrop scaling with uScale (0.5..1.2). Higher = shrinks more at wide FOV.
    backdropEnergy?: number; // Backdrop color energy multiplier (recommended 1.0..3.0).
    showAtmosphere?: boolean;
    showMoon?: boolean;          // Procedural moon (default: true)
    showSunrise?: boolean;       // Procedural sun at horizon (default: true)
    showMilkyWay?: boolean;      // Procedural galactic band (default: true)
    starSizeExponent?: number; // Power curve exponent for weight→size mapping. Default 2.8. Higher = more dramatic spread.
    starSizeScale?: number;    // Uniform multiplier applied to all star sizes. Default 1.0.
    starSizeWeightPercentile?: number; // Percentile (0–1) used as the effective max weight for size normalisation. Default 0.95. Lower → outliers capped sooner, distribution spreads more evenly.
    starZoomReveal?: boolean;          // Zoom-based star reveal system. Default true. Set false to show all stars at all zoom levels.
    showBookLabels?: boolean;
    showChapterLabels?: boolean;
    showDivisionLabels?: boolean;
    showGroupLabels?: boolean;
    labelBehavior?: LabelBehaviorConfig;
    groups?: Record<string, { name: string, start: number, end: number }[]>;
    horizonTheme?: HorizonThemeConfig;
    horizonThemes?: HorizonThemeConfig[];

    // Interaction & Camera
    editable?: boolean;
    projection?: "perspective" | "stereographic" | "blended";
    camera?: { lon?: number, lat?: number };
    fitProjection?: boolean;
    debug?: {
        sceneMechanics?: SceneMechanicsDebugConfig;
    };
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
