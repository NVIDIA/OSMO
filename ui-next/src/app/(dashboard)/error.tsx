// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useEffect } from "react";
import { RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/shared";
import { logError } from "@/lib/logger";

/**
 * Dashboard-level error boundary.
 * 
 * This file is automatically used by Next.js as an error boundary
 * for all routes under (dashboard)/. No manual wrapping needed.
 * 
 * The Shell/layout remains visible - only the page content is replaced.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("Dashboard error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="w-full max-w-lg text-center">
        <h2 className="mb-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Something went wrong
        </h2>
        
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          An unexpected error occurred. Don&apos;t worry, your data is safe.
        </p>

        {/* Error details */}
        <div className="mb-6 text-left">
          <ErrorDetails error={error} className="bg-zinc-50 dark:bg-zinc-900" />
        </div>

        <div className="flex justify-center gap-3">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.href = "/"}
            className="gap-2"
          >
            <Home className="h-4 w-4" />
            Go home
          </Button>
        </div>

        <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
          If this keeps happening, try refreshing the page
          {error.digest && (
            <span className="mt-1 block font-mono text-zinc-300 dark:text-zinc-600">
              Error ID: {error.digest}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
