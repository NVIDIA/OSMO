// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

import { memo, useState, useRef, useCallback, useLayoutEffect } from "react";
import { Check, Loader2, Clock, AlertCircle, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
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
}

const DependencyPill = memo(function DependencyPill({
  group,
  onClick,
}: DependencyPillProps) {
  const category = getStatusCategory(group.status);
  const style = STATUS_PILL_STYLES[category] || STATUS_PILL_STYLES.waiting;
  const Icon = style.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        "dependency-pill inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-zinc-900",
        style.pillClass,
        onClick && "cursor-pointer"
      )}
    >
      <Icon className={cn("size-3 shrink-0", style.iconClass)} />
      <span className="max-w-[120px] truncate">{group.name}</span>
    </button>
  );
});

// ============================================================================
// Pill Row Component (handles responsive +N / show less)
// ============================================================================

const PillRow = memo(function PillRow({
  label,
  groups,
  onSelectGroup,
}: PillRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(groups.length);
  const [isExpanded, setIsExpanded] = useState(false);

  // Measure how many pills fit on one line using hidden measurement container
  const measureVisiblePills = useCallback(() => {
    if (!containerRef.current || !measureRef.current || groups.length === 0) return;

    const container = containerRef.current;
    const measureContainer = measureRef.current;
    const pills = measureContainer.querySelectorAll("[data-measure-pill]");
    if (pills.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const labelWidth = 100; // Approximate label width + gap
    const availableWidth = containerRect.width - labelWidth - 60; // Reserve space for +N

    let totalWidth = 0;
    let count = 0;

    pills.forEach((pill, index) => {
      const pillRect = pill.getBoundingClientRect();
      const pillWidth = pillRect.width + 8; // Include gap

      if (totalWidth + pillWidth <= availableWidth) {
        totalWidth += pillWidth;
        count = index + 1;
      }
    });

    // Always show at least 1 pill
    setVisibleCount(Math.max(1, count));
  }, [groups.length]);

  // Measure on mount and resize
  useLayoutEffect(() => {
    if (!isExpanded) {
      measureVisiblePills();
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!isExpanded) {
        measureVisiblePills();
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [isExpanded, measureVisiblePills]);

  // Don't render empty rows
  if (groups.length === 0) {
    return null;
  }

  const hiddenCount = groups.length - visibleCount;

  return (
    <div ref={containerRef} className="flex flex-wrap items-start gap-2">
      {/* Hidden measurement container - renders all pills to measure their widths */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute flex items-center gap-2"
        aria-hidden="true"
      >
        {groups.map((group) => (
          <div key={`measure-${group.name}`} data-measure-pill>
            <DependencyPill group={group} />
          </div>
        ))}
      </div>

      <span className="w-24 shrink-0 py-1 text-xs text-gray-500 dark:text-zinc-500">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* When collapsed: show visibleCount pills; when expanded: show all */}
        {(isExpanded ? groups : groups.slice(0, visibleCount)).map((group) => (
          <DependencyPill
            key={group.name}
            group={group}
            onClick={onSelectGroup ? () => onSelectGroup(group.name) : undefined}
          />
        ))}
        {/* +N button (collapsed state) */}
        {!isExpanded && hiddenCount > 0 && (
          <button
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-gray-100 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-zinc-800 dark:hover:text-blue-300"
          >
            +{hiddenCount}
          </button>
        )}
        {/* Show less button (expanded state) - inline with pills */}
        {isExpanded && hiddenCount > 0 && (
          <button
            onClick={() => setIsExpanded(false)}
            className="inline-flex items-center rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            show less
          </button>
        )}
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
