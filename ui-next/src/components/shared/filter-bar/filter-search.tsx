// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { clearButton } from "@/lib/styles";

interface FilterSearchProps {
  /** Current search value */
  value: string;
  /** Callback when search value changes */
  onChange: (value: string) => void;
  /** Callback when search is cleared (optional, defaults to onChange("")) */
  onClear?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class name for the container */
  className?: string;
}

/**
 * Search input component for FilterBar.
 *
 * @example
 * ```tsx
 * <FilterBar.Search
 *   value={search}
 *   onChange={setSearch}
 *   placeholder="Search nodes..."
 * />
 * ```
 */
export function FilterSearch({
  value,
  onChange,
  onClear,
  placeholder = "Search...",
  className,
}: FilterSearchProps) {
  const hasValue = value.length > 0;

  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
  };

  return (
    <div className={cn("relative flex-1 min-w-[200px] max-w-xs", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 pl-9 pr-8 text-sm"
      />
      {hasValue && (
        <button
          onClick={handleClear}
          className={cn("absolute right-2 top-1/2 -translate-y-1/2", clearButton)}
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
