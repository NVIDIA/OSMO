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
 * Dataset Overview Tab Component
 *
 * Displays dataset information, description, and version history.
 */

"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/shadcn/card";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeFull } from "@/lib/format-date";
import type { Dataset } from "@/lib/api/adapter/datasets";

interface Props {
  dataset: Dataset;
}

export function OverviewTab({ dataset }: Props) {
  const sizeGib = dataset.size_bytes / 1024 ** 3;
  const formattedSize = formatBytes(sizeGib);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Dataset Information */}
      <Card>
        <CardHeader>
          <CardTitle>Dataset Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow
            label="ID"
            value={dataset.id}
          />
          <InfoRow
            label="Bucket"
            value={dataset.bucket}
          />
          <InfoRow
            label="Created By"
            value={dataset.created_by || "—"}
          />
          <InfoRow
            label="Created Date"
            value={formatDateTimeFull(dataset.created_at)}
          />
          <InfoRow
            label="Storage Size"
            value={formattedSize.display}
          />
        </CardContent>
      </Card>

      {/* Labels */}
      <Card>
        <CardHeader>
          <CardTitle>Labels</CardTitle>
        </CardHeader>
        <CardContent>
          {dataset.labels && Object.keys(dataset.labels).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(dataset.labels).map(([key, value]) => (
                <InfoRow
                  key={key}
                  label={key}
                  value={value}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">None</p>
          )}
        </CardContent>
      </Card>
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
