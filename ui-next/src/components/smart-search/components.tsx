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
 * Split into two categories:
 *
 * KEEP (core to SmartSearch):
 * - ChipLabel: Chip display with variants
 * - PresetButton/PresetGroup: Preset filter buttons
 *
 * REPLACEABLE (by cmdk/shadcn Command):
 * - DropdownHint: Hint/error messages → CommandEmpty or custom
 * - DropdownItem: Suggestion items → CommandItem
 * - DropdownFooter: Keyboard hints → custom footer
 */

"use client";

import { memo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dropdownStyles, chipStyles, chipVariantStyles } from "./styles";
import type { SearchChip, SearchPreset } from "./lib";

// ============================================================================
// Chip Components - KEEP (core to SmartSearch)
// ============================================================================

export interface ChipLabelProps {
  chip: SearchChip;
  onRemove: () => void;
  focused?: boolean;
}

/**
 * Chip label component with variant styling for Free/Used.
 * This component is core to SmartSearch and stays regardless of dropdown impl.
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
// Preset Components - KEEP (core to SmartSearch)
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
 * This component is core to SmartSearch and stays regardless of dropdown impl.
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

// ============================================================================
// Dropdown Components - REPLACEABLE by cmdk/shadcn Command
// ============================================================================

export interface DropdownHintProps {
  message: string;
  isError?: boolean;
}

/**
 * Non-interactive hint or error message in dropdown.
 *
 * ⚠️ REPLACEABLE: When using cmdk, replace with CommandEmpty or custom element.
 */
export const DropdownHint = memo(function DropdownHint({ message, isError = false }: DropdownHintProps) {
  return (
    <div
      className={cn(
        dropdownStyles.dropdownItem,
        dropdownStyles.nonInteractive,
        isError
          ? cn("border-b border-red-100 dark:border-red-900", dropdownStyles.error)
          : cn("border-b border-zinc-100 italic dark:border-zinc-800", dropdownStyles.muted),
      )}
    >
      {isError && "⚠ "}
      {message}
    </div>
  );
});

export interface DropdownItemProps {
  label: React.ReactNode;
  hint?: string;
  isHighlighted: boolean;
  showTabHint?: boolean;
  isFieldType?: boolean;
  highlightIndex: number;
  onClick: () => void;
  onMouseEnter: () => void;
}

/**
 * Interactive suggestion item in dropdown.
 *
 * ⚠️ REPLACEABLE: When using cmdk, replace with CommandItem.
 */
export const DropdownItem = memo(function DropdownItem({
  label,
  hint,
  isHighlighted,
  showTabHint = false,
  isFieldType = false,
  highlightIndex,
  onClick,
  onMouseEnter,
}: DropdownItemProps) {
  return (
    <button
      type="button"
      data-highlight-index={highlightIndex}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex w-full items-center justify-between text-left",
        dropdownStyles.dropdownItem,
        isHighlighted ? dropdownStyles.highlighted : cn("text-zinc-700 dark:text-zinc-300", dropdownStyles.hoverBg),
      )}
      role="option"
      aria-selected={isHighlighted}
    >
      <span className="flex items-center gap-2">
        {isFieldType ? (
          <>
            <span className={cn("font-mono text-xs", dropdownStyles.prefix)}>{label}</span>
            {hint && <span className={dropdownStyles.muted}>{hint}</span>}
          </>
        ) : (
          <span>{label}</span>
        )}
      </span>
      {showTabHint && (
        <kbd className={cn("hidden px-1.5 py-0.5 text-xs sm:inline", dropdownStyles.kbd, dropdownStyles.muted)}>
          Tab
        </kbd>
      )}
    </button>
  );
});

export interface DropdownFooterProps {
  children?: React.ReactNode;
}

/**
 * Footer with keyboard hints.
 *
 * ⚠️ REPLACEABLE: When using cmdk, can remove or use custom footer.
 */
export const DropdownFooter = memo(function DropdownFooter({ children }: DropdownFooterProps) {
  return (
    <div className={cn("border-t px-3 py-2 text-xs", dropdownStyles.border, dropdownStyles.muted)}>
      {children ?? (
        <>
          <kbd className={dropdownStyles.kbd}>↑↓</kbd> navigate <kbd className={dropdownStyles.kbd}>Tab</kbd> complete{" "}
          <kbd className={dropdownStyles.kbd}>Enter</kbd> select <kbd className={dropdownStyles.kbd}>Esc</kbd> close
        </>
      )}
    </div>
  );
});
