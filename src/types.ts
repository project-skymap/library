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
    nodes: SceneNode[];
    links: SceneLink[];
};

export type VisualRule =
    | { when: Record<string, unknown>; value: string } // e.g. color rule
    | { when: Record<string, unknown>; field: keyof SceneNode; scale: [number, number] };

export type StarMapConfig = {
    background?: string;
    camera?: { fov?: number; z?: number };

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
        mode?: "radial" | "grid" | "force" | "spherical";
        radius?: number; // radial
        chapterRingSpacing?: number;
    };
};
