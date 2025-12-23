// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // When native X clears input, call onClear if provided
    if (newValue === "" && value !== "" && onClear) {
      onClear();
    } else {
      onChange(newValue);
    }
  };

  return (
    <div className={cn("relative flex-1 min-w-[200px] max-w-xs", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
      <Input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        className="h-9 pl-9 pr-3 text-sm"
        aria-label={placeholder}
      />
    </div>
  );
}
