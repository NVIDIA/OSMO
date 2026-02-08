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
 * FilterBar - Composable search and filter component.
 *
 * Pure composition layer: orchestrates hooks, refs, and sub-components.
 * Zero business logic - all state management lives in useFilterState.
 *
 * Architecture:
 *   FilterBar (this file) - composition + refs
 *     -> useFilterState    - orchestration hook (all state + actions)
 *     -> FilterBarInput    - input container with chips
 *     -> FilterBarDropdown - dropdown with virtualized suggestions
 */

"use client";

import { useRef, useCallback, useEffect, memo, useId } from "react";
import { cn } from "@/lib/utils";
import { Command } from "@/components/shadcn/command";
import type { FilterBarProps } from "@/components/filter-bar/lib/types";
import { useFilterState } from "@/components/filter-bar/hooks/use-filter-state";
import { FilterBarInput } from "@/components/filter-bar/FilterBarInput";
import { FilterBarDropdown } from "@/components/filter-bar/FilterBarDropdown";

function FilterBarInner<T>({
  data,
  fields,
  chips,
  onChipsChange,
  placeholder = "Search... (try 'pool:' or 'platform:')",
  className,
  displayMode,
  presets,
  resultsCount,
}: FilterBarProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // ========== Orchestration hook: all state + actions ==========

  const {
    inputValue,
    focusedChipIndex,
    validationError,
    selectables,
    hints,
    showPresets,
    showDropdown,
    isFieldLoading,
    loadingFieldLabel,
    handleSelect,
    handleInputChange,
    handleFocus,
    handleChipRemove,
    handleClearAll,
    handleBlur,
    handleBackdropDismiss,
    handleKeyDown,
    isPresetActive,
    setInputRefCallbacks,
  } = useFilterState({
    chips,
    onChipsChange,
    data,
    fields,
    displayMode,
    presets,
  });

  // ========== Wire input ref to orchestration hook ==========

  useEffect(() => {
    setInputRefCallbacks({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      getSelectionStart: () => inputRef.current?.selectionStart ?? null,
      getSelectionEnd: () => inputRef.current?.selectionEnd ?? null,
    });
  }, [setInputRefCallbacks]);

  // ========== DOM event adapters ==========

  const handleBlurEvent = useCallback(
    (e: React.FocusEvent) => {
      handleBlur(containerRef.current, e.relatedTarget);
    },
    [handleBlur],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleBackdropDismiss();
    },
    [handleBackdropDismiss],
  );

  // ========== Composition ==========

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onBlur={handleBlurEvent}
    >
      <Command
        shouldFilter={false}
        loop
        label="Search and filter"
        className="overflow-visible bg-transparent"
      >
        {/* Visually hidden label for accessibility and autofill */}
        <label
          htmlFor={inputId}
          className="sr-only"
        >
          Search and filter
        </label>

        <FilterBarInput
          chips={chips}
          focusedChipIndex={focusedChipIndex}
          validationError={validationError}
          inputValue={inputValue}
          showDropdown={showDropdown}
          placeholder={placeholder}
          resultsCount={resultsCount}
          inputRef={inputRef}
          inputId={inputId}
          onChipRemove={handleChipRemove}
          onFocus={handleFocus}
          onInputChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onClearAll={handleClearAll}
        />

        <FilterBarDropdown
          showDropdown={showDropdown}
          validationError={validationError}
          showPresets={showPresets}
          presets={presets}
          hints={hints}
          selectables={selectables}
          onSelect={handleSelect}
          onBackdropClick={handleBackdropClick}
          isPresetActive={isPresetActive}
          isFieldLoading={isFieldLoading}
          loadingFieldLabel={loadingFieldLabel}
        />
      </Command>
    </div>
  );
}

// Memoized export
export const FilterBar = memo(FilterBarInner) as typeof FilterBarInner;
