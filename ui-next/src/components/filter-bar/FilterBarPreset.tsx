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

/**
 * FilterBarPreset - Preset button content for FilterBar dropdown.
 *
 * Delegates all visual rendering to the caller-provided render function.
 * FilterBar is agnostic about preset content - this is pure dependency injection.
 */

"use client";

import { memo } from "react";
import type { SearchPreset } from "@/components/filter-bar/lib/types";

export interface FilterBarPresetProps {
  preset: SearchPreset;
  isActive: boolean;
  /** Whether this preset is focused via keyboard (cmdk provides this via data-selected) */
  isFocused?: boolean;
}

/**
 * Preset content rendered inside CommandItem.
 *
 * FilterBar is agnostic about preset content - it delegates all rendering
 * to the caller-provided render function. This enables dependency injection
 * and keeps the component decoupled from data concerns like counts.
 */
export const FilterBarPreset = memo(function FilterBarPreset({
  preset,
  isActive,
  isFocused = false,
}: FilterBarPresetProps) {
  return <>{preset.render({ active: isActive, focused: isFocused })}</>;
});
