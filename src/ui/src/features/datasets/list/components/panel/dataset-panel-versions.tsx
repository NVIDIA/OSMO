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

/**
 * DatasetPanelVersions — Versions section for the dataset slideout panel.
 *
 * Pool-style card with a compact table: version (+ tags), created by, date, size.
 * Sorted latest-first (descending by version number).
 * When onVersionSelect is provided, version numbers and individual tags are clickable
 * and call onVersionSelect(id) — same API as VersionPicker.onSelectionChange.
 */

"use client";

import { cn, naturalCompare, formatBytes } from "@/lib/utils";
import { Card, CardContent } from "@/components/shadcn/card";
import { formatDateTimeSuccinct } from "@/lib/format-date";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface DatasetPanelVersionsProps {
  versions: DatasetVersion[];
  /** Currently active version ID (from URL state on detail page), highlighted in the list */
  activeVersionId?: string;
  /** Called with version ID, tag name, or null (for "latest") — same as VersionPicker */
  onVersionSelect?: (id: string | null) => void;
}

export function DatasetPanelVersions({ versions, activeVersionId, onVersionSelect }: DatasetPanelVersionsProps) {
  const sorted = [...versions].sort((a, b) => naturalCompare(b.version, a.version));

  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Versions</h3>

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="text-muted-foreground flex h-16 items-center justify-center text-sm">
              No versions available
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">Version</th>
                    <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">Created by</th>
                    <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">Date</th>
                    <th className="text-muted-foreground px-3 py-2 text-right text-xs font-medium">Size</th>
                    <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">Tags</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {sorted.map((version) => {
                    const sizeGib = version.size / 1024 ** 3;
                    const isActive = activeVersionId === version.version;
                    return (
                      <tr
                        key={version.version}
                        onClick={onVersionSelect ? () => onVersionSelect(version.version) : undefined}
                        className={cn(
                          isActive && "bg-muted/70",
                          !isActive && onVersionSelect && "hover:bg-muted/50 cursor-pointer",
                        )}
                      >
                        <td className="px-3 py-2 align-top">
                          <span className="font-mono">{version.version}</span>
                        </td>
                        <td className="text-muted-foreground px-3 py-2 align-top">{version.created_by}</td>
                        <td className="text-muted-foreground px-3 py-2 align-top">
                          {formatDateTimeSuccinct(version.created_date)}
                        </td>
                        <td className="px-3 py-2 text-right align-top font-mono">{formatBytes(sizeGib).display}</td>
                        <td className="px-3 py-2 align-top">
                          {version.tags && version.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {version.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
