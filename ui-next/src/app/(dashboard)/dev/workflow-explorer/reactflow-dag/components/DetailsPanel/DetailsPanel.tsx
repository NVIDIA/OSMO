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
 * DetailsPanel Component
 *
 * Unified container for group and task details with:
 * - Resizable width with drag handle
 * - Width snap presets
 * - Seamless navigation between group and task views
 * - Focus trap for keyboard accessibility
 * - Screen reader announcements
 *
 * Architecture:
 * - DetailsPanel (container): Resize handle, width management, view switching
 * - GroupDetails (content): Task list with search, sort, filter
 * - TaskDetails (content): Task info, actions, sibling navigation
 */

"use client";

import { memo, useRef, useEffect, useCallback } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { GroupDetails } from "./GroupDetails";
import { TaskDetails } from "./TaskDetails";
import type { DetailsPanelProps } from "../../types/panel";
import { useAnnouncer } from "../../hooks";

// NOTE: We intentionally do NOT use a focus trap here.
// This is a non-modal side panel (role="complementary"), not a dialog.
// Users should be able to Tab freely between the panel and the DAG.
// Focus traps are only appropriate for modal dialogs that block interaction.

// ============================================================================
// Component
// ============================================================================

export const DetailsPanel = memo(function DetailsPanel({
  view,
  group,
  allGroups,
  task,
  onClose,
  onBackToGroup,
  onSelectTask,
  onSelectGroup,
  panelPct,
  onPanelResize,
  isDragging,
  onResizeMouseDown,
  isDetailsExpanded,
  onToggleDetailsExpanded,
}: DetailsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const announce = useAnnouncer();

  // Handle Escape key to close panel (without focus trap)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only close if no dropdown/popover is open (they handle their own Escape)
        const target = e.target as HTMLElement;
        const isInDropdown = target.closest("[data-radix-popper-content-wrapper]");
        if (!isInDropdown) {
          onClose();
        }
      }
    },
    [onClose],
  );

  // Announce panel state changes to screen readers
  useEffect(() => {
    if (view === "group" && group) {
      const taskCount = group.tasks?.length ?? 0;
      announce(`Group details panel opened. ${group.name}, ${taskCount} tasks.`);
    } else if (view === "task" && task) {
      announce(`Task details panel opened. ${task.name}.`);
    }
  }, [view, group, task, announce]);

  return (
    <>
      {/* Resize Handle */}
      <div
        className={cn(
          "group absolute top-0 z-20 h-full w-1 cursor-ew-resize",
          isDragging ? "bg-blue-500" : "bg-transparent hover:bg-gray-400 dark:hover:bg-zinc-600",
        )}
        style={{
          left: `${100 - panelPct}%`,
          transform: "translateX(-50%)",
          willChange: isDragging ? "left" : "auto",
        }}
        onMouseDown={onResizeMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={panelPct}
        aria-valuemin={20}
        aria-valuemax={80}
      >
        <div
          className={cn(
            "dag-details-panel-handle absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-gray-300 px-0.5 py-1 shadow-md transition-opacity duration-150 dark:bg-zinc-700",
            isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          aria-hidden="true"
        >
          <GripVertical className="size-4 text-gray-600 dark:text-zinc-300" />
        </div>
      </div>

      {/* Panel Container */}
      <aside
        ref={panelRef}
        className="dag-details-panel absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l border-gray-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
        style={{ width: `${panelPct}%` }}
        role="complementary"
        aria-label={view === "group" ? `Group details: ${group.name}` : `Task details: ${task?.name}`}
        onKeyDown={handleKeyDown}
      >
        {view === "group" && (
          <GroupDetails
            group={group}
            allGroups={allGroups}
            onSelectTask={onSelectTask}
            onSelectGroup={onSelectGroup}
            onClose={onClose}
            onPanelResize={onPanelResize}
            isDetailsExpanded={isDetailsExpanded}
            onToggleDetailsExpanded={onToggleDetailsExpanded}
          />
        )}

        {view === "task" && task && (
          <TaskDetails
            group={group}
            allGroups={allGroups}
            task={task}
            onBackToGroup={onBackToGroup}
            onSelectTask={onSelectTask}
            onSelectGroup={onSelectGroup}
            onClose={onClose}
            onPanelResize={onPanelResize}
            isDetailsExpanded={isDetailsExpanded}
            onToggleDetailsExpanded={onToggleDetailsExpanded}
          />
        )}
      </aside>
    </>
  );
});
