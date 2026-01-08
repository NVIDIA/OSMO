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
 * Features:
 * - Chip-based filter accumulation
 * - Field prefix detection (e.g., "pool:", "platform:")
 * - Smart suggestions based on data
 * - Keyboard navigation (Arrow keys, Tab, Enter, Escape)
 * - Same-field chips use OR logic, different-field chips use AND logic
 * - freeTextOnly fields skip dropdown suggestions
 */

"use client";

import { useState, useRef, useMemo, useCallback, memo, useEffect } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartSearchProps, SearchField, SearchChip, SearchPreset } from "./types";

// ============================================================================
// Styles - Semantic Tailwind class compositions
// ============================================================================

/** Reusable style patterns for SmartSearch */
const styles = {
  // Surfaces & backgrounds
  surface: "bg-white dark:bg-zinc-900",
  border: "border-zinc-200 dark:border-zinc-700",
  borderError: "border-red-200 dark:border-red-800",

  // Text colors
  muted: "text-zinc-500 dark:text-zinc-400",
  mutedLight: "text-zinc-400 dark:text-zinc-500",
  error: "text-red-600 dark:text-red-400",
  prefix: "text-blue-600 dark:text-blue-400",

  // Interactive states
  focusRing: "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900",
  hoverBg: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  highlighted: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100",

  // Components
  kbd: "rounded bg-zinc-200 px-1 dark:bg-zinc-700",
  nonInteractive: "pointer-events-none select-none",
  dropdownItem: "px-3 py-2 text-sm",
} as const;

// ============================================================================
// Types
// ============================================================================

interface Suggestion<T> {
  type: "field" | "value" | "hint";
  field: SearchField<T>;
  value: string;
  label: string;
  hint?: string;
}

// ============================================================================
// Chip Label Component
// ============================================================================

/** Styles "Free" or "Used" portion of chip labels with appropriate colors */
const ChipLabel = memo(function ChipLabel({
  chip,
  onRemove,
  focused = false,
}: {
  chip: SearchChip;
  onRemove: () => void;
  focused?: boolean;
}) {
  // Parse label to find "Free" or "Used" for styling
  const renderLabel = () => {
    if (!chip.variant) return chip.label;

    // Match patterns like "Quota Free: >=10" or "Capacity Used: >=80%"
    const match = chip.label.match(/^(.+?)\s+(Free|Used):\s*(.+)$/);
    if (!match) return chip.label;

    const [, prefix, freeUsed, value] = match;
    const variantClass =
      chip.variant === "free" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";

    return (
      <>
        {prefix} <span className={cn("font-semibold", variantClass)}>{freeUsed}</span>: {value}
      </>
    );
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 transition-all dark:bg-blue-900/40 dark:text-blue-300",
        focused && styles.focusRing,
      )}
    >
      {renderLabel()}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
      >
        <X className="size-3" />
      </button>
    </span>
  );
});

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
  const [highlightedIndex, setHighlightedIndex] = useState(-1); // -1 = nothing highlighted
  const [prevNavigableCount, setPrevNavigableCount] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null); // Error message or null
  const [focusedChipIndex, setFocusedChipIndex] = useState(-1); // -1 = input focused, >=0 = chip index
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Parse input for field prefix (e.g., "pool:" → { field, query })
  // Supports hierarchical prefixes like "quota:free:" - finds longest matching prefix
  const parsedInput = useMemo(() => {
    let bestMatch: { field: SearchField<T>; prefix: string } | null = null;

    // Find the longest prefix that matches the start of input
    for (const field of fields) {
      if (field.prefix && inputValue.toLowerCase().startsWith(field.prefix.toLowerCase())) {
        if (!bestMatch || field.prefix.length > bestMatch.prefix.length) {
          bestMatch = { field, prefix: field.prefix };
        }
      }
    }

    if (bestMatch) {
      return {
        field: bestMatch.field,
        query: inputValue.slice(bestMatch.prefix.length),
        hasPrefix: true,
      };
    }

    return { field: null, query: inputValue, hasPrefix: false };
  }, [inputValue, fields]);

  // Get suggestions based on current input
  const suggestions = useMemo((): Suggestion<T>[] => {
    const items: Suggestion<T>[] = [];
    const query = inputValue.toLowerCase().trim();

    // Helper to get hint text for a field
    const getFieldHint = (field: SearchField<T>) => {
      if (field.hint) return field.hint;
      if (field.freeTextOnly) return `${field.label} (free text)`;
      return field.label;
    };

    if (!query) {
      // Show all field prefixes when input is empty
      for (const field of fields) {
        if (field.prefix) {
          items.push({
            type: "field",
            field,
            value: field.prefix,
            label: field.prefix,
            hint: getFieldHint(field),
          });
        }
      }
      return items;
    }

    if (parsedInput.hasPrefix && parsedInput.field) {
      // Show values for the selected field
      const field = parsedInput.field;
      const currentPrefix = field.prefix;

      // For freeTextOnly fields, show hint and sub-fields
      if (field.freeTextOnly) {
        const subQuery = parsedInput.query.toLowerCase();

        // Find sub-fields that extend this prefix and match the query
        const matchingSubFields = fields.filter((f) => {
          if (!f.prefix || f.prefix === currentPrefix || !f.prefix.startsWith(currentPrefix)) {
            return false;
          }
          // Get the part after the current prefix (e.g., "free:" from "quota:free:")
          const suffix = f.prefix.slice(currentPrefix.length).toLowerCase();
          // Match if user's query starts with or is contained in the suffix
          return subQuery === "" || suffix.startsWith(subQuery);
        });

        // Show free-form hint if available (only when no specific sub-field is matched)
        if (field.freeFormHint && (matchingSubFields.length !== 1 || subQuery === "")) {
          items.push({
            type: "hint",
            field,
            value: "",
            label: field.freeFormHint,
            hint: field.freeFormHint,
          });
        }

        // Show matching sub-fields
        for (const f of matchingSubFields) {
          items.push({
            type: "field",
            field: f,
            value: f.prefix,
            label: f.prefix,
            hint: getFieldHint(f),
          });
        }

        return items;
      }

      const values = field.getValues(data);
      const prefixQuery = parsedInput.query.toLowerCase();

      const filtered = values.filter((v) => v.toLowerCase().includes(prefixQuery));
      for (const v of filtered.slice(0, 10)) {
        items.push({
          type: "value",
          field,
          value: v,
          label: `${field.prefix}${v}`,
        });
      }
      return items;
    }

    // Show matching field prefixes only (no value suggestions until after colon)
    for (const field of fields) {
      if (field.prefix) {
        const prefixMatch = field.prefix.toLowerCase().startsWith(query) || field.label.toLowerCase().startsWith(query);
        if (prefixMatch) {
          items.push({
            type: "field",
            field,
            value: field.prefix,
            label: field.prefix,
            hint: getFieldHint(field),
          });
        }
      }
    }

    return items;
  }, [inputValue, parsedInput, fields, data]);

  // Flatten all presets into a single array for navigation
  const flatPresets = useMemo(() => {
    if (!presets || inputValue !== "") return [];
    return presets.flatMap((group) => group.items);
  }, [presets, inputValue]);

  // Total navigable items: presets first, then selectable suggestions
  const selectableSuggestions = useMemo(() => suggestions.filter((s) => s.type !== "hint"), [suggestions]);

  const totalNavigableCount = flatPresets.length + selectableSuggestions.length;

  // Reset highlighted index when navigable items change (React-recommended render-phase pattern)
  if (totalNavigableCount !== prevNavigableCount) {
    setPrevNavigableCount(totalNavigableCount);
    setHighlightedIndex(-1);
  }

  // Close dropdown handler (called by backdrop click)
  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  const addChip = useCallback(
    (field: SearchField<T>, value: string) => {
      // Custom validation function takes precedence
      if (field.validate) {
        const result = field.validate(value);
        if (result !== true) {
          // Invalid - show error message (persists until user types)
          setValidationError(typeof result === "string" ? result : "Invalid value");
          return;
        }
      }
      // For fields that require valid values, check if the value is in the allowed list
      else if (field.requiresValidValue) {
        const validValues = field.getValues(data);
        const isValid = validValues.some((v) => v.toLowerCase() === value.toLowerCase());
        if (!isValid) {
          // Invalid value - show error (persists until user types)
          setValidationError(`"${value}" is not a valid option`);
          return;
        }
      }

      // Clear any validation error
      setValidationError(null);

      // Resolve shorthand fields to explicit form
      let resolvedField = field;
      let resolvedLabel = `${field.label}: ${value}`;
      let chipVariant = field.variant;

      if (field.resolveTo && displayMode) {
        const targetFieldId = field.resolveTo({ displayMode });
        const targetField = fields.find((f) => f.id === targetFieldId);
        if (targetField) {
          resolvedField = targetField;
          resolvedLabel = `${targetField.label}: ${value}`;
          chipVariant = targetField.variant;
        }
      }

      // Don't add duplicate chips
      const exists = chips.some((c) => c.field === resolvedField.id && c.value.toLowerCase() === value.toLowerCase());
      if (!exists) {
        onChipsChange([
          ...chips,
          {
            field: resolvedField.id,
            value,
            label: resolvedLabel,
            variant: chipVariant,
          },
        ]);
      }
      setInputValue("");
      setShowDropdown(false);
      inputRef.current?.focus();
    },
    [chips, onChipsChange, data, displayMode, fields],
  );

  const removeChip = useCallback(
    (index: number) => {
      onChipsChange(chips.filter((_, i) => i !== index));
    },
    [chips, onChipsChange],
  );

  // Check if a preset is currently active (has matching chip)
  const isPresetActive = useCallback(
    (preset: SearchPreset<T>) => {
      return chips.some((c) => c.field === preset.chip.field && c.value === preset.chip.value);
    },
    [chips],
  );

  // Toggle a preset on/off
  const togglePreset = useCallback(
    (preset: SearchPreset<T>) => {
      if (isPresetActive(preset)) {
        onChipsChange(chips.filter((c) => !(c.field === preset.chip.field && c.value === preset.chip.value)));
      } else {
        onChipsChange([...chips, preset.chip]);
      }
      setInputValue("");
      setShowDropdown(false);
      inputRef.current?.focus();
    },
    [chips, onChipsChange, isPresetActive],
  );

  const handleSelect = useCallback(
    (index: number) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;

      if (suggestion.type === "field") {
        // Fill in the prefix, user continues typing the value
        setInputValue(suggestion.value);
        inputRef.current?.focus();
      } else {
        // Add the value as a chip
        addChip(suggestion.field, suggestion.value);
      }
    },
    [suggestions, addChip],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Unified navigation: presets (0 to flatPresets.length-1) then suggestions
      const presetCount = flatPresets.length;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (totalNavigableCount === 0) return;

        if (!showDropdown) {
          setShowDropdown(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((current) => {
            if (current === -1 || current >= totalNavigableCount - 1) {
              return 0; // Wrap to start
            }
            return current + 1;
          });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (totalNavigableCount === 0) return;

        if (!showDropdown) {
          // Open dropdown and highlight last item
          setShowDropdown(true);
          setHighlightedIndex(totalNavigableCount - 1);
        } else {
          setHighlightedIndex((current) => {
            if (current === -1 || current === 0) {
              return totalNavigableCount - 1; // Wrap to end
            }
            return current - 1;
          });
        }
      } else if (e.key === "Tab" && totalNavigableCount > 0) {
        // Tab opens dropdown if closed, or cycles through items
        if (!showDropdown) {
          e.preventDefault();
          setShowDropdown(true);
          setHighlightedIndex(0);
        } else if (highlightedIndex >= 0) {
          e.preventDefault();
          const nextIndex = (highlightedIndex + 1) % totalNavigableCount;
          setHighlightedIndex(nextIndex);
          // If it's a suggestion (not preset), also fill input
          if (nextIndex >= presetCount) {
            const suggestionIndex = nextIndex - presetCount;
            const suggestion = selectableSuggestions[suggestionIndex];
            if (suggestion) {
              setInputValue(suggestion.label);
            }
          }
        } else {
          // Nothing highlighted - highlight first item
          e.preventDefault();
          setHighlightedIndex(0);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!showDropdown) {
          // Dropdown closed - open it
          setShowDropdown(true);
        } else if (highlightedIndex >= 0) {
          // Something is highlighted - select it
          if (highlightedIndex < presetCount) {
            // It's a preset - toggle it
            const preset = flatPresets[highlightedIndex];
            if (preset) {
              togglePreset(preset);
            }
          } else {
            // It's a suggestion - use existing handleSelect
            const originalSuggestionIndex = suggestions.findIndex(
              (s) => s === selectableSuggestions[highlightedIndex - presetCount],
            );
            if (originalSuggestionIndex >= 0) {
              handleSelect(originalSuggestionIndex);
            }
          }
        } else if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
          // Add filter when in field prefix mode (e.g., "pool:g" or "pool:gpu-pool-1")
          addChip(parsedInput.field, parsedInput.query.trim());
        } else if (inputValue.trim()) {
          // No prefix - show error (persists until user types)
          setValidationError("Use a filter prefix (e.g. pool:, platform:, quota:)");
        }
      } else if (e.key === "ArrowLeft") {
        // Navigate left: through chips OR through presets in dropdown
        if (focusedChipIndex >= 0) {
          // Already navigating chips
          e.preventDefault();
          if (focusedChipIndex > 0) {
            setFocusedChipIndex(focusedChipIndex - 1);
          }
        } else if (showDropdown && highlightedIndex >= 0 && highlightedIndex < presetCount) {
          // Navigating presets horizontally
          e.preventDefault();
          if (highlightedIndex > 0) {
            setHighlightedIndex(highlightedIndex - 1);
          } else {
            // Wrap to last preset
            setHighlightedIndex(presetCount - 1);
          }
        } else if (chips.length > 0) {
          // Check if cursor is at start to enter chip navigation
          const cursorAtStart = inputRef.current?.selectionStart === 0 && inputRef.current?.selectionEnd === 0;
          if (cursorAtStart) {
            e.preventDefault();
            setFocusedChipIndex(chips.length - 1);
          }
        }
      } else if (e.key === "ArrowRight") {
        // Navigate right: through chips OR through presets in dropdown
        if (focusedChipIndex >= 0) {
          // Already navigating chips
          e.preventDefault();
          if (focusedChipIndex < chips.length - 1) {
            setFocusedChipIndex(focusedChipIndex + 1);
          } else {
            // Move back to input
            setFocusedChipIndex(-1);
            inputRef.current?.focus();
          }
        } else if (showDropdown && highlightedIndex >= 0 && highlightedIndex < presetCount) {
          // Navigating presets horizontally
          e.preventDefault();
          if (highlightedIndex < presetCount - 1) {
            setHighlightedIndex(highlightedIndex + 1);
          } else {
            // Wrap to first preset
            setHighlightedIndex(0);
          }
        }
      } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
        // Delete focused chip, or select last chip if none focused
        if (focusedChipIndex >= 0) {
          e.preventDefault();
          removeChip(focusedChipIndex);
          // Adjust focus: move to previous chip or input
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
      togglePreset,
      focusedChipIndex,
      parsedInput,
      inputValue,
      chips,
      addChip,
      removeChip,
    ],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setShowDropdown(true);
    setValidationError(null); // Clear error when user types
    setFocusedChipIndex(-1); // Clear chip focus when typing
  }, []);

  const handleFocus = useCallback(() => {
    setShowDropdown(true);
    setFocusedChipIndex(-1); // Clear chip focus when input is focused
  }, []);

  // Scroll highlighted item into view when navigating
  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return;

    // Find the highlighted element by data attribute
    const highlighted = dropdownRef.current.querySelector(`[data-highlight-index="${highlightedIndex}"]`);
    if (highlighted) {
      highlighted.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedIndex]);

  const shouldShowDropdown = showDropdown && suggestions.length > 0;
  const showPresets = showDropdown && presets && presets.length > 0 && inputValue === "";

  return (
    <div className={cn("relative", className)}>
      {/* Search input with chips - z-50 to stay above backdrop */}
      <div
        className={cn(
          "relative z-50 flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors",
          styles.border,
          styles.surface,
          "focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500",
          // Validation error state
          validationError &&
            "animate-shake border-red-500 ring-1 ring-red-500 focus-within:border-red-500 focus-within:ring-red-500",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search
          className={cn("size-4 shrink-0 transition-colors", validationError ? "text-red-500" : styles.mutedLight)}
        />

        {chips.map((chip, index) => (
          <ChipLabel
            key={`${chip.field}-${chip.value}-${index}`}
            chip={chip}
            onRemove={() => {
              removeChip(index);
              setFocusedChipIndex(-1);
            }}
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
          className="min-w-[150px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
            onClick={(e) => {
              e.stopPropagation(); // Don't trigger container's focus behavior
              onChipsChange([]);
            }}
            className={cn(
              "ml-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:text-zinc-700 dark:hover:text-zinc-300",
              styles.muted,
              styles.hoverBg,
            )}
          >
            <X className="size-3" />
            <span>Clear filters</span>
          </button>
        )}
      </div>

      {/* Invisible backdrop to capture outside clicks without triggering underlying elements */}
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

      {/* Dropdown suggestions (includes error messages as hints) */}
      {(shouldShowDropdown || showPresets || validationError) && (
        <div
          ref={dropdownRef}
          id="smart-search-listbox"
          className={cn(
            "absolute inset-x-0 top-full z-50 mt-1 max-h-[300px] overflow-auto rounded-md border shadow-lg",
            styles.surface,
            validationError ? styles.borderError : styles.border,
          )}
          role="listbox"
        >
          {/* Error message as a hint */}
          {validationError && (
            <div
              className={cn(
                "border-b border-red-100 dark:border-red-900",
                styles.dropdownItem,
                styles.error,
                styles.nonInteractive,
              )}
            >
              ⚠ {validationError}
            </div>
          )}

          {/* Preset filter buttons */}
          {showPresets &&
            (() => {
              let flatIndex = 0;
              return presets.map((group) => (
                <div
                  key={group.label}
                  className={cn(
                    "grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 border-b px-3 py-2",
                    styles.border,
                  )}
                >
                  <span className={cn("text-xs font-medium", styles.muted)}>{group.label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((preset) => {
                      const currentIndex = flatIndex++;
                      const isHighlighted = highlightedIndex === currentIndex;
                      const active = isPresetActive(preset);
                      const count = preset.count(data);

                      // Custom render: user provides their own content and handles all visual states
                      if (preset.render) {
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            data-highlight-index={currentIndex}
                            onClick={() => togglePreset(preset)}
                            onMouseEnter={() => setHighlightedIndex(currentIndex)}
                            className="rounded transition-all"
                          >
                            {preset.render({ active, focused: isHighlighted, count, label: preset.label })}
                          </button>
                        );
                      }

                      // Default render: dot + label + count
                      const activeClasses = preset.badgeColors
                        ? cn(preset.badgeColors.bg, preset.badgeColors.text)
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200";
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-highlight-index={currentIndex}
                          onClick={() => togglePreset(preset)}
                          onMouseEnter={() => setHighlightedIndex(currentIndex)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                            active
                              ? activeClasses
                              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700",
                            isHighlighted && styles.focusRing,
                          )}
                        >
                          <span className={cn("size-2 rounded-full", preset.dotColor)} />
                          <span>{preset.label}</span>
                          <span className="tabular-nums opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}

          {(() => {
            // Track which selectable suggestion we're on for unified navigation
            let selectableIndex = 0;
            const presetCount = flatPresets.length;

            return suggestions.map((suggestion, index) => {
              // Hint type is display-only, not interactive
              if (suggestion.type === "hint") {
                return (
                  <div
                    key={`hint-${suggestion.field.id}-${index}`}
                    className={cn(
                      "border-b border-zinc-100 italic dark:border-zinc-800",
                      styles.dropdownItem,
                      styles.muted,
                      styles.nonInteractive,
                    )}
                  >
                    {suggestion.label}
                  </div>
                );
              }

              // Calculate unified navigation index (presets come first)
              const unifiedIndex = presetCount + selectableIndex;
              selectableIndex++;

              const isHighlighted = highlightedIndex === unifiedIndex;
              const showTabHint = selectableSuggestions.length === 1 && selectableIndex === 1;

              return (
                <button
                  key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${index}`}
                  id={`suggestion-${index}`}
                  type="button"
                  data-highlight-index={unifiedIndex}
                  onClick={() => handleSelect(index)}
                  onMouseEnter={() => setHighlightedIndex(unifiedIndex)}
                  className={cn(
                    "flex w-full items-center justify-between text-left",
                    styles.dropdownItem,
                    isHighlighted ? styles.highlighted : cn("text-zinc-700 dark:text-zinc-300", styles.hoverBg),
                  )}
                  role="option"
                  aria-selected={isHighlighted}
                >
                  <span className="flex items-center gap-2">
                    {suggestion.type === "field" ? (
                      <>
                        <span className={cn("font-mono text-xs", styles.prefix)}>{suggestion.label}</span>
                        {suggestion.hint && <span className={styles.muted}>{suggestion.hint}</span>}
                      </>
                    ) : (
                      <span>{suggestion.label}</span>
                    )}
                  </span>
                  {/* Show Tab hint only when there's exactly one selectable option */}
                  {showTabHint && (
                    <kbd className={cn("hidden px-1.5 py-0.5 text-xs sm:inline", styles.kbd, styles.muted)}>Tab</kbd>
                  )}
                </button>
              );
            });
          })()}

          {/* Footer hint */}
          <div className={cn("border-t px-3 py-2 text-xs", styles.border, styles.muted)}>
            <kbd className={styles.kbd}>↑↓</kbd> navigate <kbd className={styles.kbd}>Tab</kbd> complete{" "}
            <kbd className={styles.kbd}>Enter</kbd> select <kbd className={styles.kbd}>Esc</kbd> close
          </div>
        </div>
      )}
    </div>
  );
}

// Memoized export
export const SmartSearch = memo(SmartSearchInner) as typeof SmartSearchInner;
