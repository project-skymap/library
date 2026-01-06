"use client";

import React, { useEffect, useRef } from "react";
import type { StarMapConfig, SceneNode, StarArrangement } from "../types";

export type StarMapProps = {
    config: StarMapConfig;
    className?: string;
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
    onArrangementChange?: (arrangement: StarArrangement) => void;
};

export function StarMap({ config, className, onSelect, onHover, onArrangementChange }: StarMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<any>(null);

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
                onArrangementChange
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
        engineRef.current?.setHandlers?.({ onSelect, onHover, onArrangementChange });
    }, [onSelect, onHover, onArrangementChange]);

    return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
}
