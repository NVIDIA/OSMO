/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
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
export const PlatformPills = memo(function PlatformPills({ platforms, expandable = true }: PlatformPillsProps) {
  const layout = useMemo(() => getChipLayoutCompact(), []);

  return (
    <ExpandableChips
      items={platforms}
      layout={layout}
      expandable={expandable}
    />
  );
});
