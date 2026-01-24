//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import { memo } from "react";
import { FilterBar } from "@/components/filter-bar";
import type { SearchField, SearchChip, SearchPreset } from "@/components/filter-bar/lib/types";

// =============================================================================
// Types
// =============================================================================

export interface SearchBarProps<T = unknown> {
  /** Data to filter */
  data: T[];
  /** Field definitions for filtering */
  fields: readonly SearchField<T>[];
  /** Current filter chips */
  chips: SearchChip[];
  /** Callback when chips change */
  onChipsChange: (chips: SearchChip[]) => void;
  /** Optional filter presets */
  presets?: {
    label: string;
    items: SearchPreset[];
  }[];
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function SearchBarInner<T>({
  data,
  fields,
  chips,
  onChipsChange,
  presets,
  placeholder = "Search logs or use level:, task:, source:, pod:...",
  className,
}: SearchBarProps<T>) {
  return (
    <FilterBar
      data={data}
      fields={fields}
      chips={chips}
      onChipsChange={onChipsChange}
      presets={presets}
      placeholder={placeholder}
      className={className}
    />
  );
}

export const SearchBar = memo(SearchBarInner) as typeof SearchBarInner;
