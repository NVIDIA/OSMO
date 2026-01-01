// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from "react-error-boundary";
import { RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logError } from "@/lib/logger";

// =============================================================================
// Inline Fallback Component
// =============================================================================

export interface InlineFallbackProps extends FallbackProps {
  /** Optional title */
  title?: string;
  /** Custom className */
  className?: string;
  /** Compact mode - smaller, less prominent */
  compact?: boolean;
}

/**
 * Inline error fallback - shows error without disrupting page layout.
 * Uses amber colors for warnings, red for critical errors.
 */
export function InlineFallback({
  error,
  resetErrorBoundary,
  title = "Something went wrong",
  className,
  compact = false,
}: InlineFallbackProps) {
  const message = error?.message || "An unexpected error occurred";

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/30",
          className,
        )}
      >
        <AlertCircle className="size-4 shrink-0 text-red-500" />
        <span className="flex-1 truncate text-red-700 dark:text-red-300">{message}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetErrorBoundary}
          className="h-6 gap-1 px-2 text-xs text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
        >
          <RefreshCw className="size-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
          <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-red-900 dark:text-red-100">{title}</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{message}</p>

          <Button
            variant="outline"
            size="sm"
            onClick={resetErrorBoundary}
            className="mt-3 gap-1.5 border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
          >
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Inline Error Boundary
// =============================================================================

export interface InlineErrorBoundaryProps {
  /** Children to render */
  children: React.ReactNode;
  /** Optional title for fallback */
  title?: string;
  /** Custom className for fallback */
  className?: string;
  /** Compact mode for fallback */
  compact?: boolean;
  /** Reset keys - when these change, the boundary resets */
  resetKeys?: unknown[];
  /** Callback when error is caught */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Callback when boundary resets */
  onReset?: () => void;
}

/**
 * Inline error boundary that doesn't disrupt page layout.
 *
 * Uses react-error-boundary under the hood for reliable error catching.
 * Logs errors automatically and provides retry functionality.
 *
 * @example
 * ```tsx
 * // Wrap a component that might fail
 * <InlineErrorBoundary title="Unable to load pools">
 *   <PoolsTable />
 * </InlineErrorBoundary>
 *
 * // Compact mode for smaller areas
 * <InlineErrorBoundary compact resetKeys={[poolId]}>
 *   <PoolDetails poolId={poolId} />
 * </InlineErrorBoundary>
 * ```
 */
export function InlineErrorBoundary({
  children,
  title,
  className,
  compact = false,
  resetKeys,
  onError,
  onReset,
}: InlineErrorBoundaryProps) {
  const handleError = (error: Error, info: React.ErrorInfo) => {
    logError("Inline error boundary caught:", error, info);
    onError?.(error, info);
  };

  return (
    <ReactErrorBoundary
      fallbackRender={(props) => (
        <InlineFallback {...props} title={title} className={className} compact={compact} />
      )}
      onError={handleError}
      onReset={onReset}
      resetKeys={resetKeys}
    >
      {children}
    </ReactErrorBoundary>
  );
}
