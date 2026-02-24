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
 * DatasetPanelDetails — Details section for the dataset slideout panel.
 *
 * Pool-style card layout: bucket, version, size, dates, created by, labels.
 */

"use client";

import { Fragment } from "react";
import { Tag } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeSuccinct } from "@/lib/format-date";
import type { Dataset } from "@/lib/api/adapter/datasets";

interface DatasetPanelDetailsProps {
  dataset: Dataset;
}

export function DatasetPanelDetails({ dataset }: DatasetPanelDetailsProps) {
  const sizeGib = dataset.size_bytes / 1024 ** 3;
  const hasLabels = dataset.labels && Object.keys(dataset.labels).length > 0;

  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Dataset Details</h3>

      <Card className="gap-0 py-0">
        <CardContent className="divide-border divide-y p-0">
          {/* Core metadata grid */}
          <div className="p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Bucket</span>
              <span className="truncate text-right">{dataset.bucket}</span>

              {dataset.version !== undefined && dataset.version > 0 && (
                <>
                  <span className="text-muted-foreground">Version</span>
                  <span className="text-right">v{dataset.version}</span>
                </>
              )}

              <span className="text-muted-foreground">Size</span>
              <span className="text-right">{formatBytes(sizeGib).display}</span>

              <span className="text-muted-foreground">Created</span>
              <span className="text-right">{formatDateTimeSuccinct(dataset.created_at)}</span>

              <span className="text-muted-foreground">Updated</span>
              <span className="text-right">{formatDateTimeSuccinct(dataset.updated_at)}</span>

              {dataset.created_by && (
                <>
                  <span className="text-muted-foreground">Created by</span>
                  <span className="truncate text-right">{dataset.created_by}</span>
                </>
              )}

              {dataset.path && (
                <>
                  <span className="text-muted-foreground">Path</span>
                  <span className="truncate text-right font-mono text-xs">{dataset.path}</span>
                </>
              )}
            </div>
          </div>

          {/* Labels */}
          <div className="p-3">
            <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Tag className="size-3" />
              Labels
            </div>
            {hasLabels ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {Object.entries(dataset.labels!).map(([key, value]) => (
                  <Fragment key={key}>
                    <span className="text-muted-foreground truncate">{key}</span>
                    <span className="truncate text-right">{value}</span>
                  </Fragment>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">No labels</span>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
