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
 * Dataset Versions Table Component
 *
 * Table-based display of version history matching workflows Tasks table style.
 */

"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/shadcn/badge";
import { Input } from "@/components/shadcn/input";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeSuccinct } from "@/lib/format-date";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface Props {
  versions: DatasetVersion[];
  currentVersion?: number;
}

export function VersionsTable({ versions, currentVersion }: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and sort versions
  const filteredVersions = useMemo(() => {
    if (!versions || versions.length === 0) return [];

    // Sort descending first (highest version number = current)
    const sorted = [...versions].sort((a, b) => parseInt(b.version) - parseInt(a.version));

    // Filter by search query
    if (!searchQuery.trim()) return sorted;

    const query = searchQuery.toLowerCase();
    return sorted.filter((v) => {
      return (
        v.version.toLowerCase().includes(query) ||
        v.status.toLowerCase().includes(query) ||
        v.created_by.toLowerCase().includes(query) ||
        v.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [versions, searchQuery]);

  if (!versions || versions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No versions available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input
            type="text"
            placeholder="Search versions by number, status, user, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {searchQuery.trim()
            ? `${filteredVersions.length} of ${versions.length} versions`
            : `${versions.length} versions`}
        </p>
      </div>

      {/* Table */}
      {filteredVersions.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No versions match your search</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="overflow-x-auto">
            <table className="w-full">
              {/* Header */}
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Version
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Created By
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Created Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Last Used
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Size
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Retention
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-zinc-600 uppercase dark:text-zinc-400">
                    Tags
                  </th>
                </tr>
              </thead>

              {/* Body */}
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                {filteredVersions.map((version) => {
                  const versionNum = parseInt(version.version);
                  const isCurrent = versionNum === currentVersion;
                  const sizeGib = version.size / 1024 ** 3;
                  const formattedSize = formatBytes(sizeGib);
                  const retentionDays = Math.floor(version.retention_policy / 86400);

                  return (
                    <tr
                      key={version.version}
                      className={`transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${isCurrent ? "bg-[#76b900]/5 dark:bg-[#76b900]/10" : ""} `}
                    >
                      {/* Version */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-sm ${
                              isCurrent ? "font-semibold text-[#76b900]" : "text-zinc-900 dark:text-zinc-100"
                            }`}
                          >
                            {version.version}
                          </span>
                          {isCurrent && (
                            <Badge
                              variant="default"
                              className="bg-[#76b900] text-xs hover:bg-[#6aa800]"
                            >
                              Current
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge
                          variant={version.status === "READY" ? "default" : "secondary"}
                          className={
                            version.status === "READY"
                              ? "bg-green-600 hover:bg-green-700"
                              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                          }
                        >
                          {version.status}
                        </Badge>
                      </td>

                      {/* Created By */}
                      <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">{version.created_by}</td>

                      {/* Created Date */}
                      <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100">
                        {formatDateTimeSuccinct(version.created_date)}
                      </td>

                      {/* Last Used */}
                      <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                        {formatDateTimeSuccinct(version.last_used)}
                      </td>

                      {/* Size */}
                      <td className="px-4 py-3 text-right font-mono text-sm text-zinc-900 dark:text-zinc-100">
                        {formattedSize.display}
                      </td>

                      {/* Retention */}
                      <td className="px-4 py-3 text-right font-mono text-sm text-zinc-600 dark:text-zinc-400">
                        {retentionDays}d
                      </td>

                      {/* Tags */}
                      <td className="px-4 py-3">
                        {version.tags && version.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {version.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
