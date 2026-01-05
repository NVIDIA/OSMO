// Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { RouteError } from "@/components/error";

/**
 * Pools section error boundary.
 *
 * Catches errors in /pools and /pools/[poolName].
 */
export default function PoolsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Couldn't load pool data"
      description="We hit a snag while fetching this pool. This is usually temporary."
      backLink={{ href: "/pools", label: "Back to Pools" }}
      logPrefix="Pools error boundary"
    />
  );
}
