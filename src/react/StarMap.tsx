"use client";

import React, { useEffect, useRef } from "react";
import type { StarMapConfig, SceneNode } from "../types";

export type StarMapProps = {
    config: StarMapConfig;
    className?: string;
    onSelect?: (node: SceneNode) => void;
    onHover?: (node?: SceneNode) => void;
};

export function StarMap({ config, className, onSelect, onHover }: StarMapProps) {
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
                onHover
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
        engineRef.current?.setHandlers?.({ onSelect, onHover });
    }, [onSelect, onHover]);

    return <div ref={containerRef} className={className} />;
}
