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

import { memo, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { FieldFacet, LogLevel, LogSourceType } from "@/lib/api/log-adapter";
import { LOG_LEVEL_LABELS, LOG_SOURCE_TYPE_LABELS } from "@/lib/api/log-adapter";
import { FacetDropdown } from "./FacetDropdown";

// =============================================================================
// Types
// =============================================================================

export interface FacetBarProps {
  /** Facets to display */
  facets: FieldFacet[];
  /** Currently selected filters (field -> selected values) */
  selectedFilters: Map<string, Set<string>>;
  /** Callback when a filter changes */
  onFilterChange: (field: string, values: Set<string>) => void;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get display label for a field name.
 */
function getFieldLabel(field: string): string {
  switch (field) {
    case "level":
      return "Level";
    case "task":
      return "Task";
    case "source":
      return "Source";
    case "retry":
      return "Retry";
    default:
      return field;
  }
}

/**
 * Get formatter function for a field's values.
 */
function getValueFormatter(field: string): ((value: string) => string) | undefined {
  switch (field) {
    case "level":
      return (value: string) => LOG_LEVEL_LABELS[value as LogLevel] ?? value;
    case "source":
      return (value: string) => LOG_SOURCE_TYPE_LABELS[value as LogSourceType] ?? value;
    default:
      return undefined;
  }
}

// =============================================================================
// Component
// =============================================================================

function FacetBarInner({ facets, selectedFilters, onFilterChange, className }: FacetBarProps) {
  // Memoize field formatters to avoid recreating on every render
  const fieldFormatters = useMemo(() => {
    const formatters = new Map<string, ((value: string) => string) | undefined>();
    for (const facet of facets) {
      formatters.set(facet.field, getValueFormatter(facet.field));
    }
    return formatters;
  }, [facets]);

  // Handle filter change for a specific field
  const handleFilterChange = useCallback(
    (field: string) => (values: Set<string>) => {
      onFilterChange(field, values);
    },
    [onFilterChange],
  );

  // Don't render anything if there are no facets
  if (facets.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {facets.map((facet) => (
        <FacetDropdown
          key={facet.field}
          label={getFieldLabel(facet.field)}
          values={facet.values}
          selected={selectedFilters.get(facet.field) ?? new Set()}
          onSelectionChange={handleFilterChange(facet.field)}
          formatLabel={fieldFormatters.get(facet.field)}
        />
      ))}
    </div>
  );
}

export const FacetBar = memo(FacetBarInner);
