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
 * SmartSearch Component
 *
 * Intelligent search input with chip-based filters, autocomplete suggestions,
 * and support for field-specific queries (pool:, platform:, backend:, etc.).
 *
 * Architecture:
 * - lib/: Core business logic (types, useChips, useSuggestions, filterByChips)
 *   → Never changes when swapping UI libraries
 *
 * - components.tsx: UI components split into:
 *   - ChipLabel, PresetButton/Group: KEEP (core to SmartSearch)
 *   - DropdownHint, DropdownItem, DropdownFooter: REPLACEABLE by cmdk
 *
 * - use-dropdown-navigation.ts: REPLACEABLE by cmdk's built-in navigation
 *
 * - styles.ts: Separated into dropdownStyles (replaceable) and chipStyles (keep)
 *
 * When migrating to cmdk:
 * 1. Add shadcn Command component to components/shadcn/command.tsx
 * 2. Replace dropdown rendering with Command/CommandList/CommandItem
 * 3. Remove useDropdownNavigation (cmdk handles keyboard nav)
 * 4. Keep: lib/*, ChipLabel, PresetButton/Group, chipStyles
 */

"use client";

import { useState, useRef, useCallback, memo } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// Core types (lib/) and hooks (hooks/) - never change with UI library swap
import type { SmartSearchProps } from "./lib";
import { useChips, useSuggestions } from "./hooks";

// UI layer (replaceable by cmdk)
import { dropdownStyles, inputStyles } from "./styles";
import { useDropdownNavigation } from "./use-dropdown-navigation";
import { ChipLabel, DropdownHint, DropdownItem, DropdownFooter, PresetGroup } from "./components";

// ============================================================================
// Component
// ============================================================================

function SmartSearchInner<T>({
  data,
  fields,
  chips,
  onChipsChange,
  placeholder = "Search... (try 'pool:' or 'platform:')",
  className,
  displayMode,
  presets,
}: SmartSearchProps<T>) {
  const [inputValue, setInputValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [focusedChipIndex, setFocusedChipIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ========== Core hooks (lib/) - never changes ==========
  const { addChip, removeChip, clearChips, isPresetActive, togglePreset, validationError, clearValidationError } =
    useChips({
      chips,
      onChipsChange,
      data,
      fields,
      displayMode,
    });

  const { parsedInput, suggestions, selectableSuggestions, flatPresets, totalNavigableCount } = useSuggestions({
    inputValue,
    fields,
    data,
    presets,
  });

  // ========== UI navigation (replaceable by cmdk) ==========
  const {
    highlightedIndex,
    setHighlightedIndex,
    navigateDown,
    navigateUp,
    navigateNext,
    isHighlightedPreset,
    getSuggestionIndex,
  } = useDropdownNavigation({
    totalNavigableCount,
    presetCount: flatPresets.length,
    isOpen: showDropdown,
    onOpen: () => setShowDropdown(true),
    dropdownRef,
  });

  // ========== Event handlers ==========

  const handleSelect = useCallback(
    (index: number) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;

      if (suggestion.type === "field") {
        setInputValue(suggestion.value);
        inputRef.current?.focus();
      } else {
        if (addChip(suggestion.field, suggestion.value)) {
          setInputValue("");
          setShowDropdown(false);
          inputRef.current?.focus();
        }
      }
    },
    [suggestions, addChip],
  );

  const handleTogglePreset = useCallback(
    (preset: (typeof flatPresets)[number]) => {
      togglePreset(preset);
      setInputValue("");
      setShowDropdown(false);
      inputRef.current?.focus();
    },
    [togglePreset],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const presetCount = flatPresets.length;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateDown();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateUp();
      } else if (e.key === "Tab" && totalNavigableCount > 0) {
        if (!showDropdown) {
          e.preventDefault();
          setShowDropdown(true);
          setHighlightedIndex(0);
        } else if (highlightedIndex >= 0) {
          e.preventDefault();
          navigateNext();
          const nextIndex = (highlightedIndex + 1) % totalNavigableCount;
          if (nextIndex >= presetCount) {
            const suggestion = selectableSuggestions[nextIndex - presetCount];
            if (suggestion) setInputValue(suggestion.label);
          }
        } else {
          e.preventDefault();
          setHighlightedIndex(0);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!showDropdown) {
          setShowDropdown(true);
        } else if (highlightedIndex >= 0) {
          if (isHighlightedPreset()) {
            const preset = flatPresets[highlightedIndex];
            if (preset) handleTogglePreset(preset);
          } else {
            const suggestionIndex = getSuggestionIndex(highlightedIndex);
            const originalIndex = suggestions.findIndex((s) => s === selectableSuggestions[suggestionIndex]);
            if (originalIndex >= 0) handleSelect(originalIndex);
          }
        } else if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
          if (addChip(parsedInput.field, parsedInput.query.trim())) {
            setInputValue("");
            setShowDropdown(false);
            inputRef.current?.focus();
          }
        }
      } else if (e.key === "ArrowLeft") {
        if (focusedChipIndex >= 0) {
          e.preventDefault();
          if (focusedChipIndex > 0) setFocusedChipIndex(focusedChipIndex - 1);
        } else if (showDropdown && highlightedIndex >= 0 && highlightedIndex < presetCount) {
          e.preventDefault();
          setHighlightedIndex(highlightedIndex > 0 ? highlightedIndex - 1 : presetCount - 1);
        } else if (chips.length > 0) {
          const cursorAtStart = inputRef.current?.selectionStart === 0 && inputRef.current?.selectionEnd === 0;
          if (cursorAtStart) {
            e.preventDefault();
            setFocusedChipIndex(chips.length - 1);
          }
        }
      } else if (e.key === "ArrowRight") {
        if (focusedChipIndex >= 0) {
          e.preventDefault();
          if (focusedChipIndex < chips.length - 1) {
            setFocusedChipIndex(focusedChipIndex + 1);
          } else {
            setFocusedChipIndex(-1);
            inputRef.current?.focus();
          }
        } else if (showDropdown && highlightedIndex >= 0 && highlightedIndex < presetCount) {
          e.preventDefault();
          setHighlightedIndex(highlightedIndex < presetCount - 1 ? highlightedIndex + 1 : 0);
        }
      } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
        if (focusedChipIndex >= 0) {
          e.preventDefault();
          removeChip(focusedChipIndex);
          setFocusedChipIndex(chips.length === 1 ? -1 : Math.min(focusedChipIndex, chips.length - 2));
        } else {
          setFocusedChipIndex(chips.length - 1);
        }
      } else if (e.key === "Delete" && focusedChipIndex >= 0) {
        e.preventDefault();
        removeChip(focusedChipIndex);
        setFocusedChipIndex(chips.length === 1 ? -1 : Math.min(focusedChipIndex, chips.length - 2));
      } else if (e.key === "Escape") {
        if (showDropdown) {
          e.preventDefault();
          e.stopPropagation();
          setShowDropdown(false);
        } else {
          inputRef.current?.blur();
        }
      }
    },
    [
      flatPresets,
      selectableSuggestions,
      suggestions,
      totalNavigableCount,
      highlightedIndex,
      showDropdown,
      handleSelect,
      handleTogglePreset,
      focusedChipIndex,
      parsedInput,
      inputValue,
      chips,
      addChip,
      removeChip,
      navigateDown,
      navigateUp,
      navigateNext,
      setHighlightedIndex,
      isHighlightedPreset,
      getSuggestionIndex,
    ],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      setShowDropdown(true);
      clearValidationError();
      setFocusedChipIndex(-1);
    },
    [clearValidationError],
  );

  const handleFocus = useCallback(() => {
    setShowDropdown(true);
    setFocusedChipIndex(-1);
  }, []);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  const handleChipRemove = useCallback(
    (index: number) => {
      removeChip(index);
      setFocusedChipIndex(-1);
    },
    [removeChip],
  );

  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      clearChips();
    },
    [clearChips],
  );

  // ========== Render ==========

  const shouldShowDropdown = showDropdown && suggestions.length > 0;
  const showPresets = showDropdown && presets && presets.length > 0 && inputValue === "";
  let presetStartIndex = 0;

  return (
    <div className={cn("relative", className)}>
      {/* Input container with chips */}
      <div
        className={cn(
          inputStyles.container,
          dropdownStyles.border,
          dropdownStyles.surface,
          validationError && inputStyles.containerError,
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search
          className={cn(
            "size-4 shrink-0 transition-colors",
            validationError ? "text-red-500" : dropdownStyles.mutedLight,
          )}
        />

        {chips.map((chip, index) => (
          <ChipLabel
            key={`${chip.field}-${chip.value}-${index}`}
            chip={chip}
            onRemove={() => handleChipRemove(index)}
            focused={focusedChipIndex === index}
          />
        ))}

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : "Add filter..."}
          className={inputStyles.input}
          role="combobox"
          aria-expanded={shouldShowDropdown}
          aria-controls="smart-search-listbox"
          aria-haspopup="listbox"
          aria-activedescendant={
            shouldShowDropdown && highlightedIndex >= 0 ? `suggestion-${highlightedIndex}` : undefined
          }
        />

        {chips.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className={cn(inputStyles.clearButton, dropdownStyles.muted, dropdownStyles.hoverBg)}
          >
            <X className="size-3" />
            <span>Clear filters</span>
          </button>
        )}
      </div>

      {/* Backdrop */}
      {(shouldShowDropdown || showPresets) && (
        <div
          className="fixed-below-header z-40"
          onClick={(e) => {
            e.stopPropagation();
            closeDropdown();
          }}
          aria-hidden="true"
        />
      )}

      {/* Dropdown - REPLACEABLE by cmdk Command */}
      {(shouldShowDropdown || showPresets || validationError) && (
        <div
          ref={dropdownRef}
          id="smart-search-listbox"
          className={cn(
            dropdownStyles.dropdown,
            dropdownStyles.surface,
            validationError ? dropdownStyles.borderError : dropdownStyles.border,
          )}
          role="listbox"
        >
          {validationError && (
            <DropdownHint
              message={validationError}
              isError
            />
          )}

          {showPresets &&
            presets?.map((group) => {
              const startIndex = presetStartIndex;
              presetStartIndex += group.items.length;
              return (
                <PresetGroup
                  key={group.label}
                  label={group.label}
                  items={group.items}
                  data={data}
                  highlightedIndex={highlightedIndex}
                  startIndex={startIndex}
                  isPresetActive={isPresetActive}
                  onTogglePreset={handleTogglePreset}
                  onHighlight={setHighlightedIndex}
                />
              );
            })}

          {(() => {
            let selectableIndex = 0;
            const presetCount = flatPresets.length;

            return suggestions.map((suggestion, index) => {
              if (suggestion.type === "hint") {
                return (
                  <DropdownHint
                    key={`hint-${suggestion.field.id}-${index}`}
                    message={suggestion.label}
                  />
                );
              }

              const unifiedIndex = presetCount + selectableIndex;
              selectableIndex++;

              const isHighlighted = highlightedIndex === unifiedIndex;
              const showTabHint = selectableSuggestions.length === 1 && selectableIndex === 1;

              return (
                <DropdownItem
                  key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${index}`}
                  label={suggestion.label}
                  hint={suggestion.hint}
                  isHighlighted={isHighlighted}
                  showTabHint={showTabHint}
                  isFieldType={suggestion.type === "field"}
                  highlightIndex={unifiedIndex}
                  onClick={() => handleSelect(index)}
                  onMouseEnter={() => setHighlightedIndex(unifiedIndex)}
                />
              );
            });
          })()}

          <DropdownFooter />
        </div>
      )}
    </div>
  );
}

// Memoized export
export const SmartSearch = memo(SmartSearchInner) as typeof SmartSearchInner;
