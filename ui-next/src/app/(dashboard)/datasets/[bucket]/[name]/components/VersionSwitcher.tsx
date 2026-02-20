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

/**
 * VersionSwitcher — Dropdown to switch between dataset versions.
 *
 * Shows version number + status badge per option.
 * Calls setVersion() from useFileBrowserState on change (preserves ?path=).
 */

"use client";

import { memo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/shadcn/select";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface VersionSwitcherProps {
  versions: DatasetVersion[];
  /** Currently selected version string (e.g. "5"), null = latest */
  selectedVersion: string | null;
  /** Called with version string when user picks a different version */
  onVersionChange: (version: string) => void;
}

/** Map backend status strings to a short display label and colour class. */
function statusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "READY") return "text-green-600 dark:text-green-400";
  if (s === "PENDING") return "text-amber-600 dark:text-amber-400";
  return "text-zinc-500 dark:text-zinc-400";
}

export const VersionSwitcher = memo(function VersionSwitcher({
  versions,
  selectedVersion,
  onVersionChange,
}: VersionSwitcherProps) {
  if (versions.length === 0) return null;

  // Latest version = highest version number
  const latestVersion = versions.reduce(
    (max, v) => (parseInt(v.version, 10) > parseInt(max.version, 10) ? v : max),
    versions[0],
  );

  const effectiveVersion = selectedVersion ?? latestVersion.version;

  return (
    <Select
      value={effectiveVersion}
      onValueChange={onVersionChange}
    >
      <SelectTrigger
        className="h-7 w-auto gap-1.5 border-zinc-200 bg-white px-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        aria-label="Select dataset version"
      >
        <span>
          <span className="text-zinc-500 dark:text-zinc-400">v</span>
          {effectiveVersion}
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        {[...versions]
          .sort((a, b) => parseInt(b.version, 10) - parseInt(a.version, 10))
          .map((v) => (
            <SelectItem
              key={v.version}
              value={v.version}
            >
              <span className="flex items-center gap-2">
                <span>v{v.version}</span>
                <span className={statusClass(v.status)}>{v.status}</span>
                {v.version === latestVersion.version && (
                  <span className="text-zinc-400 dark:text-zinc-500">(latest)</span>
                )}
              </span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
});
