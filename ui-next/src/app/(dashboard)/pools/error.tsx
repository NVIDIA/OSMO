// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useEffect } from "react";
import { RefreshCw, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/shared";
import { logError } from "@/lib/logger";

/**
 * Pools section error boundary.
 * 
 * Catches errors in /pools and /pools/[poolName].
 */
export default function PoolsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("Pools error boundary caught:", error);
  }, [error]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb back */}
      <div className="flex items-center gap-4">
        <Link
          href="/pools"
          className="flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Pools
        </Link>
      </div>

      {/* Error card */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <h2 className="mb-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Couldn&apos;t load pool data
          </h2>
          
          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            We hit a snag while fetching this pool. This is usually temporary.
          </p>
        </div>

        {/* Error details */}
        <div className="mx-auto mb-6 max-w-lg">
          <ErrorDetails error={error} />
        </div>

        <div className="flex justify-center gap-3">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/pools">View all pools</Link>
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
