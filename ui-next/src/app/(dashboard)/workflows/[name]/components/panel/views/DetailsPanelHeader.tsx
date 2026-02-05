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
 * Workflow-specific header that composes from the canonical PanelHeader.
 * Adds workflow-specific features:
 * - Breadcrumb navigation with back button
 * - Task switcher dropdown (for navigating between sibling tasks)
 * - View type badges (Workflow, Group, Task)
 * - Lead badge (for distributed training leader tasks)
 *
 * Layout structure (consistent across views):
 * Row 1: [Back] Breadcrumb / Title · Subtitle    [Badges] [Menu] [Close]
 * Row 2: Status · Additional info
 * Row 3 (optional): Expandable details section
 */

"use client";

import { memo, useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, MoreVertical, Columns, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from "@/components/shadcn/dropdown-menu";
import { PanelHeader, PanelBadge, PanelTitle, PanelSubtitle } from "@/components/panel";
import { getStatusIcon } from "../../../lib/status";
import type { DetailsPanelHeaderProps, SiblingTask, BreadcrumbSegment } from "../../../lib/panel-types";

// ============================================================================
// Types
// ============================================================================

/** View type for visual differentiation */
export type HeaderViewType = "workflow" | "group" | "task";

/** View type badge labels */
const VIEW_TYPE_LABELS: Record<HeaderViewType, string> = {
  workflow: "Workflow",
  group: "Group",
  task: "Task",
};

interface ExtendedHeaderProps extends DetailsPanelHeaderProps {
  /** Toggle the collapsed state of the panel */
  onToggleCollapsed?: () => void;
  /** Multi-level breadcrumb segments */
  breadcrumbs?: BreadcrumbSegment[];
}

// ============================================================================
// Task Switcher Dropdown
// ============================================================================

interface TaskSwitcherProps {
  /** Current task title */
  title: string;
  /** All sibling tasks */
  siblingTasks: SiblingTask[];
  /** Callback when selecting a different task */
  onSelectSibling: (name: string, retryId: number) => void;
}

const TaskSwitcher = memo(function TaskSwitcher({ title, siblingTasks, onSelectSibling }: TaskSwitcherProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Filter siblings by search query
  const filteredSiblings = useMemo(() => {
    if (!searchQuery) return siblingTasks;
    const q = searchQuery.toLowerCase();
    return siblingTasks.filter((t) => t.name.toLowerCase().includes(q));
  }, [siblingTasks, searchQuery]);

  // Handle sibling selection
  const handleSelectSibling = useCallback(
    (task: SiblingTask) => {
      if (!task.isCurrent) {
        onSelectSibling(task.name, task.retryId);
        setSearchQuery("");
      }
    },
    [onSelectSibling],
  );

  // Handle dropdown open/close
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setSearchQuery("");
    }
  }, []);

  // Focus search input and scroll current item into view when dropdown opens
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
      const currentItem = listContainerRef.current?.querySelector('[data-current="true"]');
      if (currentItem) {
        currentItem.scrollIntoView({ block: "center", behavior: "instant" });
      }
    }
  }, [isOpen]);

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
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
                <span className="shrink-0">{getStatusIcon(task.status, "size-4")}</span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    task.isCurrent
                      ? "font-medium text-gray-900 dark:text-zinc-100"
                      : "text-gray-600 dark:text-zinc-300",
                  )}
                >
                  {task.name}
                  {task.retryId > 0 && <span className="ml-1.5 text-gray-400 dark:text-zinc-500">#{task.retryId}</span>}
                </span>
                {task.isLead && (
                  <PanelBadge
                    label="Lead"
                    variant="amber"
                    className="text-[10px]"
                  />
                )}
                {task.isCurrent && <Check className="size-4 shrink-0 text-emerald-500 dark:text-emerald-400" />}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

// ============================================================================
// DetailsPanelHeader Component
// ============================================================================

export const DetailsPanelHeader = memo(function DetailsPanelHeader({
  title,
  subtitle,
  statusContent,
  menuContent,
  breadcrumbs,
  viewType,
  isLead,
  siblingTasks,
  onSelectSibling,
  expandableContent,
  isExpanded: controlledExpanded,
  onToggleExpand,
}: ExtendedHeaderProps) {
  // Use controlled state if provided, otherwise fall back to local state
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = controlledExpanded ?? localExpanded;
  const handleToggleExpand = onToggleExpand ?? (() => setLocalExpanded(!localExpanded));

  // Check if we have siblings to switch between
  const hasSiblings = siblingTasks && siblingTasks.length > 1 && onSelectSibling;

  // Build title content slot
  const titleContent = (
    <>
      {/* Multi-level breadcrumbs in "Workflow > Group > Task" style */}
      {breadcrumbs &&
        breadcrumbs.map((segment, index) => (
          <span
            key={`${segment.label}-${index}`}
            className="flex shrink-0 items-center"
          >
            <button
              type="button"
              onClick={segment.onClick}
              className="truncate text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              aria-label={`Navigate to ${segment.label}`}
            >
              {segment.label}
            </button>
            <ChevronRight
              className="mx-1 h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600"
              aria-hidden="true"
            />
          </span>
        ))}

      {/* Title - with optional task switcher */}
      {hasSiblings ? (
        <TaskSwitcher
          title={title}
          siblingTasks={siblingTasks}
          onSelectSibling={onSelectSibling}
        />
      ) : (
        <PanelTitle>{title}</PanelTitle>
      )}

      {/* Subtitle */}
      {subtitle && <PanelSubtitle>{subtitle}</PanelSubtitle>}
    </>
  );

  // Build actions content slot
  const actionsContent = (
    <>
      {/* Lead badge (shown before view type badge for tasks) */}
      {isLead && (
        <PanelBadge
          label="Lead"
          variant="amber"
          title="Leader task for distributed training"
        />
      )}

      {/* View type badge */}
      {viewType && <PanelBadge label={VIEW_TYPE_LABELS[viewType]} />}

      {/* Menu (optional custom content - e.g., column controls) */}
      {menuContent && (
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  return (
    <PanelHeader
      title={titleContent}
      actions={actionsContent}
      subtitle={statusContent}
      expandable={
        expandableContent
          ? {
              content: expandableContent,
              isExpanded,
              onToggle: handleToggleExpand,
            }
          : undefined
      }
    />
  );
});

// ============================================================================
// Column Menu Helper
// ============================================================================

interface ColumnMenuProps {
  columns: Array<{ id: string; menuLabel?: string; label: string }>;
  visibleColumnIds: string[];
  onToggleColumn: (columnId: string) => void;
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
            {col.menuLabel ?? col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
});
