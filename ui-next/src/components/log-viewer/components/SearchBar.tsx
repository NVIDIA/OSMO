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

import { memo, useDeferredValue, useEffect, useState } from "react";
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
  /** Result count to display as suffix */
  resultCount: number;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

function SearchBarInner({ value, onChange, resultCount, placeholder = "Search logs...", className }: SearchBarProps) {
  // Local state for immediate input feedback
  const [localValue, setLocalValue] = useState(value);

  // Sync local state when controlled value changes from parent
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Defer the value to prevent blocking typing during filtering
  const deferredValue = useDeferredValue(localValue);

  // Notify parent when deferred value changes
  useEffect(() => {
    if (deferredValue !== value) {
      onChange(deferredValue);
    }
  }, [deferredValue, value, onChange]);

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
        className="pr-20 pl-9"
      />

      {/* Result count suffix */}
      <span className="text-muted-foreground pointer-events-none absolute right-3 text-sm tabular-nums">
        {resultCount.toLocaleString()}
      </span>
    </div>
  );
}

export const SearchBar = memo(SearchBarInner);
