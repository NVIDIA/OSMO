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
 * Built on cmdk (via shadcn/ui Command) for:
 * - Keyboard navigation (↑↓, Enter, Escape)
 * - Fuzzy search filtering
 * - Accessibility (ARIA)
 * - Focus management
 *
 * Architecture:
 * - lib/: Core business logic (types, useChips, useSuggestions, filterByChips)
 * - hooks/: React state management (useChips, useSuggestions)
 * - components.tsx: ChipLabel, PresetButton/Group (core UI)
 * - This file: Main component integrating cmdk with chip/preset logic
 */

"use client";

import { useState, useRef, useCallback, useMemo, memo } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn/ui Command (cmdk)
import { Command, CommandList, CommandItem, CommandGroup, CommandEmpty } from "@/components/shadcn/command";

// Core types (lib/) and hooks (hooks/) - never change with UI library swap
import type { SmartSearchProps, SearchPreset } from "./lib";
import { useChips, useSuggestions } from "./hooks";

// UI components and styles
import { inputStyles, chipStyles, dropdownStyles } from "./styles";
import { ChipLabel, PresetGroup } from "./components";

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
  const [isOpen, setIsOpen] = useState(false);
  const [focusedChipIndex, setFocusedChipIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ========== Core hooks (lib/) - never changes ==========
  const { addChip, removeChip, clearChips, isPresetActive, togglePreset, validationError, clearValidationError } =
    useChips({
      chips,
      onChipsChange,
      data,
      fields,
      displayMode,
    });

  const { parsedInput, suggestions } = useSuggestions({
    inputValue,
    fields,
    data,
    presets,
  });

  // ========== Event handlers ==========

  const handleSelectSuggestion = useCallback(
    (value: string) => {
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
    [suggestions, addChip],
  );

  const handleTogglePreset = useCallback(
    (preset: SearchPreset<T>) => {
      togglePreset(preset);
      setInputValue("");
      setIsOpen(false);
      inputRef.current?.focus();
    },
    [togglePreset],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(false);
        } else {
          inputRef.current?.blur();
        }
      } else if (
        e.key === "Enter" &&
        !isOpen &&
        parsedInput.hasPrefix &&
        parsedInput.field &&
        parsedInput.query.trim()
      ) {
        // Direct entry when dropdown is closed but user typed field:value
        e.preventDefault();
        if (addChip(parsedInput.field, parsedInput.query.trim())) {
          setInputValue("");
          inputRef.current?.focus();
        }
      }
    },
    [focusedChipIndex, chips, inputValue, removeChip, isOpen, parsedInput, addChip],
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
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is moving outside the container
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setIsOpen(false);
    }
  }, []);

  // Stable handler for input container click
  const handleContainerClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Stable handler for backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
  }, []);

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

  // Separate hints from selectable suggestions (memoized to prevent re-filtering on every render)
  const hints = useMemo(() => suggestions.filter((s) => s.type === "hint"), [suggestions]);
  const selectables = useMemo(() => suggestions.filter((s) => s.type !== "hint"), [suggestions]);

  // Stable no-op callback for PresetGroup (presets don't need highlight tracking with cmdk)
  const noopHighlight = useCallback(() => {}, []);

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onBlur={handleBlur}
    >
      <Command
        shouldFilter={false}
        className="overflow-visible bg-transparent"
      >
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
            type="text"
            value={inputValue}
            onChange={handleInputChangeEvent}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder={chips.length === 0 ? placeholder : "Add filter..."}
            className={inputStyles.input}
            role="combobox"
            aria-expanded={showDropdown || undefined}
            aria-controls="smart-search-listbox"
            aria-haspopup="listbox"
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

            {/* Presets section */}
            {showPresets &&
              presets?.map((group, groupIndex) => {
                const startIndex = presets.slice(0, groupIndex).reduce((acc, g) => acc + g.items.length, 0);
                return (
                  <PresetGroup
                    key={group.label}
                    label={group.label}
                    items={group.items}
                    data={data}
                    highlightedIndex={-1}
                    startIndex={startIndex}
                    isPresetActive={isPresetActive}
                    onTogglePreset={handleTogglePreset}
                    onHighlight={noopHighlight}
                  />
                );
              })}

            {/* Hints (non-interactive) */}
            {hints.map((hint, index) => (
              <div
                key={`hint-${hint.field.id}-${index}`}
                className={cn(
                  dropdownStyles.dropdownItem,
                  dropdownStyles.nonInteractive,
                  "border-b border-zinc-100 italic dark:border-zinc-800",
                  dropdownStyles.muted,
                )}
              >
                {hint.label}
              </div>
            ))}

            {/* Suggestions - cmdk handles keyboard navigation */}
            <CommandList>
              <CommandEmpty className="py-3 text-center text-sm text-zinc-500">No results found.</CommandEmpty>

              {selectables.length > 0 && (
                <CommandGroup>
                  {selectables.map((suggestion, index) => (
                    <CommandItem
                      key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${index}`}
                      value={suggestion.value}
                      onSelect={handleSelectSuggestion}
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
export const SmartSearch = memo(SmartSearchInner) as typeof SmartSearchInner;
