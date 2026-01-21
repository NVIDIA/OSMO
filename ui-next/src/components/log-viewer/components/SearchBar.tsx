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

import { memo, useDeferredValue, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/shadcn/input";

// =============================================================================
// Types
// =============================================================================

export interface SearchBarProps {
  /** Current search value */
  value: string;
  /** Callback when search value changes (debounced) */
  onChange: (value: string) => void;
  /** Filtered result count (shown when searching) */
  resultCount: number;
  /** Total entry count */
  totalCount: number;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function SearchBarInner({
  value,
  onChange,
  resultCount,
  totalCount,
  placeholder = "Search logs...",
  className,
}: SearchBarProps) {
  // Local state for immediate input feedback.
  // Initialize with parent's value.
  const [localValue, setLocalValue] = useState(value);

  // Track the last parent value we synced from.
  // This allows us to detect when parent provides a new value (external reset).
  const [lastSyncedParentValue, setLastSyncedParentValue] = useState(value);

  // Track last emitted value to parent (avoids notifying with same value).
  const [lastEmittedValue, setLastEmittedValue] = useState(value);

  // Sync local state when controlled value changes from parent (external reset).
  // This uses the "updating state during render" pattern recommended by React:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (value !== lastSyncedParentValue) {
    setLastSyncedParentValue(value);
    // Only update local value if parent's value differs from what we last sent
    if (value !== lastEmittedValue) {
      setLocalValue(value);
      setLastEmittedValue(value);
    }
  }

  // Defer the value to prevent blocking typing during filtering.
  // React 19's useDeferredValue handles the transition automatically.
  const deferredValue = useDeferredValue(localValue);

  // Notify parent when deferred value changes.
  // Uses "updating state during render" pattern to trigger onChange.
  // This is the React-recommended pattern for derived computations:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (deferredValue !== lastEmittedValue) {
    setLastEmittedValue(deferredValue);
    // Schedule the onChange call. React batches these updates.
    // Note: This is intentionally during render - React handles it correctly
    // as part of the state update during render pattern.
    onChange(deferredValue);
  }

  // Use localValue for immediate UI feedback (not the lagging controlled value)
  const isSearching = localValue.length > 0;

  return (
    <div className={cn("relative flex items-center", className)}>
      {/* Search icon */}
      <Search className="text-muted-foreground absolute left-3 size-4" />

      {/* Input */}
      <Input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="pr-44 pl-9"
      />

      {/* Result count suffix */}
      <span className="text-muted-foreground pointer-events-none absolute right-3 text-sm tabular-nums">
        {isSearching
          ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()} entries`
          : `${totalCount.toLocaleString()} entries`}
      </span>
    </div>
  );
}

export const SearchBar = memo(SearchBarInner);
