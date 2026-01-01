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
 * An inline omni search with chip-based filtering:
 * - Type freely → suggestions appear as dropdown
 * - Select suggestion → adds as chip
 * - Multiple chips = AND filter
 * - Supports field:value prefixes (e.g., status:online)
 * - Chips displayed inline, removable with X
 *
 * Uses cmdk (Command) in inline mode, NOT modal.
 */

"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Command, CommandList, CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SmartSearchProps, SearchField, SearchChip } from "./types";

export function SmartSearch<T>({
  data,
  fields,
  chips,
  onChipsChange,
  placeholder = "Search... (try 'status:online')",
  className,
}: SmartSearchProps<T>) {
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse input for field prefix (e.g., "status:" → { field, query })
  const parsedInput = useMemo(() => {
    const colonIndex = inputValue.indexOf(":");
    if (colonIndex > 0) {
      const prefix = inputValue.slice(0, colonIndex + 1);
      const field = fields.find((f) => f.prefix === prefix);
      if (field) {
        return { field, query: inputValue.slice(colonIndex + 1) };
      }
    }
    return { field: null, query: inputValue };
  }, [inputValue, fields]);

  // Get suggestions based on current input
  const suggestions = useMemo(() => {
    if (!parsedInput.field) {
      // Show field prefixes as suggestions
      const queryLower = parsedInput.query.toLowerCase();
      return fields
        .filter((f) => f.prefix && (f.label.toLowerCase().includes(queryLower) || f.prefix.includes(queryLower)))
        .map((f) => ({
          type: "prefix" as const,
          field: f,
          value: f.prefix,
          label: `${f.label}: ...`,
        }));
    }
    // Show values for the selected field
    const values = parsedInput.field.getValues(data);
    const queryLower = parsedInput.query.toLowerCase();
    const filtered = values.filter((v) => v.toLowerCase().includes(queryLower));
    return filtered.slice(0, 10).map((v) => ({
      type: "value" as const,
      field: parsedInput.field!,
      value: v,
      label: `${parsedInput.field!.label}: ${v}`,
    }));
  }, [parsedInput, fields, data]);

  const addChip = useCallback(
    (field: SearchField<T>, value: string) => {
      // Don't add duplicate chips
      const exists = chips.some((c) => c.field === field.id && c.value.toLowerCase() === value.toLowerCase());
      if (!exists) {
        onChipsChange([...chips, { field: field.id, value, label: `${field.label}: ${value}` }]);
      }
      setInputValue("");
      inputRef.current?.focus();
    },
    [chips, onChipsChange],
  );

  const removeChip = useCallback(
    (index: number) => {
      onChipsChange(chips.filter((_, i) => i !== index));
    },
    [chips, onChipsChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
        removeChip(chips.length - 1);
      }
      if (e.key === "Enter" && inputValue && !parsedInput.field) {
        // Free-text search - find a "name" or first text field
        const freeField = fields.find((f) => f.id === "name") ?? fields[0];
        if (freeField) {
          e.preventDefault();
          addChip(freeField, inputValue);
        }
      }
    },
    [inputValue, chips, parsedInput.field, fields, addChip, removeChip],
  );

  const handleSelect = useCallback(
    (suggestion: (typeof suggestions)[0]) => {
      if (suggestion.type === "prefix") {
        setInputValue(suggestion.value);
        inputRef.current?.focus();
      } else {
        addChip(suggestion.field, suggestion.value);
      }
    },
    [addChip],
  );

  const showDropdown = isFocused && (inputValue.length > 0 || chips.length === 0);

  return (
    <Command
      className={cn("relative rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900", className)}
      shouldFilter={false}
    >
      {/* Inline chips + input row */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <Search className="size-4 shrink-0 text-zinc-400 dark:text-zinc-500" />

        {chips.map((chip, index) => (
          <span
            key={`${chip.field}-${chip.value}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          >
            {chip.label}
            <button
              type="button"
              onClick={() => removeChip(index)}
              className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <CommandPrimitive.Input
          ref={inputRef}
          value={inputValue}
          onValueChange={setInputValue}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : "Add filter..."}
          className="min-w-[150px] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />

        {chips.length > 0 && (
          <button
            type="button"
            onClick={() => onChipsChange([])}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Dropdown suggestions */}
      {showDropdown && (
        <CommandList className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[300px] overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <CommandEmpty className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
            {inputValue ? "No matches. Press Enter for free-text search." : "Type to search..."}
          </CommandEmpty>

          {!parsedInput.field && suggestions.length > 0 && (
            <CommandGroup heading="Filter by">
              {suggestions.map((s) => (
                <CommandItem key={s.field.id} onSelect={() => handleSelect(s)} className="cursor-pointer">
                  <span className="mr-2 font-mono text-xs text-blue-600 dark:text-blue-400">{s.field.prefix}</span>
                  {s.field.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {parsedInput.field && suggestions.length > 0 && (
            <CommandGroup heading={parsedInput.field.label}>
              {suggestions.map((s, i) => (
                <CommandItem key={`${s.value}-${i}`} onSelect={() => handleSelect(s)} className="cursor-pointer">
                  {s.value}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      )}
    </Command>
  );
}
