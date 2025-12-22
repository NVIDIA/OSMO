// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "./error-details";
import { cn } from "@/lib/utils";

/** Error-like object that has at least a message or detail */
interface ErrorLike {
  message?: string;
  detail?: string | { msg: string }[];
  stack?: string;
}

interface ApiErrorProps {
  /** Error object from React Query (can be Error or API error response) */
  error: ErrorLike | null;
  /** Retry function (usually refetch from React Query) */
  onRetry?: () => void;
  /** Optional title override */
  title?: string;
  /** Optional className for container */
  className?: string;
}

/**
 * Inline error display for API failures.
 * 
 * Use this when a query fails but the page should still render.
 * Shows the actual error message with optional retry.
 * 
 * @example
 * ```tsx
 * const { data, error, refetch, isLoading } = usePools();
 * 
 * if (error) {
 *   return <ApiError error={error} onRetry={refetch} />;
 * }
 * ```
 */
/** Extract message from various error formats */
function getErrorMessage(error: ErrorLike): string {
  if (error.message) return error.message;
  if (typeof error.detail === "string") return error.detail;
  if (Array.isArray(error.detail) && error.detail[0]?.msg) {
    return error.detail.map((d) => d.msg).join(", ");
  }
  return "An unexpected error occurred";
}

export function ApiError({ error, onRetry, title, className }: ApiErrorProps) {
  if (!error) return null;

  const message = getErrorMessage(error);

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900",
        className
      )}
    >
      {/* Header with title and retry */}
      <div className="flex items-center justify-between gap-4 p-4">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          {title || "Failed to load data"}
        </p>

        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetry()}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </div>

      {/* Error message and stack trace */}
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <ErrorDetails 
          error={{ message, stack: error.stack } as Error} 
          className="rounded-none border-0" 
        />
      </div>
    </div>
  );
}
