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
 * DetailsPanelHeader Component
 *
 * Shared header component for both GroupDetails and TaskDetails.
 * Provides consistent 2-row layout:
 *
 * Row 1: [Back] Breadcrumb / Title                    [Menu] [Close]
 * Row 2: Status · Additional info
 *
 * This structure ensures visual consistency during navigation between views.
 */

"use client";

import { memo, useState, useMemo, useCallback, useRef } from "react";
import {
  X,
  ChevronLeft,
  ChevronDown,
  MoreVertical,
  PanelLeftClose,
  Columns2,
  PanelLeft,
  Columns,
  Search,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from "@/components/shadcn/dropdown-menu";
import { PANEL } from "../../constants";
import { getStatusIcon } from "../../utils/status";
import type { DetailsPanelHeaderProps, SiblingTask } from "../../types/panel";
import type { ColumnId } from "../../types/table";

// ============================================================================
// Width Preset Configuration
// ============================================================================

const WIDTH_PRESET_ICONS = {
  33: PanelLeftClose,
  50: Columns2,
  75: PanelLeft,
} as const;

// ============================================================================
// Component
// ============================================================================

/** View type for visual differentiation */
export type HeaderViewType = "group" | "task";

/** Badge configuration for each view type - outline only, neutral */
const VIEW_TYPE_BADGE = {
  group: {
    label: "Group",
    className: "bg-transparent text-gray-500 ring-gray-300 dark:text-zinc-400 dark:ring-zinc-600",
  },
  task: {
    label: "Task",
    className: "bg-transparent text-gray-500 ring-gray-300 dark:text-zinc-400 dark:ring-zinc-600",
  },
} as const;

/** Lead badge styling */
const LEAD_BADGE = {
  label: "Lead",
  className:
    "bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30",
};

interface ExtendedHeaderProps extends DetailsPanelHeaderProps {
  /** Panel resize callback (for width presets menu) */
  onPanelResize?: (pct: number) => void;
}

export const DetailsPanelHeader = memo(function DetailsPanelHeader({
  title,
  subtitle,
  statusContent,
  onBack,
  onClose,
  menuContent,
  onPanelResize,
  breadcrumb,
  viewType,
  isLead,
  siblingTasks,
  onSelectSibling,
  expandableContent,
  isExpanded: controlledExpanded,
  onToggleExpand,
}: ExtendedHeaderProps) {
  const badge = viewType ? VIEW_TYPE_BADGE[viewType] : null;
  const [searchQuery, setSearchQuery] = useState("");
  // Use controlled state if provided, otherwise fall back to local state
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? localExpanded;
  const handleToggleExpand = onToggleExpand ?? (() => setLocalExpanded(!localExpanded));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Check if we have siblings to switch between
  const hasSiblings = siblingTasks && siblingTasks.length > 1 && onSelectSibling;

  // Filter siblings by search query
  const filteredSiblings = useMemo(() => {
    if (!siblingTasks) return [];
    if (!searchQuery) return siblingTasks;
    const q = searchQuery.toLowerCase();
    return siblingTasks.filter((t) => t.name.toLowerCase().includes(q));
  }, [siblingTasks, searchQuery]);

  // Handle sibling selection
  const handleSelectSibling = useCallback(
    (task: SiblingTask) => {
      if (onSelectSibling && !task.isCurrent) {
        onSelectSibling(task.name, task.retryId);
        setSearchQuery("");
      }
    },
    [onSelectSibling],
  );

  // Focus search input and scroll current item into view when dropdown opens
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      // Small delay to let the dropdown render
      setTimeout(() => {
        searchInputRef.current?.focus();
        // Scroll current task into view (centered)
        const currentItem = listContainerRef.current?.querySelector('[data-current="true"]');
        if (currentItem) {
          currentItem.scrollIntoView({ block: "center", behavior: "instant" });
        }
      }, 0);
    } else {
      setSearchQuery("");
    }
  }, []);

  return (
    <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      {/* Row 1: Title row */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* Back button + Breadcrumb (unified clickable surface) */}
          {breadcrumb && onBack && (
            <>
              <button
                onClick={onBack}
                className="-ml-1 flex shrink-0 items-center gap-1 rounded-md py-1 pr-2 pl-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label={`Back to ${breadcrumb}`}
              >
                <ChevronLeft
                  className="size-4"
                  aria-hidden="true"
                />
                <span className="text-sm">{breadcrumb}</span>
              </button>
              <span className="shrink-0 text-gray-400 dark:text-zinc-600">/</span>
            </>
          )}

          {/* Title - with optional task switcher */}
          {hasSiblings ? (
            <DropdownMenu onOpenChange={handleOpenChange}>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1.5 pl-1.5 text-gray-900 transition-colors hover:bg-gray-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="Switch task"
                >
                  <span className="truncate font-semibold">{title}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-gray-500 dark:text-zinc-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-80 p-0"
              >
                {/* Search input */}
                <div className="flex items-center border-b border-gray-200 px-3 py-2 dark:border-zinc-800">
                  <Search className="mr-2 size-4 shrink-0 text-gray-400 dark:text-zinc-500" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search tasks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    onKeyDown={(e) => {
                      // Stop propagation for navigation keys (let Escape bubble to close dropdown)
                      if (e.key !== "Escape") {
                        e.stopPropagation();
                      }
                    }}
                  />
                </div>
                {/* Task list */}
                <div
                  ref={listContainerRef}
                  className="max-h-60 overflow-y-auto py-1"
                >
                  {filteredSiblings.length === 0 ? (
                    <div className="py-4 text-center text-sm text-gray-500 dark:text-zinc-500">No tasks found</div>
                  ) : (
                    filteredSiblings.map((task) => (
                      <DropdownMenuItem
                        key={`${task.name}-${task.retryId}`}
                        onSelect={() => handleSelectSibling(task)}
                        data-current={task.isCurrent ? "true" : undefined}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 px-3 py-2.5",
                          task.isCurrent && "bg-gray-100/50 dark:bg-zinc-800/50",
                        )}
                      >
                        {/* Status icon */}
                        <span className="shrink-0">{getStatusIcon(task.status, "size-4")}</span>
                        {/* Task name */}
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm",
                            task.isCurrent
                              ? "font-medium text-gray-900 dark:text-zinc-100"
                              : "text-gray-600 dark:text-zinc-300",
                          )}
                        >
                          {task.name}
                          {task.retryId > 0 && (
                            <span className="ml-1.5 text-gray-400 dark:text-zinc-500">#{task.retryId}</span>
                          )}
                        </span>
                        {/* Lead badge */}
                        {task.isLead && (
                          <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30">
                            Lead
                          </span>
                        )}
                        {/* Current indicator */}
                        {task.isCurrent && <Check className="size-4 shrink-0 text-emerald-500 dark:text-emerald-400" />}
                      </DropdownMenuItem>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <h2 className="truncate font-semibold text-gray-900 dark:text-zinc-100">{title}</h2>
          )}

          {subtitle && (
            <>
              <span className="shrink-0 text-gray-400 dark:text-zinc-600">·</span>
              <span className="shrink-0 text-sm text-gray-500 dark:text-zinc-400">{subtitle}</span>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="-mr-1.5 flex shrink-0 items-center gap-1.5">
          {/* Lead badge (shown before view type badge for tasks) */}
          {isLead && (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide uppercase ring-1 ring-inset",
                LEAD_BADGE.className,
              )}
              title="Leader task for distributed training"
            >
              {LEAD_BADGE.label}
            </span>
          )}
          {/* View type badge */}
          {badge && (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide uppercase ring-1 ring-inset",
                badge.className,
              )}
            >
              {badge.label}
            </span>
          )}

          {/* Menu (optional custom content + width presets) */}
          {(menuContent || onPanelResize) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44"
              >
                {menuContent}
                {menuContent && onPanelResize && <DropdownMenuSeparator />}
                {onPanelResize && (
                  <>
                    <DropdownMenuLabel className="text-xs text-gray-500 dark:text-zinc-500">Snap to</DropdownMenuLabel>
                    {PANEL.WIDTH_PRESETS.map((pct) => {
                      const Icon = WIDTH_PRESET_ICONS[pct];
                      return (
                        <DropdownMenuItem
                          key={pct}
                          onClick={() => onPanelResize(pct)}
                        >
                          <Icon className="mr-2 size-4" />
                          <span>{pct}%</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close panel"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Row 2: Status + inline "more/less" toggle */}
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        {statusContent}
        {expandableContent && (
          <>
            <span className="text-gray-400 dark:text-zinc-600">·</span>
            <button
              onClick={handleToggleExpand}
              className="text-gray-500 transition-colors hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-300"
              aria-expanded={isExpanded}
              aria-controls="header-expandable-content"
            >
              {isExpanded ? "show less" : "show more"}
            </button>
          </>
        )}
      </div>

      {/* Expandable Details */}
      {expandableContent && isExpanded && (
        <div
          id="header-expandable-content"
          className="mt-3 space-y-3 border-t border-gray-200 pt-3 dark:border-zinc-800"
        >
          {expandableContent}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Column Menu Helper
// ============================================================================

interface ColumnMenuProps {
  columns: Array<{ id: ColumnId; menuLabel: string }>;
  visibleColumnIds: ColumnId[];
  onToggleColumn: (columnId: ColumnId) => void;
}

export const ColumnMenuContent = memo(function ColumnMenuContent({
  columns,
  visibleColumnIds,
  onToggleColumn,
}: ColumnMenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Columns className="mr-2 size-4" />
        Columns
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-36">
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.id}
            checked={visibleColumnIds.includes(col.id)}
            onCheckedChange={() => onToggleColumn(col.id)}
            onSelect={(e) => e.preventDefault()}
          >
            {col.menuLabel}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
});
