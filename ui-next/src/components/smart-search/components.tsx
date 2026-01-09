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
 * - PresetButton/PresetGroup: Preset filter buttons
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

export interface PresetButtonProps<T> {
  preset: SearchPreset<T>;
  data: T[];
  isActive: boolean;
  isHighlighted: boolean;
  highlightIndex: number;
  onClick: () => void;
  onMouseEnter: () => void;
}

/**
 * Preset filter button with optional custom render.
 */
export const PresetButton = memo(function PresetButton<T>({
  preset,
  data,
  isActive,
  isHighlighted,
  highlightIndex,
  onClick,
  onMouseEnter,
}: PresetButtonProps<T>) {
  const count = preset.count(data);

  // Custom render: user provides their own content and handles all visual states
  if (preset.render) {
    return (
      <button
        type="button"
        data-highlight-index={highlightIndex}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        className="rounded transition-all"
      >
        {preset.render({ active: isActive, focused: isHighlighted, count, label: preset.label })}
      </button>
    );
  }

  // Default render: dot + label + count
  const activeClasses = preset.badgeColors
    ? cn(preset.badgeColors.bg, preset.badgeColors.text)
    : "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200";

  return (
    <button
      type="button"
      data-highlight-index={highlightIndex}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        isActive
          ? activeClasses
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700",
        isHighlighted && dropdownStyles.focusRing,
      )}
    >
      <span className={cn("size-2 rounded-full", preset.dotColor)} />
      <span>{preset.label}</span>
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}) as <T>(props: PresetButtonProps<T>) => React.ReactElement;

export interface PresetGroupProps<T> {
  label: string;
  items: SearchPreset<T>[];
  data: T[];
  highlightedIndex: number;
  startIndex: number;
  isPresetActive: (preset: SearchPreset<T>) => boolean;
  onTogglePreset: (preset: SearchPreset<T>) => void;
  onHighlight: (index: number) => void;
}

/**
 * Group of preset buttons with label.
 */
export const PresetGroup = memo(function PresetGroup<T>({
  label,
  items,
  data,
  highlightedIndex,
  startIndex,
  isPresetActive,
  onTogglePreset,
  onHighlight,
}: PresetGroupProps<T>) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 border-b px-3 py-2",
        dropdownStyles.border,
      )}
    >
      <span className={cn("text-xs font-medium", dropdownStyles.muted)}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((preset, index) => {
          const currentIndex = startIndex + index;
          return (
            <PresetButton
              key={preset.id}
              preset={preset}
              data={data}
              isActive={isPresetActive(preset)}
              isHighlighted={highlightedIndex === currentIndex}
              highlightIndex={currentIndex}
              onClick={() => onTogglePreset(preset)}
              onMouseEnter={() => onHighlight(currentIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}) as <T>(props: PresetGroupProps<T>) => React.ReactElement;
