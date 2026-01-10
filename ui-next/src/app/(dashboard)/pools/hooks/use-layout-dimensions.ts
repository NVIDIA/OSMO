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

import { useCssVarDimensions, type CssVarConfig } from "@/lib/css-utils";

// =============================================================================
// Table Layout Dimensions
// =============================================================================

/**
 * CSS variable configuration for pools table dimensions.
 * Single source of truth for CSS variable names and fallback values.
 */
const POOLS_DIMENSIONS_CONFIG = {
  headerHeight: ["--pools-header-height", "2.25rem"],
  sectionHeight: ["--pools-section-height", "2.25rem"],
  rowHeight: ["--pools-row-height", "3rem"],
  rowHeightCompact: ["--pools-row-height-compact", "2rem"],
} as const satisfies CssVarConfig<string>;

type PoolsDimensionKey = keyof typeof POOLS_DIMENSIONS_CONFIG;

/**
 * Returns pools table layout dimensions from CSS custom properties.
 *
 * Uses generic useCssVarDimensions hook for consistent behavior.
 * Fallbacks ensure correct values even during SSR/initial hydration.
 */
export function useLayoutDimensions(): Record<PoolsDimensionKey, number> {
  return useCssVarDimensions(POOLS_DIMENSIONS_CONFIG);
}
