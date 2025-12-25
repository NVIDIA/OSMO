// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface FilterToggleProps<T extends string> {
  /** Label displayed before the toggle */
  label?: string;
  /** Available options */
  options: ToggleOption<T>[];
  /** Currently selected value */
  value: T;
  /** Callback when selection changes */
  onChange: (value: T) => void;
  /** Additional class name */
  className?: string;
}

/**
 * Segmented toggle button component for FilterBar.
 *
 * @example
 * ```tsx
 * <FilterBar.Toggle
 *   label="View by"
 *   options={[
 *     { value: "free", label: "Free" },
 *     { value: "used", label: "Used" },
 *   ]}
 *   value={displayMode}
 *   onChange={setDisplayMode}
 * />
 * ```
 */
export function FilterToggle<T extends string>({ label, options, value, onChange, className }: FilterToggleProps<T>) {
  const labelId = useId();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && (
        <span
          id={labelId}
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          {label}:
        </span>
      )}
      <div
        role="radiogroup"
        aria-labelledby={label ? labelId : undefined}
        className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
              value === option.value
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
