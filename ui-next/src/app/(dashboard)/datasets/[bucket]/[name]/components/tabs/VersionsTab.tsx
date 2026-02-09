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
 * Dataset Versions Tab Component
 *
 * Displays version history with metadata for each version.
 */

"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/shadcn/card";
import { Badge } from "@/components/shadcn/badge";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeFull } from "@/lib/format-date";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

interface Props {
  versions: DatasetVersion[];
  currentVersion?: number;
}

export function VersionsTab({ versions, currentVersion }: Props) {
  if (!versions || versions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No versions available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {versions.map((version) => {
        const versionNum = parseInt(version.version, 10);
        const isCurrent = currentVersion === versionNum;
        const sizeGib = version.size / 1024 ** 3;
        const formattedSize = formatBytes(sizeGib);

        return (
          <Card key={version.version}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  Version {version.version}
                  {isCurrent && (
                    <Badge
                      variant="default"
                      className="ml-2"
                    >
                      Current
                    </Badge>
                  )}
                </CardTitle>
                <Badge
                  variant={version.status === "READY" ? "default" : "secondary"}
                  className={version.status === "READY" ? "bg-green-600 hover:bg-green-700" : ""}
                >
                  {version.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow
                label="Created By"
                value={version.created_by}
              />
              <InfoRow
                label="Created Date"
                value={formatDateTimeFull(version.created_date)}
              />
              <InfoRow
                label="Last Used"
                value={formatDateTimeFull(version.last_used)}
              />
              <InfoRow
                label="Size"
                value={formattedSize.display}
              />
              <InfoRow
                label="Retention Policy"
                value={`${version.retention_policy} days`}
              />
              {version.tags && version.tags.length > 0 && (
                <div className="flex items-start justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Tags</span>
                  <div className="flex flex-wrap gap-1">
                    {version.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {version.collections && version.collections.length > 0 && (
                <InfoRow
                  label="Related Collections"
                  value={version.collections.join(", ")}
                />
              )}
              {(!version.collections || version.collections.length === 0) && (
                <InfoRow
                  label="Related Collections"
                  value="None"
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}
