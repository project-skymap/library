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
};

export type StarMapHandle = {
    getFullArrangement: () => StarArrangement | undefined;
    setHoveredBook: (id: string | null) => void;
    setFocusedBook: (id: string | null) => void;
    setOrderRevealEnabled: (enabled: boolean) => void;
    setHierarchyFilter: (filter: HierarchyFilter | null) => void;
};

export const StarMap = forwardRef<StarMapHandle, StarMapProps>(
    ({ config, className, onSelect, onHover, onArrangementChange, onFovChange }, ref) => {
        const containerRef = useRef<HTMLDivElement | null>(null);
        const engineRef = useRef<any>(null);

        useImperativeHandle(ref, () => ({
            getFullArrangement: () => engineRef.current?.getFullArrangement?.(),
            setHoveredBook: (id) => engineRef.current?.setHoveredBook?.(id),
            setFocusedBook: (id) => engineRef.current?.setFocusedBook?.(id),
            setOrderRevealEnabled: (enabled) => engineRef.current?.setOrderRevealEnabled?.(enabled),
            setHierarchyFilter: (filter) => engineRef.current?.setHierarchyFilter?.(filter),
        }));

        useEffect(() => {
        let disposed = false;

        async function init() {
            if (!containerRef.current) return;
            const { createEngine } = await import("../engine/createEngine");
            if (disposed) return;

            engineRef.current = createEngine({
                container: containerRef.current,
                onSelect,
                onHover,
                onArrangementChange,
                onFovChange
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
        engineRef.current?.setHandlers?.({ onSelect, onHover, onArrangementChange, onFovChange });
    }, [onSelect, onHover, onArrangementChange, onFovChange]);

    return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
    }
);
