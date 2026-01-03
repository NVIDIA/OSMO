/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo } from "react";
import { ExpandableChips } from "@/components/expandable-chips";
import { getChipLayoutCompact } from "../../hooks/use-layout-dimensions";

// =============================================================================
// Types
// =============================================================================

export interface PlatformPillsProps {
  /** List of platform names */
  platforms: string[];
  /** Whether to allow expansion */
  expandable?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * PlatformPills - Pool-specific wrapper for platform chips.
 *
 * Composes from ExpandableChips with pool-specific layout dimensions.
 *
 * @example
 * ```tsx
 * <PlatformPills platforms={pool.platforms} />
 * ```
 */
export const PlatformPills = memo(function PlatformPills({
  platforms,
  expandable = true,
}: PlatformPillsProps) {
  const layout = useMemo(() => getChipLayoutCompact(), []);

  return (
    <ExpandableChips
      items={platforms}
      layout={layout}
      expandable={expandable}
    />
  );
});
