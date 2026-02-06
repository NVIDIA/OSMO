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

"use client";

import { useState, useRef, useCallback, useMemo, memo, useId } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn/ui Command (cmdk)
import { Command, CommandList, CommandItem, CommandGroup } from "@/components/shadcn/command";

// Core types (lib/) and hooks (hooks/) - never change with UI library swap
import type { FilterBarProps } from "./lib/types";
import { useChips } from "./hooks/use-chips";
import { useSuggestions } from "./hooks/use-suggestions";

// UI components and styles
import { inputStyles, chipStyles, dropdownStyles } from "./styles";
import { ChipLabel, PresetContent } from "./components";

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
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedChipIndex, setFocusedChipIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // ========== Core hooks (lib/) - never changes ==========
  const {
    addChip,
    removeChip,
    clearChips,
    isPresetActive,
    togglePreset,
    validationError,
    setValidationError,
    clearValidationError,
  } = useChips({
    chips,
    onChipsChange,
    data,
    fields,
    displayMode,
  });

  const { parsedInput, suggestions, flatPresets } = useSuggestions({
    inputValue,
    fields,
    data,
    chips,
    presets,
  });

  // Separate hints from selectable suggestions (memoized, needed for Tab completion)
  const selectables = useMemo(() => suggestions.filter((s) => s.type !== "hint"), [suggestions]);

  // ========== Event handlers ==========

  const handleSelect = useCallback(
    (value: string) => {
      // Check if it's a preset selection
      if (value.startsWith("preset:")) {
        const presetId = value.slice(7); // Remove "preset:" prefix
        const preset = flatPresets.find((p) => p.id === presetId);
        if (preset) {
          togglePreset(preset);
          setInputValue("");
          setIsOpen(false);
          inputRef.current?.focus();
        }
        return;
      }

      // Find the suggestion by value
      const suggestion = suggestions.find((s) => s.value === value || s.label === value);
      if (!suggestion || suggestion.type === "hint") return;

      if (suggestion.type === "field") {
        // Field prefix selected - fill input with prefix
        setInputValue(suggestion.value);
        inputRef.current?.focus();
      } else {
        // Value selected - create chip
        if (addChip(suggestion.field, suggestion.value)) {
          setInputValue("");
          setIsOpen(false);
          inputRef.current?.focus();
        }
      }
    },
    [suggestions, flatPresets, addChip, togglePreset],
  );

  // Keyboard shortcuts (scoped to filter input)
  // Shortcuts defined in: ./hotkeys.ts (FILTER_BAR_HOTKEYS)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // FILTER_BAR_HOTKEYS.shortcuts.NAVIGATE_CHIPS_LEFT / NAVIGATE_CHIPS_RIGHT
      // Chip navigation with arrow keys
      if (e.key === "ArrowLeft") {
        if (focusedChipIndex >= 0) {
          e.preventDefault();
          if (focusedChipIndex > 0) setFocusedChipIndex(focusedChipIndex - 1);
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
        }
      } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
        // FILTER_BAR_HOTKEYS.shortcuts.REMOVE_CHIP_BACKSPACE
        if (focusedChipIndex >= 0) {
          e.preventDefault();
          removeChip(focusedChipIndex);
          setFocusedChipIndex(chips.length === 1 ? -1 : Math.min(focusedChipIndex, chips.length - 2));
        } else {
          setFocusedChipIndex(chips.length - 1);
        }
      } else if (e.key === "Delete" && focusedChipIndex >= 0) {
        // FILTER_BAR_HOTKEYS.shortcuts.REMOVE_CHIP_DELETE
        e.preventDefault();
        removeChip(focusedChipIndex);
        setFocusedChipIndex(chips.length === 1 ? -1 : Math.min(focusedChipIndex, chips.length - 2));
      } else if (e.key === "Escape") {
        // FILTER_BAR_HOTKEYS.shortcuts.CLOSE_DROPDOWN
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(false);
        } else {
          inputRef.current?.blur();
        }
      } else if (e.key === "Enter") {
        // FILTER_BAR_HOTKEYS.shortcuts.APPLY_FILTER
        // If user typed field:value (e.g., "pool:myvalue"), create chip immediately
        // This takes priority whether dropdown is open or closed
        if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
          e.preventDefault();
          e.stopPropagation();
          if (addChip(parsedInput.field, parsedInput.query.trim())) {
            setInputValue("");
            setIsOpen(false);
            inputRef.current?.focus();
          }
        } else if (!isOpen) {
          // No field:value pattern and dropdown closed - just open it
          e.preventDefault();
          setIsOpen(true);
        } else if (isOpen && selectables.length > 0) {
          // Dropdown is open with suggestions - let cmdk handle selection
          // Don't preventDefault - cmdk needs the event to trigger onSelect
        } else if (parsedInput.hasPrefix && parsedInput.field && !parsedInput.query.trim()) {
          // User typed a prefix but no value (e.g., "platform:" or "name:")
          // AND no suggestions available - show helpful message
          e.preventDefault();
          e.stopPropagation();
          setValidationError(`Enter a value after "${parsedInput.field.prefix}"`);
        } else if (inputValue.trim() && selectables.length === 0) {
          // User typed something that doesn't match any filter type and no suggestions
          e.preventDefault();
          e.stopPropagation();
          setValidationError(`Use a filter prefix like "pool:" or "platform:" to create filters`);
        }
      } else if (e.key === "Tab" && !e.shiftKey && inputValue.trim()) {
        // Tab autocomplete: select single matching suggestion
        const valueItems = selectables.filter((s) => s.type === "value");
        if (valueItems.length === 1) {
          e.preventDefault();
          handleSelect(valueItems[0].value);
        } else if (selectables.length === 1 && selectables[0].type === "field") {
          // If only one field prefix matches, complete it
          e.preventDefault();
          setInputValue(selectables[0].value);
        }
      }
    },
    [
      focusedChipIndex,
      chips,
      inputValue,
      removeChip,
      isOpen,
      parsedInput,
      addChip,
      selectables,
      handleSelect,
      setValidationError,
    ],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);
      setIsOpen(true);
      clearValidationError();
      setFocusedChipIndex(-1);
    },
    [clearValidationError],
  );

  const handleFocus = useCallback(() => {
    setIsOpen(true);
    setFocusedChipIndex(-1);
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

  // Close dropdown when clicking outside
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // Check if focus is moving outside the container
      if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
        setIsOpen(false);
        clearValidationError();
      }
    },
    [clearValidationError],
  );

  // Stable handler for input container click
  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Stable handler for backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsOpen(false);
      clearValidationError();
    },
    [clearValidationError],
  );

  // Stable handler for input change event
  const handleInputChangeEvent = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleInputChange(e.target.value);
    },
    [handleInputChange],
  );

  // ========== Memoized render helpers ==========

  const showPresets = isOpen && presets && presets.length > 0 && inputValue === "";
  const showSuggestions = isOpen && suggestions.length > 0;
  const showDropdown = showPresets || showSuggestions || !!validationError;

  // Hints are non-interactive (selectables is already computed above for Tab completion)
  const hints = useMemo(() => suggestions.filter((s) => s.type === "hint"), [suggestions]);

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onBlur={handleBlur}
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

        {/* Input container with chips */}
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
            <ChipLabel
              key={`${chip.field}-${chip.value}-${index}`}
              chip={chip}
              onRemove={() => handleChipRemove(index)}
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
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder={chips.length === 0 ? placeholder : "Add filter..."}
            className={inputStyles.input}
            role="combobox"
            aria-expanded={showDropdown || undefined}
            aria-controls="filter-bar-listbox"
            aria-haspopup="listbox"
          />

          {/* Clear filters - on the right, before results count */}
          {chips.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className={cn(inputStyles.clearButton, dropdownStyles.muted, dropdownStyles.hoverBg)}
            >
              <X className="size-3" />
              <span>Clear</span>
            </button>
          )}

          {/* Results count - always on the right */}
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

        {/* Backdrop */}
        {showDropdown && (
          <div
            className="fixed-below-header z-40"
            onClick={handleBackdropClick}
            aria-hidden="true"
          />
        )}

        {/* Dropdown - powered by cmdk */}
        {showDropdown && (
          <div
            className={cn(
              dropdownStyles.dropdown,
              dropdownStyles.surface,
              validationError ? dropdownStyles.borderError : dropdownStyles.border,
            )}
          >
            {/* Validation error */}
            {validationError && (
              <div
                className={cn(
                  dropdownStyles.dropdownItem,
                  dropdownStyles.nonInteractive,
                  "border-b border-red-100 dark:border-red-900",
                  dropdownStyles.error,
                )}
              >
                ⚠ {validationError}
              </div>
            )}

            {/* Scrollable content area - cmdk handles all keyboard navigation */}
            <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto">
              {/* Presets (shown when input is empty) - inline layout with heading */}
              {showPresets &&
                presets?.map((group) => (
                  <CommandGroup
                    key={group.label}
                    heading={group.label}
                    className={cn(
                      "grid grid-cols-[auto_1fr] items-center gap-x-3 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800",
                      // Heading styling
                      "[&>[cmdk-group-heading]]:text-xs [&>[cmdk-group-heading]]:font-medium [&>[cmdk-group-heading]]:text-zinc-500",
                      // Items container: flex wrap
                      "[&>[cmdk-group-items]]:flex [&>[cmdk-group-items]]:flex-wrap [&>[cmdk-group-items]]:gap-1.5",
                    )}
                  >
                    {group.items.map((preset) => (
                      <CommandItem
                        key={preset.id}
                        value={`preset:${preset.id}`}
                        onSelect={handleSelect}
                        className="group w-auto bg-transparent p-0"
                      >
                        <PresetContent
                          preset={preset}
                          isActive={isPresetActive(preset)}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}

              {/* Hints (non-interactive, shown above suggestions) */}
              {hints.length > 0 && (
                <div className="border-b border-zinc-100 dark:border-zinc-800">
                  {hints.map((hint, index) => (
                    <div
                      key={`hint-${hint.field.id}-${index}`}
                      className={cn(
                        dropdownStyles.dropdownItem,
                        dropdownStyles.nonInteractive,
                        "italic",
                        dropdownStyles.muted,
                      )}
                    >
                      {hint.label}
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {selectables.length > 0 && (
                <CommandGroup>
                  {selectables.map((suggestion, index) => (
                    <CommandItem
                      key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${index}`}
                      value={suggestion.value}
                      onSelect={handleSelect}
                      className="flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2">
                        {suggestion.type === "field" ? (
                          <>
                            <span className={cn("font-mono text-xs", dropdownStyles.prefix)}>{suggestion.label}</span>
                            {suggestion.hint && <span className={dropdownStyles.muted}>{suggestion.hint}</span>}
                          </>
                        ) : (
                          <span>{suggestion.label}</span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>

            {/* Footer */}
            <div className={cn("border-t px-3 py-2 text-xs", dropdownStyles.border, dropdownStyles.muted)}>
              <kbd className={chipStyles.chip}>↑↓</kbd> navigate <kbd className={chipStyles.chip}>Enter</kbd> select{" "}
              <kbd className={chipStyles.chip}>Esc</kbd> close
            </div>
          </div>
        )}
      </Command>
    </div>
  );
}

// Memoized export
export const FilterBar = memo(FilterBarInner) as typeof FilterBarInner;
