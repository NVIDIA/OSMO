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
 * DependencyPills Component
 *
 * Displays upstream and downstream group dependencies as interactive pills.
 * Features:
 * - Responsive layout: shows as many pills as fit on one line
 * - +N indicator for overflow (collapsed state)
 * - Expandable to show all pills with "show less" button
 * - Each pill reflects the status visually (completed, running, pending, failed)
 */

"use client";

import { memo } from "react";
import { Check, Loader2, Clock, AlertCircle, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExpandableChips } from "@/hooks";
import type { GroupWithLayout } from "../../../workflow-types";
import { getStatusCategory } from "../../utils/status";

// ============================================================================
// Types
// ============================================================================

interface DependencyPillsProps {
  /** Upstream (parent) groups */
  upstreamGroups: GroupWithLayout[];
  /** Downstream (child) groups */
  downstreamGroups: GroupWithLayout[];
  /** Callback when clicking a pill */
  onSelectGroup?: (groupName: string) => void;
}

interface PillRowProps {
  label: string;
  groups: GroupWithLayout[];
  onSelectGroup?: (groupName: string) => void;
}

// ============================================================================
// Status Pill Styling
// ============================================================================

const STATUS_PILL_STYLES = {
  completed: {
    pillClass: "dependency-pill-completed",
    icon: Check,
    iconClass: "",
  },
  running: {
    pillClass: "dependency-pill-running",
    icon: Loader2,
    iconClass: "animate-spin",
  },
  waiting: {
    pillClass: "dependency-pill-waiting",
    icon: Clock,
    iconClass: "",
  },
  failed: {
    pillClass: "dependency-pill-failed",
    icon: AlertCircle,
    iconClass: "",
  },
  blocked: {
    pillClass: "dependency-pill-blocked",
    icon: Pause,
    iconClass: "",
  },
} as const;

// ============================================================================
// Single Pill Component
// ============================================================================

interface DependencyPillProps {
  group: GroupWithLayout;
  onClick?: () => void;
  /** For measurement container - renders as span instead of button */
  isMeasurement?: boolean;
}

const DependencyPill = memo(function DependencyPill({ group, onClick, isMeasurement }: DependencyPillProps) {
  const category = getStatusCategory(group.status);
  const style = STATUS_PILL_STYLES[category] || STATUS_PILL_STYLES.waiting;
  const Icon = style.icon;

  const className = cn(
    "dependency-pill inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
    !isMeasurement &&
      "focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white focus:outline-none dark:focus:ring-offset-zinc-900",
    style.pillClass,
    onClick && "cursor-pointer",
  );

  if (isMeasurement) {
    return (
      <span
        className={className}
        data-chip
      >
        <Icon className={cn("size-3 shrink-0", style.iconClass)} />
        <span className="max-w-[120px] truncate">{group.name}</span>
      </span>
    );
  }

  return (
    <button
      onClick={onClick}
      className={className}
    >
      <Icon className={cn("size-3 shrink-0", style.iconClass)} />
      <span className="max-w-[120px] truncate">{group.name}</span>
    </button>
  );
});

// ============================================================================
// Pill Row Component (uses CSS-driven measurement)
// ============================================================================

const PillRow = memo(function PillRow({ label, groups, onSelectGroup }: PillRowProps) {
  const { containerRef, measureRef, expanded, setExpanded, displayedItems, overflowCount } =
    useExpandableChips<GroupWithLayout>({
      items: groups,
      sortAlphabetically: false, // Keep original order for dependencies
      getKey: (g) => g.name,
    });

  // Don't render empty rows
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="flex items-start gap-2">
      <span className="w-24 shrink-0 py-1 text-xs text-gray-500 dark:text-zinc-500">{label}</span>

      <div className="relative flex-1 overflow-hidden">
        {/* Hidden measurement container - renders all pills to measure their widths */}
        <div
          ref={measureRef}
          className="pointer-events-none invisible absolute flex items-center gap-2"
          style={{ contain: "layout style", willChange: "contents" }}
          aria-hidden="true"
        >
          {groups.map((group) => (
            <DependencyPill
              key={`measure-${group.name}`}
              group={group}
              isMeasurement
            />
          ))}
          {/* Overflow button placeholder for measuring its width */}
          <span
            data-overflow
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-blue-600"
          >
            +{overflowCount || 1}
          </span>
        </div>

        {/* Visible container */}
        <div
          ref={containerRef}
          className={cn("flex items-center gap-2", expanded ? "flex-wrap" : "flex-nowrap overflow-hidden")}
        >
          {displayedItems.map((group) => (
            <DependencyPill
              key={group.name}
              group={group}
              onClick={onSelectGroup ? () => onSelectGroup(group.name) : undefined}
            />
          ))}
          {/* +N button (collapsed state) */}
          {!expanded && overflowCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-gray-100 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-zinc-800 dark:hover:text-blue-300"
            >
              +{overflowCount}
            </button>
          )}
          {/* Show less button (expanded state) */}
          {expanded && overflowCount > 0 && (
            <button
              onClick={() => setExpanded(false)}
              className="inline-flex items-center rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              show less
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const DependencyPills = memo(function DependencyPills({
  upstreamGroups,
  downstreamGroups,
  onSelectGroup,
}: DependencyPillsProps) {
  // Don't render if no dependencies at all
  if (upstreamGroups.length === 0 && downstreamGroups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <PillRow
        label="Upstream"
        groups={upstreamGroups}
        onSelectGroup={onSelectGroup}
      />
      <PillRow
        label="Downstream"
        groups={downstreamGroups}
        onSelectGroup={onSelectGroup}
      />
    </div>
  );
});
