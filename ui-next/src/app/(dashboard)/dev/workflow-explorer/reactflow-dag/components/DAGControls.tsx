// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAGControls Component
 *
 * Unified control panel for the DAG visualization.
 * Combines zoom, layout direction, and minimap toggle in one place.
 */

"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  ArrowDown,
  ArrowRight,
  Map,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayoutDirection } from "../types";

interface DAGControlsProps {
  /** Current layout direction */
  layoutDirection: LayoutDirection;
  /** Layout direction change callback */
  onLayoutChange: (direction: LayoutDirection) => void;
  /** Whether minimap is visible */
  showMinimap: boolean;
  /** Minimap toggle callback */
  onToggleMinimap: () => void;
}

export function DAGControls({
  layoutDirection,
  onLayoutChange,
  showMinimap,
  onToggleMinimap,
}: DAGControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.1 });
  }, [fitView]);

  const handleToggleLayout = useCallback(() => {
    onLayoutChange(layoutDirection === "TB" ? "LR" : "TB");
  }, [layoutDirection, onLayoutChange]);

  return (
    <div
      className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 bg-zinc-900/95 backdrop-blur border border-zinc-700 rounded-lg p-1 shadow-lg"
      role="toolbar"
      aria-label="DAG controls"
    >
      {/* Zoom Controls */}
      <ControlButton
        onClick={handleZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </ControlButton>

      <ControlButton
        onClick={handleZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </ControlButton>

      <ControlButton
        onClick={handleFitView}
        aria-label="Fit to view"
        title="Fit to view"
      >
        <Maximize className="h-4 w-4" />
      </ControlButton>

      {/* Divider */}
      <div className="h-px bg-zinc-700 my-1" aria-hidden="true" />

      {/* Layout Direction Toggle */}
      <ControlButton
        onClick={handleToggleLayout}
        aria-label={`Switch to ${layoutDirection === "TB" ? "horizontal" : "vertical"} layout`}
        aria-pressed={layoutDirection === "LR"}
        title={layoutDirection === "TB" ? "Switch to horizontal" : "Switch to vertical"}
        active={layoutDirection === "LR"}
      >
        {layoutDirection === "TB" ? (
          <ArrowDown className="h-4 w-4" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
      </ControlButton>

      {/* Minimap Toggle */}
      <ControlButton
        onClick={onToggleMinimap}
        aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
        aria-pressed={showMinimap}
        title={showMinimap ? "Hide minimap" : "Show minimap"}
        active={showMinimap}
      >
        <Map className="h-4 w-4" />
      </ControlButton>
    </div>
  );
}

// ============================================================================
// Control Button Component
// ============================================================================

interface ControlButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  "aria-label": string;
  "aria-pressed"?: boolean;
  title?: string;
  active?: boolean;
}

function ControlButton({
  onClick,
  children,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  title,
  active,
}: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
        "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset",
        active && "bg-zinc-700 text-zinc-100"
      )}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      title={title}
    >
      {children}
    </button>
  );
}
