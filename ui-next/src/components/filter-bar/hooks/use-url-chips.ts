// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import type { SearchChip } from "@/stores/types";
import { parseUrlChips } from "@/lib/url-utils";

export interface SetSearchChipsOptions {
  history?: "push" | "replace";
}

/**
 * URL-synced search chips. Parses "field:value" from repeated URL params (?f=field:value)
 * into SearchChip[] and writes changes back to the URL for shareable filtered views.
 */
export function useUrlChips({ paramName = "f" }: { paramName?: string } = {}) {
  const [filterStrings, setFilterStrings] = useQueryState(
    paramName,
    parseAsArrayOf(parseAsString).withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  const searchChips = useMemo<SearchChip[]>(() => parseUrlChips(filterStrings ?? []), [filterStrings]);

  const setSearchChips = useCallback(
    (chips: SearchChip[], options?: SetSearchChipsOptions) => {
      const value = chips.length === 0 ? null : chips.map((c) => `${c.field}:${c.value}`);
      void setFilterStrings(value, options);
    },
    [setFilterStrings],
  );

  return { searchChips, setSearchChips };
}
