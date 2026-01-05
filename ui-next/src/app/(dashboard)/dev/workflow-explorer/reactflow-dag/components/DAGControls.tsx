// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * DAGControls Component
 *
 * Unified control panel for the DAG visualization.
 * Combines zoom, layout direction, and minimap toggle in one place.
 */

"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { ZoomIn, ZoomOut, ArrowDown, ArrowRight, Map } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import type { LayoutDirection } from "../types/dag-layout";

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

export function DAGControls({ layoutDirection, onLayoutChange, showMinimap, onToggleMinimap }: DAGControlsProps) {
  const { zoomIn, zoomOut } = useReactFlow();

  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  const handleToggleLayout = useCallback(() => {
    onLayoutChange(layoutDirection === "TB" ? "LR" : "TB");
  }, [layoutDirection, onLayoutChange]);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
        role="toolbar"
        aria-label="DAG controls"
      >
        {/* Zoom Controls */}
        <ControlButton
          onClick={handleZoomIn}
          tooltip="Zoom In"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </ControlButton>

        <ControlButton
          onClick={handleZoomOut}
          tooltip="Zoom Out"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </ControlButton>

        {/* Divider */}
        <div
          className="my-1 h-px bg-gray-200 dark:bg-zinc-700"
          aria-hidden="true"
        />

        {/* Layout Direction Toggle - no active state, just shows current direction */}
        <ControlButton
          onClick={handleToggleLayout}
          tooltip="Toggle Direction"
          aria-label={`Switch to ${layoutDirection === "TB" ? "horizontal" : "vertical"} layout`}
        >
          {layoutDirection === "TB" ? <ArrowDown className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
        </ControlButton>

        {/* Minimap Toggle */}
        <ControlButton
          onClick={onToggleMinimap}
          tooltip="Toggle Minimap"
          aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
          aria-pressed={showMinimap}
          active={showMinimap}
        >
          <Map className="h-4 w-4" />
        </ControlButton>
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Control Button Component
// ============================================================================

interface ControlButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  tooltip: string;
  "aria-label": string;
  "aria-pressed"?: boolean;
  active?: boolean;
}

function ControlButton({
  onClick,
  children,
  tooltip,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  active,
}: ControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
            "dark:text-zinc-400 dark:hover:bg-zinc-700/50 dark:hover:text-zinc-100",
            "focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none focus-visible:ring-inset",
            active && "bg-gray-200 text-gray-900 dark:bg-zinc-700 dark:text-zinc-100",
          )}
          aria-label={ariaLabel}
          aria-pressed={ariaPressed}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
