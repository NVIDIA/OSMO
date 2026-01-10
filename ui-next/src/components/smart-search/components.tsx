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
 * SmartSearch UI components.
 *
 * Core components for SmartSearch:
 * - ChipLabel: Chip display with variants
 * - PresetContent: Wrapper for caller-provided preset rendering
 *
 * Note: Dropdown rendering is handled by cmdk (shadcn/ui Command).
 */

"use client";

import { memo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dropdownStyles, chipStyles, chipVariantStyles } from "./styles";
import type { SearchChip, SearchPreset } from "./lib";

// ============================================================================
// Chip Components
// ============================================================================

export interface ChipLabelProps {
  chip: SearchChip;
  onRemove: () => void;
  focused?: boolean;
}

/**
 * Chip label component with variant styling for Free/Used.
 */
export const ChipLabel = memo(function ChipLabel({ chip, onRemove, focused = false }: ChipLabelProps) {
  // Parse label to find "Free" or "Used" for styling
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

// ============================================================================
// Preset Components
// ============================================================================

export interface PresetContentProps {
  preset: SearchPreset;
  isActive: boolean;
  /** Whether this preset is focused via keyboard (cmdk provides this via data-selected) */
  isFocused?: boolean;
}

/**
 * Preset content for rendering inside CommandItem.
 *
 * SmartSearch is agnostic about preset content - it delegates all rendering
 * to the caller-provided render function. This enables dependency injection
 * and keeps the component decoupled from data concerns like counts.
 */
export const PresetContent = memo(function PresetContent({ preset, isActive, isFocused = false }: PresetContentProps) {
  return <>{preset.render({ active: isActive, focused: isFocused })}</>;
});
