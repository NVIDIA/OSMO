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

import { useState, useRef, useMemo, useCallback, useEffect, memo } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartSearchProps, SearchField, SearchChip } from "./types";

// ============================================================================
// Types
// ============================================================================

interface Suggestion<T> {
  type: "field" | "value";
  field: SearchField<T>;
  value: string;
  label: string;
  hint?: string;
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
}: SmartSearchProps<T>) {
  const [inputValue, setInputValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1); // -1 = nothing highlighted
  const [validationError, setValidationError] = useState(false); // Shows invalid value indicator
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Parse input for field prefix (e.g., "pool:" → { field, query })
  const parsedInput = useMemo(() => {
    const colonIndex = inputValue.indexOf(":");
    if (colonIndex > 0) {
      const prefix = inputValue.slice(0, colonIndex + 1);
      const field = fields.find((f) => f.prefix === prefix);
      if (field) {
        return { field, query: inputValue.slice(colonIndex + 1), hasPrefix: true };
      }
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

      // Don't show suggestions for freeTextOnly fields
      if (field.freeTextOnly) {
        return [];
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
        const prefixMatch = field.prefix.toLowerCase().startsWith(query) ||
                           field.label.toLowerCase().startsWith(query);
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

  // Reset highlighted index when suggestions change (no auto-select)
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions.length]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addChip = useCallback(
    (field: SearchField<T>, value: string) => {
      // For fields that require valid values, check if the value is in the allowed list
      if (field.requiresValidValue) {
        const validValues = field.getValues(data);
        const isValid = validValues.some((v) => v.toLowerCase() === value.toLowerCase());
        if (!isValid) {
          // Invalid value - show error indicator
          setValidationError(true);
          // Auto-clear error after animation
          setTimeout(() => setValidationError(false), 1500);
          return;
        }
      }

      // Clear any validation error
      setValidationError(false);

      // Don't add duplicate chips
      const exists = chips.some((c) => c.field === field.id && c.value.toLowerCase() === value.toLowerCase());
      if (!exists) {
        onChipsChange([...chips, { field: field.id, value, label: `${field.label}: ${value}` }]);
      }
      setInputValue("");
      setShowDropdown(false);
      inputRef.current?.focus();
    },
    [chips, onChipsChange, data],
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
        if (!showDropdown && suggestions.length > 0) {
          setShowDropdown(true);
          setHighlightedIndex(0);
        } else if (suggestions.length > 0) {
          setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab" && showDropdown && suggestions.length > 0) {
        e.preventDefault();
        if (highlightedIndex >= 0) {
          // Already highlighted - cycle to next, wrapping around
          const nextIndex = (highlightedIndex + 1) % suggestions.length;
          tabComplete(nextIndex);
        } else if (suggestions.length === 1) {
          // Only one suggestion - auto-complete it
          tabComplete(0);
        } else if (parsedInput.hasPrefix && parsedInput.field) {
          // Multiple value suggestions after a field prefix (e.g., "pool:g") - start cycling
          tabComplete(0);
        }
        // Multiple field prefix suggestions (e.g., "p" -> pool:, platform:) - Tab does nothing
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (parsedInput.hasPrefix && parsedInput.field && parsedInput.query.trim()) {
          // Add filter when in field prefix mode (e.g., "pool:g" or "pool:gpu-pool-1")
          addChip(parsedInput.field, parsedInput.query.trim());
        } else if (showDropdown && highlightedIndex >= 0) {
          // Select highlighted suggestion (for field prefixes like "pool:")
          handleSelect(highlightedIndex);
        } else if (inputValue.trim()) {
          // Try to find a default field for free-text search (pool/name field)
          const defaultField = fields.find((f) => f.id === "pool" || f.id === "name") ?? fields[0];
          if (defaultField) {
            addChip(defaultField, inputValue.trim());
          }
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
    [suggestions, highlightedIndex, showDropdown, handleSelect, tabComplete, parsedInput, inputValue, chips, fields, addChip, removeChip],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setShowDropdown(true);
    setValidationError(false); // Clear error when user types
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
          validationError && "animate-shake border-red-500 ring-1 ring-red-500 focus-within:border-red-500 focus-within:ring-red-500",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <Search className={cn(
          "size-4 shrink-0 transition-colors",
          validationError ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
        )} />

        {chips.map((chip, index) => (
          <span
            key={`${chip.field}-${chip.value}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          >
            {chip.label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeChip(index);
              }}
              className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
            >
              <X className="size-3" />
            </button>
          </span>
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
          aria-haspopup="listbox"
          aria-activedescendant={shouldShowDropdown && highlightedIndex >= 0 ? `suggestion-${highlightedIndex}` : undefined}
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

      {/* Dropdown suggestions */}
      {shouldShowDropdown && (
        <div
          ref={dropdownRef}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[300px] overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
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
                    <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                      {suggestion.label}
                    </span>
                    {suggestion.hint && (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {suggestion.hint}
                      </span>
                    )}
                  </>
                ) : (
                  <span>{suggestion.label}</span>
                )}
              </span>
              {/* Only show Tab hint when Tab actually works: single suggestion or first value after prefix */}
              {(suggestions.length === 1 || (index === 0 && suggestion.type === "value" && parsedInput.hasPrefix)) && (
                <kbd className="hidden rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 sm:inline">
                  Tab
                </kbd>
              )}
            </button>
          ))}

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
