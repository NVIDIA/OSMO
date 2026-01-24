/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * URL-synced search chips hook.
 *
 * Manages SearchChip[] state synced to URL query parameters.
 * Format: ?f=field1:value1&f=field2:value2
 *
 * This enables shareable/bookmarkable filtered views.
 */

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import type { SearchChip } from "@/stores";
import { parseUrlChips } from "@/lib/url-utils";

// =============================================================================
// Types
// =============================================================================

export interface UseUrlChipsOptions {
  /** URL parameter name (default: "f") */
  paramName?: string;
}

export interface UseUrlChipsResult {
  /** Current search chips parsed from URL */
  searchChips: SearchChip[];
  /** Update search chips (syncs to URL) */
  setSearchChips: (chips: SearchChip[]) => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for URL-synced search chips.
 *
 * Parses "field:value" format from repeated URL params into SearchChip[].
 * Updates URL when chips change.
 *
 * @example
 * ```tsx
 * // URL: /pools?f=status:ONLINE&f=platform:dgx
 * const { searchChips, setSearchChips } = useUrlChips();
 * // searchChips = [
 * //   { field: "status", value: "ONLINE", label: "status: ONLINE" },
 * //   { field: "platform", value: "dgx", label: "platform: dgx" },
 * // ]
 * ```
 */
export function useUrlChips(options: UseUrlChipsOptions = {}): UseUrlChipsResult {
  const { paramName = "f" } = options;

  // URL state - repeated params: ?f=status:ONLINE&f=platform:dgx
  const [filterStrings, setFilterStrings] = useQueryState(
    paramName,
    parseAsArrayOf(parseAsString).withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // Parse filter strings to SearchChip format (reuse shared parsing logic)
  const searchChips = useMemo<SearchChip[]>(() => parseUrlChips(filterStrings ?? []), [filterStrings]);

  // Convert chips back to filter strings for URL
  const setSearchChips = useCallback(
    (chips: SearchChip[]) => {
      if (chips.length === 0) {
        setFilterStrings(null);
      } else {
        setFilterStrings(chips.map((c) => `${c.field}:${c.value}`));
      }
    },
    [setFilterStrings],
  );

  return { searchChips, setSearchChips };
}
