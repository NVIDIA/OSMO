// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { Download, WrapText, ArrowDownToLine, Play, Pause, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useLogViewerStore } from "../store/log-viewer-store";

// =============================================================================
// Types
// =============================================================================

export interface LogToolbarProps {
  /** Total number of entries */
  totalCount: number;
  /** Filtered count (if filters active) */
  filteredCount?: number;
  /** Whether tailing is currently active */
  isTailing: boolean;
  /** Callback to toggle tailing */
  onToggleTailing: () => void;
  /** Whether line wrapping is enabled */
  wrapLines: boolean;
  /** Callback to toggle line wrapping */
  onToggleWrapLines: () => void;
  /** Callback to download logs */
  onDownload?: () => void;
  /** Callback to scroll to bottom */
  onScrollToBottom?: () => void;
  /** Callback to refresh logs */
  onRefresh?: () => void;
  /** Whether currently loading */
  isLoading?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function LogToolbarInner({
  totalCount,
  filteredCount,
  isTailing,
  onToggleTailing,
  wrapLines,
  onToggleWrapLines,
  onDownload,
  onScrollToBottom,
  onRefresh,
  isLoading = false,
  className,
}: LogToolbarProps) {
  return (
    <div
      className={cn(
        "bg-background/95 supports-[backdrop-filter]:bg-background/60 flex items-center justify-between gap-4 border-t px-3 py-2 backdrop-blur",
        className,
      )}
    >
      {/* Left: Results count */}
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span className="tabular-nums">
          {filteredCount !== undefined ? (
            <>
              <span className="text-foreground font-medium">{filteredCount.toLocaleString()}</span>
              {" of "}
              {totalCount.toLocaleString()}
              {" entries"}
            </>
          ) : (
            <>
              <span className="text-foreground font-medium">{totalCount.toLocaleString()}</span>
              {" entries"}
            </>
          )}
        </span>

        {/* Tailing indicator */}
        {isTailing && (
          <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
            <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
            Live
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        {/* Refresh button */}
        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onRefresh}
                disabled={isLoading}
              >
                <RotateCcw className={cn("size-4", isLoading && "animate-spin")} />
                <span className="sr-only">Refresh</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Refresh logs</TooltipContent>
          </Tooltip>
        )}

        {/* Wrap lines toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={wrapLines ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onToggleWrapLines}
            >
              <WrapText className="size-4" />
              <span className="sr-only">{wrapLines ? "Disable" : "Enable"} line wrap</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{wrapLines ? "Disable" : "Enable"} line wrap</TooltipContent>
        </Tooltip>

        {/* Download button */}
        {onDownload && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDownload}
              >
                <Download className="size-4" />
                <span className="sr-only">Download logs</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Download logs</TooltipContent>
          </Tooltip>
        )}

        {/* Scroll to bottom */}
        {onScrollToBottom && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onScrollToBottom}
              >
                <ArrowDownToLine className="size-4" />
                <span className="sr-only">Scroll to bottom</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Scroll to bottom</TooltipContent>
          </Tooltip>
        )}

        {/* Tail toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isTailing ? "default" : "outline"}
              size="sm"
              onClick={onToggleTailing}
              className="gap-1.5"
            >
              {isTailing ? (
                <>
                  <Pause className="size-3" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="size-3" />
                  Tail
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{isTailing ? "Pause live updates" : "Follow new logs"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// =============================================================================
// Connected Component
// =============================================================================

/**
 * LogToolbar connected to the store.
 * Use this for automatic store integration.
 */
export function LogToolbarConnected({
  totalCount,
  filteredCount,
  onDownload,
  onScrollToBottom,
  onRefresh,
  isLoading,
  className,
}: Omit<LogToolbarProps, "isTailing" | "onToggleTailing" | "wrapLines" | "onToggleWrapLines">) {
  const isTailing = useLogViewerStore((s) => s.isTailing);
  const toggleTailing = useLogViewerStore((s) => s.toggleTailing);
  const wrapLines = useLogViewerStore((s) => s.wrapLines);
  const toggleWrapLines = useLogViewerStore((s) => s.toggleWrapLines);

  return (
    <LogToolbarInner
      totalCount={totalCount}
      filteredCount={filteredCount}
      isTailing={isTailing}
      onToggleTailing={toggleTailing}
      wrapLines={wrapLines}
      onToggleWrapLines={toggleWrapLines}
      onDownload={onDownload}
      onScrollToBottom={onScrollToBottom}
      onRefresh={onRefresh}
      isLoading={isLoading}
      className={className}
    />
  );
}

export const LogToolbar = memo(LogToolbarInner);
