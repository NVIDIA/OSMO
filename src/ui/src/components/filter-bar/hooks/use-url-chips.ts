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
import { useQueryState, createMultiParser } from "nuqs";
import type { SearchChip } from "@/stores/types";
import { parseUrlChips } from "@/lib/url-utils";

export interface SetSearchChipsOptions {
  history?: "push" | "replace";
}

// Uses repeated query params (?f=pool:X&f=user:Y) for filter chips.
// type:"multi" makes nuqs call searchParams.getAll(), collecting repeated params.
// Each param value is one chip string — no secondary separator that could corrupt
// values containing commas.
const parseAsChipStrings = createMultiParser({
  parse: (values: readonly string[]) => values.filter(Boolean),
  serialize: (values: readonly string[]) => Array.from(values),
  eq: (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  },
});

export function useUrlChips({ paramName = "f" }: { paramName?: string } = {}) {
  const [filterStrings, setFilterStrings] = useQueryState(
    paramName,
    parseAsChipStrings.withOptions({
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
