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

"use client";

import { memo } from "react";
import { formatCompact, formatBytes, formatBytesPair } from "@/lib/utils";
import type { DisplayMode } from "@/stores";

interface CapacityCellProps {
  used: number;
  total: number;
  /** If true, values are in GiB and will be formatted with appropriate binary unit */
  isBytes?: boolean;
  mode?: DisplayMode;
}

/**
 * Memoized capacity cell - prevents re-renders when values haven't changed.
 *
 * For memory/storage (isBytes=true), uses conventional binary units (Ki, Mi, Gi, Ti).
 * When showing used/total, both use the same (more granular) unit for consistency.
 * For other resources, uses compact number formatting.
 */
export const CapacityCell = memo(function CapacityCell({
  used,
  total,
  isBytes = false,
  mode = "free",
}: CapacityCellProps) {
  if (total === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  // For bytes, use pair formatting to ensure consistent units
  if (isBytes) {
    if (mode === "free") {
      const free = total - used;
      const formatted = formatBytes(free);
      return (
        <span className="text-zinc-900 dark:text-zinc-100">
          {formatted.value}
          <span className="ml-0.5 text-xs text-zinc-400">{formatted.unit}</span>
        </span>
      );
    }

    // Used/total mode: use consistent units
    const pair = formatBytesPair(used, total);
    return (
      <span>
        <span className="text-zinc-900 dark:text-zinc-100">{pair.used}</span>
        <span className="text-zinc-400 dark:text-zinc-500">/{pair.total}</span>
        <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">{pair.unit}</span>
      </span>
    );
  }

  // Non-bytes: use compact formatting
  const free = total - used;

  if (mode === "free") {
    return <span className="text-zinc-900 dark:text-zinc-100">{formatCompact(free)}</span>;
  }

  return (
    <span>
      <span className="text-zinc-900 dark:text-zinc-100">{formatCompact(used)}</span>
      <span className="text-zinc-400 dark:text-zinc-500">/{formatCompact(total)}</span>
    </span>
  );
});
