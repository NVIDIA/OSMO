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

import { useMemo } from "react";
import { getCssVarPx } from "@/lib/css-utils";

// =============================================================================
// Table Layout Dimensions
// =============================================================================

interface LayoutDimensions {
  headerHeight: number;
  sectionHeight: number;
  rowHeight: number;
  rowHeightCompact: number;
}

/**
 * Returns table layout dimensions from CSS custom properties.
 *
 * Uses useMemo to read values once on mount (no re-render).
 * Fallbacks ensure correct values even during SSR/initial hydration.
 */
export function useLayoutDimensions(): LayoutDimensions {
  return useMemo(
    () => ({
      headerHeight: getCssVarPx("--pools-header-height", "2.25rem"),
      sectionHeight: getCssVarPx("--pools-section-height", "2.25rem"),
      rowHeight: getCssVarPx("--pools-row-height", "3rem"),
      rowHeightCompact: getCssVarPx("--pools-row-height-compact", "2rem"),
    }),
    [],
  );
}
