// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DetailsPanel Component
 *
 * Unified container for group and task details with:
 * - Resizable width with drag handle
 * - Width snap presets
 * - Seamless navigation between group and task views
 *
 * Architecture:
 * - DetailsPanel (container): Resize handle, width management, view switching
 * - GroupDetails (content): Task list with search, sort, filter
 * - TaskDetails (content): Task info, actions, sibling navigation
 */

"use client";

import { memo } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { GroupDetails } from "./GroupDetails";
import { TaskDetails } from "./TaskDetails";
import type { DetailsPanelProps } from "../../types/panel";

// ============================================================================
// Component
// ============================================================================

export const DetailsPanel = memo(function DetailsPanel({
  view,
  group,
  task,
  onClose,
  onBackToGroup,
  onSelectTask,
  panelPct,
  onPanelResize,
  isDragging,
  onResizeMouseDown,
}: DetailsPanelProps) {
  return (
    <>
      {/* Resize Handle */}
      <div
        className={cn(
          "group absolute top-0 z-20 h-full w-1 cursor-ew-resize",
          isDragging ? "bg-blue-500" : "bg-transparent hover:bg-zinc-600",
        )}
        style={{
          left: `${100 - panelPct}%`,
          transform: "translateX(-50%)",
          willChange: isDragging ? "left" : "auto",
        }}
        onMouseDown={onResizeMouseDown}
      >
        <div
          className={cn(
            "dag-details-panel-handle absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-700 px-0.5 py-1 shadow-md transition-opacity duration-150",
            isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <GripVertical className="size-4 text-zinc-300" />
        </div>
      </div>

      {/* Panel Container */}
      <div
        className="dag-details-panel absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l border-zinc-800 bg-zinc-900/95 backdrop-blur"
        style={{ width: `${panelPct}%` }}
        role="complementary"
        aria-label={view === "group" ? "Group details" : "Task details"}
      >
        {view === "group" && (
          <GroupDetails
            group={group}
            onSelectTask={onSelectTask}
            onClose={onClose}
            onPanelResize={onPanelResize}
          />
        )}

        {view === "task" && task && (
          <TaskDetails
            group={group}
            task={task}
            onBackToGroup={onBackToGroup}
            onSelectTask={onSelectTask}
            onClose={onClose}
            onPanelResize={onPanelResize}
          />
        )}
      </div>
    </>
  );
});
