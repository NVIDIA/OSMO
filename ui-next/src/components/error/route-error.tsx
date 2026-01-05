// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useEffect } from "react";
import { RefreshCw, Home, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import { ErrorDetails } from "./error-details";
import { logError } from "@/lib/logger";

// =============================================================================
// Types
// =============================================================================

export interface RouteErrorProps {
  /** The error that was thrown */
  error: Error & { digest?: string };
  /** Reset function from Next.js error boundary */
  reset: () => void;
  /** Error title displayed to user */
  title: string;
  /** Error description */
  description: string;
  /** Optional back link (shows arrow + label) */
  backLink?: { href: string; label: string };
  /** Optional header content (e.g., page title) */
  header?: React.ReactNode;
  /** Log prefix for error logging */
  logPrefix?: string;
  /** Whether to center the error card (dashboard-level style) */
  centered?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * RouteError - Shared error boundary UI for route-level errors.
 *
 * Used by Next.js error.tsx files to display consistent error UI.
 *
 * @example
 * ```tsx
 * // pools/error.tsx
 * export default function PoolsError({ error, reset }) {
 *   return (
 *     <RouteError
 *       error={error}
 *       reset={reset}
 *       title="Couldn't load pool data"
 *       description="We hit a snag while fetching this pool."
 *       backLink={{ href: "/pools", label: "Back to Pools" }}
 *       logPrefix="Pools error boundary"
 *     />
 *   );
 * }
 * ```
 */
export function RouteError({
  error,
  reset,
  title,
  description,
  backLink,
  header,
  logPrefix = "Route error",
  centered = false,
}: RouteErrorProps) {
  useEffect(() => {
    logError(`${logPrefix} caught:`, error);
  }, [error, logPrefix]);

  if (centered) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="w-full max-w-lg text-center">
          <h2 className="mb-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>

          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>

          <div className="mb-6 text-left">
            <ErrorDetails
              error={error}
              className="bg-zinc-50 dark:bg-zinc-900"
            />
          </div>

          <div className="flex justify-center gap-3">
            <Button
              onClick={reset}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/")}
              className="gap-2"
            >
              <Home className="h-4 w-4" />
              Go home
            </Button>
          </div>

          <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
            If this keeps happening, try refreshing the page
            {error.digest && (
              <span className="mt-1 block font-mono text-zinc-300 dark:text-zinc-600">Error ID: {error.digest}</span>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link or header */}
      {backLink && (
        <div className="flex items-center gap-4">
          <Link
            href={backLink.href}
            className="flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLink.label}
          </Link>
        </div>
      )}
      {header}

      {/* Error card */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <h2 className="mb-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>

          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>

        <div className="mx-auto mb-6 max-w-lg">
          <ErrorDetails error={error} />
        </div>

        <div className="flex justify-center gap-3">
          <Button
            onClick={reset}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => (window.location.href = "/")}
            className="gap-2"
          >
            <Home className="h-4 w-4" />
            Go home
          </Button>
        </div>

        {error.digest && (
          <p className="mt-4 text-center text-xs font-mono text-zinc-400 dark:text-zinc-600">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
