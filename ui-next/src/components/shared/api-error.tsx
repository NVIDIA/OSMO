// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { RefreshCw, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "./error-details";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/** Error-like object that has at least a message or detail */
interface ErrorLike {
  message?: string;
  detail?: string | { msg: string }[];
  stack?: string;
}

export interface ApiErrorProps {
  /** Error object from React Query (can be Error or API error response) */
  error: ErrorLike | null;
  /** Retry function (usually refetch from React Query) */
  onRetry?: () => void;
  /** Optional title override */
  title?: string;
  /** Optional className for container */
  className?: string;
  /**
   * Enable auth-aware mode: shows login prompt for unauthenticated users.
   * When true, unauthenticated users see a simpler "Log in" message.
   * When false (default), all users see the full error details.
   */
  authAware?: boolean;
  /** Message shown when user is not authenticated (only used when authAware=true) */
  loginMessage?: string;
}

/**
 * Inline error display for API failures.
 *
 * Use this when a query fails but the page should still render.
 * Shows the actual error message with optional retry.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ApiError error={error} onRetry={refetch} title="Unable to load pools" />
 *
 * // Auth-aware: shows login prompt for unauthenticated users
 * <ApiError
 *   error={error}
 *   onRetry={refetch}
 *   title="Unable to load pools"
 *   authAware
 *   loginMessage="You need to log in to view pools."
 * />
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

export function ApiError({
  error,
  onRetry,
  title = "Failed to load data",
  className,
  authAware = false,
  loginMessage = "You need to log in to view this content.",
}: ApiErrorProps) {
  const { isAuthenticated, authEnabled, login } = useAuth();

  if (!error) return null;

  const message = getErrorMessage(error);

  // Auth-aware mode: show login prompt only if auth is enabled and user is not authenticated
  if (authAware && authEnabled && !isAuthenticated) {
    return (
      <div
        data-testid="api-error-login"
        className={cn(
          "rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">{title}</p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{loginMessage}</p>
          </div>

          <div className="flex shrink-0 gap-2">
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRetry()}
                className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            <Button
              size="sm"
              onClick={login}
              className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
            >
              <LogIn className="h-3.5 w-3.5" />
              Log in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Standard error display
  return (
    <div
      data-testid="api-error"
      className={cn("rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900", className)}
    >
      {/* Header with title and retry */}
      <div className="flex items-center justify-between gap-4 p-4">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>

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
