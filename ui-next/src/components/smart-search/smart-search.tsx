/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
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

import { useState, useRef, useMemo, useCallback, memo } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartSearchProps, SearchField, SearchChip } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Display mode color styles for chips and UI elements */
export const DISPLAY_MODE_COLORS = {
  free: {
    bg: "bg-emerald-50 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-400",
    textMuted: "text-emerald-600 dark:text-emerald-400",
    icon: "text-emerald-500",
  },
  used: {
    bg: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-400",
    textMuted: "text-amber-600 dark:text-amber-400",
    icon: "text-amber-500",
  },
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
function ChipLabel({ chip, onRemove }: { chip: SearchChip; onRemove: () => void }) {
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
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
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
}

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
}: SmartSearchProps<T>) {
  const [inputValue, setInputValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1); // -1 = nothing highlighted
  const [prevSuggestionsLength, setPrevSuggestionsLength] = useState(0); // For render-phase reset
  const [validationError, setValidationError] = useState<string | null>(null); // Error message or null
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

  // Adjust state during render: reset highlighted index when suggestions change
  // This is the React-recommended pattern for derived state resets (see react.dev docs)
  // React will immediately re-render with the updated state without committing the intermediate state
  if (suggestions.length !== prevSuggestionsLength) {
    setPrevSuggestionsLength(suggestions.length);
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

  // Tab-complete: fill input with selected value (for cycling through options)
  const tabComplete = useCallback(
    (index: number) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;

      // Fill in the suggestion value into the input (don't add chip yet)
      setInputValue(suggestion.label);
      setHighlightedIndex(index);
    },
    [suggestions],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Find selectable indices (skip hints)
        const selectableIndices = suggestions
          .map((s, i) => ({ suggestion: s, index: i }))
          .filter(({ suggestion }) => suggestion.type !== "hint")
          .map(({ index }) => index);

        if (selectableIndices.length === 0) return;

        if (!showDropdown) {
          setShowDropdown(true);
          setHighlightedIndex(selectableIndices[0]);
        } else {
          setHighlightedIndex((current) => {
            const currentPos = selectableIndices.indexOf(current);
            if (currentPos === -1 || currentPos === selectableIndices.length - 1) {
              return selectableIndices[0];
            }
            return selectableIndices[currentPos + 1];
          });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const selectableIndices = suggestions
          .map((s, i) => ({ suggestion: s, index: i }))
          .filter(({ suggestion }) => suggestion.type !== "hint")
          .map(({ index }) => index);

        if (selectableIndices.length === 0) return;

        setHighlightedIndex((current) => {
          const currentPos = selectableIndices.indexOf(current);
          if (currentPos === -1 || currentPos === 0) {
            return selectableIndices[selectableIndices.length - 1];
          }
          return selectableIndices[currentPos - 1];
        });
      } else if (e.key === "Tab" && showDropdown && suggestions.length > 0) {
        e.preventDefault();
        // Filter out hint-type suggestions for Tab cycling
        const selectableSuggestions = suggestions
          .map((s, i) => ({ suggestion: s, index: i }))
          .filter(({ suggestion }) => suggestion.type !== "hint");

        if (selectableSuggestions.length === 0) return;

        if (highlightedIndex >= 0) {
          // Already highlighted - cycle to next selectable, wrapping around
          const currentSelectableIndex = selectableSuggestions.findIndex(({ index }) => index === highlightedIndex);
          const nextSelectableIndex = (currentSelectableIndex + 1) % selectableSuggestions.length;
          tabComplete(selectableSuggestions[nextSelectableIndex].index);
        } else if (selectableSuggestions.length === 1) {
          // Only one selectable option - Tab completes it
          tabComplete(selectableSuggestions[0].index);
        }
        // Multiple selectable options and nothing highlighted - Tab does nothing (ambiguous)
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (showDropdown && highlightedIndex >= 0) {
          // Prioritize highlighted selection (user explicitly arrowed to it)
          handleSelect(highlightedIndex);
        } else if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
          // Add filter when in field prefix mode (e.g., "pool:g" or "pool:gpu-pool-1")
          addChip(parsedInput.field, parsedInput.query.trim());
        } else if (inputValue.trim()) {
          // No prefix - show error (persists until user types)
          setValidationError("Use a filter prefix (e.g. pool:, platform:, quota:)");
        }
      } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
        removeChip(chips.length - 1);
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
      suggestions,
      highlightedIndex,
      showDropdown,
      handleSelect,
      tabComplete,
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
  }, []);

  const handleFocus = useCallback(() => {
    setShowDropdown(true);
  }, []);

  const shouldShowDropdown = showDropdown && suggestions.length > 0;

  return (
    <div className={cn("relative", className)}>
      {/* Search input with chips */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors",
          "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
          "focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500",
          // Validation error state
          validationError &&
            "animate-shake border-red-500 ring-1 ring-red-500 focus-within:border-red-500 focus-within:ring-red-500",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search
          className={cn(
            "size-4 shrink-0 transition-colors",
            validationError ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
          )}
        />

        {chips.map((chip, index) => (
          <ChipLabel
            key={`${chip.field}-${chip.value}-${index}`}
            chip={chip}
            onRemove={() => removeChip(index)}
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
            onClick={() => onChipsChange([])}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Clear all filters"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Invisible backdrop to capture outside clicks without triggering underlying elements */}
      {shouldShowDropdown && (
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
      {(shouldShowDropdown || validationError) && (
        <div
          ref={dropdownRef}
          id="smart-search-listbox"
          className={cn(
            "absolute inset-x-0 top-full z-50 mt-1 max-h-[300px] overflow-auto rounded-md border shadow-lg",
            validationError
              ? "border-red-200 bg-white dark:border-red-800 dark:bg-zinc-900"
              : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
          )}
          role="listbox"
        >
          {/* Error message as a hint */}
          {validationError && (
            <div className="pointer-events-none border-b border-red-100 px-3 py-2 text-sm text-red-600 select-none dark:border-red-900 dark:text-red-400">
              ⚠ {validationError}
            </div>
          )}

          {suggestions.map((suggestion, index) => {
            // Hint type is display-only, not interactive
            if (suggestion.type === "hint") {
              return (
                <div
                  key={`hint-${suggestion.field.id}-${index}`}
                  className="pointer-events-none border-b border-zinc-100 px-3 py-2 text-sm text-zinc-500 italic select-none dark:border-zinc-800 dark:text-zinc-400"
                >
                  {suggestion.label}
                </div>
              );
            }

            // Count selectable suggestions and find first
            const selectableSuggestions = suggestions.filter((s) => s.type !== "hint");
            const firstSelectableIndex = suggestions.findIndex((s) => s.type !== "hint");
            const showTabHint = selectableSuggestions.length === 1 && index === firstSelectableIndex;

            return (
              <button
                key={`${suggestion.type}-${suggestion.field.id}-${suggestion.value}-${index}`}
                id={`suggestion-${index}`}
                type="button"
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                  index === highlightedIndex
                    ? "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
                role="option"
                aria-selected={index === highlightedIndex}
              >
                <span className="flex items-center gap-2">
                  {suggestion.type === "field" ? (
                    <>
                      <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{suggestion.label}</span>
                      {suggestion.hint && <span className="text-zinc-500 dark:text-zinc-400">{suggestion.hint}</span>}
                    </>
                  ) : (
                    <span>{suggestion.label}</span>
                  )}
                </span>
                {/* Show Tab hint only when there's exactly one selectable option */}
                {showTabHint && (
                  <kbd className="hidden rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 sm:inline dark:bg-zinc-700 dark:text-zinc-400">
                    Tab
                  </kbd>
                )}
              </button>
            );
          })}

          {/* Footer hint */}
          <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">↑↓</kbd> navigate{" "}
            <kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">Tab</kbd> complete{" "}
            <kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">Enter</kbd> select{" "}
            <kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">Esc</kbd> close
          </div>
        </div>
      )}
    </div>
  );
}

// Memoized export
export const SmartSearch = memo(SmartSearchInner) as typeof SmartSearchInner;
