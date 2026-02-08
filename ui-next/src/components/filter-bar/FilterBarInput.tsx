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
 * FilterBarInput - Input container with chips, search icon, and results count.
 *
 * Pure presentational component: receives all state and callbacks from parent.
 * Contains: search icon, filter chips, text input, clear button, results count.
 */

"use client";

import { memo, useCallback, type RefObject } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputStyles, dropdownStyles } from "@/components/filter-bar/styles";
import { FilterBarChip } from "@/components/filter-bar/FilterBarChip";
import type { SearchChip, ResultsCount } from "@/components/filter-bar/lib/types";

export interface FilterBarInputProps {
  /** Current filter chips */
  chips: SearchChip[];
  /** Index of keyboard-focused chip (-1 = none) */
  focusedChipIndex: number;
  /** Current validation error (affects border/icon color) */
  validationError: string | null;
  /** Current text input value */
  inputValue: string;
  /** Whether the dropdown is visible (for aria-expanded) */
  showDropdown: boolean;
  /** Placeholder text when no chips are present */
  placeholder: string;
  /** Results count display */
  resultsCount?: ResultsCount;
  /** Ref for the text input element */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Unique ID for the input element (for label association) */
  inputId: string;
  /** Called when a chip's remove button is clicked */
  onChipRemove: (index: number) => void;
  /** Called when input receives focus */
  onFocus: () => void;
  /** Called when input value changes */
  onInputChange: (value: string) => void;
  /** Called on keydown (chip navigation, Enter, Escape, etc.) */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Called when clear-all button is clicked */
  onClearAll: () => void;
}

export const FilterBarInput = memo(function FilterBarInput({
  chips,
  focusedChipIndex,
  validationError,
  inputValue,
  showDropdown,
  placeholder,
  resultsCount,
  inputRef,
  inputId,
  onChipRemove,
  onFocus,
  onInputChange,
  onKeyDown,
  onClearAll,
}: FilterBarInputProps) {
  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  const handleInputChangeEvent = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onInputChange(e.target.value);
    },
    [onInputChange],
  );

  const handleClearAllClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClearAll();
    },
    [onClearAll],
  );

  return (
    <div
      className={cn(
        inputStyles.container,
        dropdownStyles.border,
        dropdownStyles.surface,
        validationError && inputStyles.containerError,
      )}
      onClick={handleContainerClick}
    >
      <Search
        className={cn(
          "size-4 shrink-0 transition-colors",
          validationError ? "text-red-500" : dropdownStyles.mutedLight,
        )}
      />

      {chips.map((chip, index) => (
        <FilterBarChip
          key={`${chip.field}-${chip.value}-${index}`}
          chip={chip}
          onRemove={() => onChipRemove(index)}
          focused={focusedChipIndex === index}
        />
      ))}

      {/* Custom input - cmdk's CommandInput has its own search icon which we don't want */}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={inputValue}
        onChange={handleInputChangeEvent}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={chips.length === 0 ? placeholder : "Add filter..."}
        className={inputStyles.input}
        role="combobox"
        aria-expanded={showDropdown || undefined}
        aria-controls="filter-bar-listbox"
        aria-haspopup="listbox"
      />

      {/* Clear filters */}
      {chips.length > 0 && (
        <button
          type="button"
          onClick={handleClearAllClick}
          className={cn(inputStyles.clearButton, dropdownStyles.muted, dropdownStyles.hoverBg)}
        >
          <X className="size-3" />
          <span>Clear</span>
        </button>
      )}

      {/* Results count */}
      {resultsCount && (
        <span className={cn("shrink-0 text-xs tabular-nums", dropdownStyles.muted)}>
          {resultsCount.filtered !== undefined ? (
            <>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {resultsCount.filtered.toLocaleString()}
              </span>
              {" of "}
              {resultsCount.total.toLocaleString()}
              {" results"}
            </>
          ) : (
            <>
              {resultsCount.total.toLocaleString()}
              {" results"}
            </>
          )}
        </span>
      )}
    </div>
  );
});
