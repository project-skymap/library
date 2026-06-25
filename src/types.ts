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
    fovFadeFeatherDeg?: number;
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

export type HorizonGroundGradientConfig = {
    type: "radial";
    innerColor: string;
    outerColor: string;
    radius?: number;
    intensity?: number;
};

export type HorizonThemeConfig = {
    id: string;
    label: string;
    source: "procedural" | "polygonal" | "fisheye" | "spherical";
    profile?: HorizonProfile;
    groundColor?: string;
    groundGradient?: HorizonGroundGradientConfig;
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
    divisionColors?: Record<string, string>; // key: division name, value: hex color
    // Precomputed division regions (see scripts/analyze-divisions.ts) — the true centroid
    // direction and angular extent of a division's stars, derived from the static arrangement.
    // When present, this is used instead of the runtime book-anchor approximation for both
    // division label placement and the deep-space tint disc.
    divisionRegions?: Record<string, { direction: [number, number, number]; angularRadiusRad: number }>;
    // Precomputed book regions (see builder/app/skymap/shared.ts computeBookRegions) — the
    // true centroid direction and angular extent of a book's chapters, derived from the
    // live arrangement. Used to anchor book label placement.
    bookRegions?: Record<string, { direction: [number, number, number]; angularRadiusRad: number }>;
    constellations?: any; // constellation data
    showConstellationArt?: boolean;
    constellationBaseOpacity?: number; // Multiplier for all constellation artwork opacity (default 1.0).
    showConstellationLines?: boolean;
    constellationLineMode?: "off" | "focused" | "full";
    constellationLineOpacity?: number; // Overall constellation line opacity. Default 0.42.
    constellationLineWidth?: number; // Core constellation line width multiplier. Default 3.0.
    constellationLineGlowIntensity?: number; // Soft line halo strength. Default 0.0.
    constellationLineStarPadding?: number; // World-space gap between chapter stars and line endpoints. Default 18.
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
    starSizeScale?: number;    // Uniform multiplier applied to all star sizes. Values below 1.0 intentionally shrink stars.
    starSizeWeightPercentile?: number; // Percentile (0–1) used as the effective max weight for size normalisation. Default 0.95. Lower → outliers capped sooner, distribution spreads more evenly.
    starSizeOutlierCapMultiplier?: number; // Final base-size cap as a multiple of the largest non-outlier chapter. Default 2.0. Preserves the normal curve while limiting extreme chapters.
    starZoomReveal?: boolean;          // Zoom-based star reveal system. Default true. Set false to show all stars at all zoom levels.
    showBookLabels?: boolean;
    showChapterLabels?: boolean;
    showDivisionLabels?: boolean;
    showDivisionTint?: boolean; // Soft per-division colour wash painted behind the stars (default true)
    // How far a division label is allowed to roam from its true star centroid, as a fraction
    // (0..1+) of its tint disc's angular radius, while settling apart from other division
    // labels via pairwise repulsion. 0 = every label pinned to its centroid (no repulsion).
    // ~0.45 (default) lets crowded divisions push apart while isolated ones stay centred.
    divisionLabelPushFraction?: number;
    // Minimum clearance, in degrees, a division label must keep from the horizon (i.e. from
    // 90° polar angle off the zenith) when the repulsion relaxation pushes it outward. Stops
    // crowded divisions from being shoved right up against the periphery of the zenith view.
    // Default 25.
    divisionLabelHorizonPaddingDeg?: number;
    showGroupLabels?: boolean;
    labelBehavior?: LabelBehaviorConfig;
    groups?: Record<string, { name: string, start: number, end: number }[]>;
    horizonTheme?: HorizonThemeConfig;
    horizonThemes?: HorizonThemeConfig[];

    /**
     * World-space positions of unassigned / marker stars to render as plain
     * orange dots using the same camera and projection as the scene stars.
     * Each entry is [x, y, z] at radius ~2000 (unit hemisphere × 2000).
     */
    markerPositions?: Array<[number, number, number]>;

    // Interaction & Camera
    editable?: boolean;
    projection?: "perspective" | "stereographic" | "blended";
    camera?: { lon?: number, lat?: number, fov?: number };
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
        lineColor?: string;
        opacity: number;
        blend: string;
        zBias: number;
        linePaths?: {
            color?: string;
            weight?: "thin" | "normal" | "bold";
            nodes: string[];
        }[];
        lineSegments?: {
            color?: string;
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
