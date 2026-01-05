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
 * Dashboard-level error boundary.
 *
 * This file is automatically used by Next.js as an error boundary
 * for all routes under (dashboard)/. No manual wrapping needed.
 *
 * The Shell/layout remains visible - only the page content is replaced.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Something went wrong"
      description="An unexpected error occurred. Don't worry, your data is safe."
      logPrefix="Dashboard error boundary"
      centered
    />
  );
}
