// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ShellTerminal Component (Lazy-Loaded)
 *
 * Interactive shell for exec into running task containers.
 * xterm.js (~480KB) is lazy-loaded only when this component renders.
 *
 * Usage:
 * ```tsx
 * import { ShellTerminal } from "@/components/shell";
 *
 * <ShellTerminal
 *   ref={shellRef}
 *   taskId={task.task_uuid}
 *   workflowName="my-workflow"
 *   taskName="train-model"
 * />
 * ```
 */

"use client";

import dynamic from "next/dynamic";
import { forwardRef, memo } from "react";
import { cn } from "@/lib/utils";
import type { ShellTerminalProps, ShellTerminalRef } from "./types";

// =============================================================================
// Loading Skeleton
// =============================================================================

/**
 * Shell loading skeleton - matches terminal aesthetic
 */
const ShellLoadingSkeleton = memo(function ShellLoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[200px] items-center justify-center",
        "bg-[#0a0a0f]", // Match terminal background
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
          <span className="text-sm text-zinc-400">Loading terminal...</span>
        </div>
      </div>
    </div>
  );
});

// =============================================================================
// Dynamic Import
// =============================================================================

/**
 * Dynamically import the implementation with SSR disabled.
 * This creates a separate chunk for xterm.js (~480KB) that only loads when needed.
 */
const ShellTerminalImpl = dynamic(() => import("./ShellTerminalImpl").then((mod) => mod.ShellTerminal), {
  ssr: false,
  loading: () => <ShellLoadingSkeleton />,
});

// =============================================================================
// Public API
// =============================================================================

/**
 * ShellTerminal - Lazy-loaded terminal component with ref forwarding.
 *
 * Note: Due to dynamic loading, the ref may be null during the loading phase.
 */
export const ShellTerminal = forwardRef<ShellTerminalRef, ShellTerminalProps>(function ShellTerminal(props, ref) {
  return (
    <ShellTerminalImpl
      {...props}
      ref={ref}
    />
  );
});
