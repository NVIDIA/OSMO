// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { type ElementType } from "react";
import { ChevronDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

interface FilterSingleSelectProps<T extends string> {
  /** Icon to display in the trigger button */
  icon?: ElementType;
  /** Label for the dropdown trigger */
  label: string;
  /** Available options */
  options: T[];
  /** Currently selected option (undefined = no selection) */
  value?: T;
  /** Callback when selection changes */
  onChange: (value: T) => void;
  /** Render function for option labels (optional) */
  renderOption?: (option: T) => string;
  /** Additional class name */
  className?: string;
}

/**
 * Single-select dropdown component for FilterBar.
 *
 * @example
 * ```tsx
 * <FilterBar.SingleSelect
 *   icon={Box}
 *   label="Type"
 *   options={resourceTypes}
 *   value={selectedType}
 *   onChange={setSelectedType}
 * />
 * ```
 */
export function FilterSingleSelect<T extends string>({
  icon: Icon = Filter,
  label,
  options,
  value,
  onChange,
  renderOption,
  className,
}: FilterSingleSelectProps<T>) {
  const hasSelection = value !== undefined;
  const getLabel = (option: T) => renderOption?.(option) ?? option;

  // Single option: show as informational only
  if (options.length <= 1) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className={cn("gap-1.5", className)}
      >
        <Icon
          className="h-3.5 w-3.5"
          aria-hidden="true"
        />
        {options.length === 1 ? getLabel(options[0]) : label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={hasSelection ? `${label}: ${getLabel(value!)} selected` : `Filter by ${label}`}
          className={cn(
            "gap-1.5",
            hasSelection && "border-[var(--nvidia-green)] bg-[var(--nvidia-green)]/5",
            className,
          )}
        >
          <Icon
            className="h-3.5 w-3.5"
            aria-hidden="true"
          />
          {label}
          {hasSelection && (
            <span
              className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--nvidia-green)] px-1 text-[10px] font-semibold text-white"
              aria-hidden="true"
            >
              1
            </span>
          )}
          <ChevronDown
            className="h-3.5 w-3.5 opacity-50"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-44"
      >
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(v) => onChange(v as T)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
            >
              {getLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
