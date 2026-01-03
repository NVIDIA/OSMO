// Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { RouteError } from "@/components/route-error";

/**
 * Resources page error boundary.
 *
 * Catches errors in /resources.
 */
export default function ResourcesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Resources unavailable"
      description="We couldn't fetch the resource list. Give it another shot."
      header={
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            View and filter resources across all pools
          </p>
        </div>
      }
      logPrefix="Resources error boundary"
    />
  );
}
