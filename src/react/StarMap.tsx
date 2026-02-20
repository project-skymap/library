"use client";

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import type { StarMapConfig, SceneNode, StarArrangement, HierarchyFilter } from "../types";

export type StarMapProps = {
    config: StarMapConfig;
    className?: string;
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
    onArrangementChange?: (arrangement: StarArrangement) => void;
    onFovChange?: (fov: number) => void;
    onLongPress?: (node: SceneNode | null, x: number, y: number) => void;
    testId?: string;
};

export type StarMapHandle = {
    getFullArrangement: () => StarArrangement | undefined;
    getDebugState: () => Record<string, unknown> | undefined;
    setHoveredBook: (id: string | null) => void;
    setFocusedBook: (id: string | null) => void;
    setOrderRevealEnabled: (enabled: boolean) => void;
    setHierarchyFilter: (filter: HierarchyFilter | null) => void;
    flyTo: (nodeId: string, targetFov?: number) => void;
    setProjection: (id: "perspective" | "stereographic" | "blended") => void;
};

export const StarMap = forwardRef<StarMapHandle, StarMapProps>(
    ({ config, className, onSelect, onHover, onArrangementChange, onFovChange, onLongPress, testId }, ref) => {
        const containerRef = useRef<HTMLDivElement | null>(null);
        const engineRef = useRef<any>(null);

        useImperativeHandle(ref, () => ({
            getFullArrangement: () => engineRef.current?.getFullArrangement?.(),
            getDebugState: () => engineRef.current?.getDebugState?.(),
            setHoveredBook: (id) => engineRef.current?.setHoveredBook?.(id),
            setFocusedBook: (id) => engineRef.current?.setFocusedBook?.(id),
            setOrderRevealEnabled: (enabled) => engineRef.current?.setOrderRevealEnabled?.(enabled),
            setHierarchyFilter: (filter) => engineRef.current?.setHierarchyFilter?.(filter),
            flyTo: (nodeId, targetFov) => engineRef.current?.flyTo?.(nodeId, targetFov),
            setProjection: (id) => engineRef.current?.setProjection?.(id),
        }));

        useEffect(() => {
        let disposed = false;

        async function init() {
            if (!containerRef.current) return;
            const useNext = config.engineVariant === "next";
            const engineFactory = useNext
                ? (await import("../engine-next/createEngineNext")).createEngineNext
                : (await import("../engine/createEngine")).createEngine;
            if (disposed) return;

            engineRef.current = engineFactory({
                container: containerRef.current,
                onSelect,
                onHover,
                onArrangementChange,
                onFovChange,
                onLongPress
            });

            engineRef.current.setConfig(config);
            engineRef.current.start();
        }

        init();

        return () => {
            disposed = true;
            engineRef.current?.dispose?.();
            engineRef.current = null;
        };
    }, []);

    useEffect(() => {
        engineRef.current?.setConfig?.(config);
    }, [config]);

    useEffect(() => {
        engineRef.current?.setHandlers?.({ onSelect, onHover, onArrangementChange, onFovChange, onLongPress });
    }, [onSelect, onHover, onArrangementChange, onFovChange, onLongPress]);

    return <div ref={containerRef} className={className} data-testid={testId} style={{ width: "100%", height: "100%" }} />;
    }
);
