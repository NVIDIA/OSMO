//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import { memo, useCallback } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks";
import { Button } from "@/components/shadcn/button";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import type { FacetValue } from "@/lib/api/log-adapter";

// =============================================================================
// Types
// =============================================================================

export interface FacetDropdownProps {
  /** Unique field identifier for this facet (used in callbacks and IDs) */
  field: string;
  /** Label for the dropdown button */
  label: string;
  /** Available values with counts */
  values: FacetValue[];
  /** Currently selected values */
  selected: Set<string>;
  /** Callback when selection changes - includes field for stable callback pattern */
  onSelectionChange: (field: string, values: Set<string>) => void;
  /** Optional formatter for display labels */
  formatLabel?: (value: string) => string;
  /** Optional icon to display in the dropdown trigger */
  icon?: LucideIcon;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Facet Item
// =============================================================================

interface FacetItemProps {
  /** Unique ID for this checkbox (field-value combination) */
  id: string;
  displayLabel: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}

function FacetItem({ id, displayLabel, count, checked, onToggle }: FacetItemProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors",
        "hover:bg-muted/50",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
      />
      <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{count.toLocaleString()}</span>
    </label>
  );
}

// =============================================================================
// Component
// =============================================================================

function FacetDropdownInner({
  field,
  label,
  values,
  selected,
  onSelectionChange,
  formatLabel,
  icon: Icon,
  className,
}: FacetDropdownProps) {
  const mounted = useMounted();

  // Handle toggling a value - stable callback that includes field
  const handleToggle = useCallback(
    (value: string) => {
      const newSelected = new Set(selected);
      if (newSelected.has(value)) {
        newSelected.delete(value);
      } else {
        newSelected.add(value);
      }
      onSelectionChange(field, newSelected);
    },
    [field, selected, onSelectionChange],
  );

  // Count of selected values
  const selectedCount = selected.size;

  // Button label with optional icon and count badge
  const buttonLabel = (
    <>
      {Icon && <Icon className="text-muted-foreground size-3.5" />}
      {label}
      {selectedCount > 0 && (
        <span className="bg-primary text-primary-foreground ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium">
          {selectedCount}
        </span>
      )}
    </>
  );

  // Show placeholder button during SSR/hydration
  if (!mounted) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className={cn("gap-2", className)}
      >
        {buttonLabel}
        <ChevronDown className="text-muted-foreground size-3.5" />
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={selectedCount > 0 ? "secondary" : "outline"}
          size="sm"
          className={cn("gap-2", className)}
        >
          {buttonLabel}
          <ChevronDown className="text-muted-foreground size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-2"
      >
        <div className="max-h-64 overflow-y-auto overscroll-contain">
          {values.length === 0 ? (
            <div className="text-muted-foreground px-2 py-3 text-center text-sm">No values</div>
          ) : (
            values.map((item) => (
              <FacetItem
                key={item.value}
                id={`facet-${field}-${item.value}`}
                displayLabel={formatLabel ? formatLabel(item.value) : item.value}
                count={item.count}
                checked={selected.has(item.value)}
                onToggle={() => handleToggle(item.value)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const FacetDropdown = memo(FacetDropdownInner);
