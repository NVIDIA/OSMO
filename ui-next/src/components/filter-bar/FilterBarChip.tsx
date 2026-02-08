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
 * FilterBarChip - Individual filter chip with remove button.
 *
 * Displays a chip with field:value label and optional Free/Used variant styling.
 * Keyboard-focusable with visible focus ring.
 */

"use client";

import { memo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dropdownStyles, chipStyles, chipVariantStyles } from "@/components/filter-bar/styles";
import type { SearchChip } from "@/components/filter-bar/lib/types";

export interface FilterBarChipProps {
  chip: SearchChip;
  onRemove: () => void;
  focused?: boolean;
}

/**
 * Renders a single filter chip with variant-aware label and remove button.
 *
 * Variant styling parses labels like "Quota Free: >=10" to highlight
 * the Free/Used segment with semantic color.
 */
export const FilterBarChip = memo(function FilterBarChip({ chip, onRemove, focused = false }: FilterBarChipProps) {
  const renderLabel = () => {
    if (!chip.variant) return chip.label;

    // Match patterns like "Quota Free: >=10" or "Capacity Used: >=80%"
    const match = chip.label.match(/^(.+?)\s+(Free|Used):\s*(.+)$/);
    if (!match) return chip.label;

    const [, prefix, freeUsed, value] = match;
    const variantClass = chipVariantStyles[chip.variant];

    return (
      <>
        {prefix} <span className={cn("font-semibold", variantClass)}>{freeUsed}</span>: {value}
      </>
    );
  };

  return (
    <span className={cn(chipStyles.chip, focused && dropdownStyles.focusRing)}>
      {renderLabel()}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={chipStyles.chipButton}
      >
        <X className="size-3" />
      </button>
    </span>
  );
});
