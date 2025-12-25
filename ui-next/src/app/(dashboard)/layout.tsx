// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { Shell } from "@/components/shell";

/**
 * Dashboard layout.
 *
 * Error handling is automatic via Next.js error.tsx files:
 * - (dashboard)/error.tsx - Catches all dashboard errors
 * - (dashboard)/pools/error.tsx - Catches pool-specific errors
 * - (dashboard)/resources/error.tsx - Catches resource-specific errors
 *
 * No manual ErrorBoundary wrapper needed!
 */
export default function DashboardLayout(props: { children: React.ReactNode }) {
  return <Shell>{props.children}</Shell>;
}
