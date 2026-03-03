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
import { Tag, Copy, Check } from "lucide-react";
import { Card, CardContent } from "@/components/shadcn/card";
import { Button } from "@/components/shadcn/button";
import { formatBytes } from "@/lib/utils";
import { formatDateTimeSuccinct } from "@/lib/format-date";
import { useCopy } from "@/hooks/use-copy";
import type { Dataset, DatasetVersion } from "@/lib/api/adapter/datasets";

interface DatasetPanelDetailsProps {
  dataset: Dataset;
  /** When provided, version-specific fields (size, date, created_by, path) reflect this version */
  activeVersion?: DatasetVersion | null;
}

const DETAIL_GRID_CLASS =
  "grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm [&>*:nth-child(even)]:min-w-0 [&>*:nth-child(even)]:break-all";

export function DatasetPanelDetails({ dataset, activeVersion }: DatasetPanelDetailsProps) {
  const sizeBytes = activeVersion ? activeVersion.size : dataset.size_bytes;
  const sizeGib = sizeBytes / 1024 ** 3;
  const displayVersion = activeVersion ? parseInt(activeVersion.version, 10) : dataset.version;
  const createdAt = activeVersion?.created_date ?? dataset.created_at;
  const createdBy = activeVersion?.created_by ?? dataset.created_by;
  const displayPath = activeVersion?.uri ?? dataset.path;
  const { copied, copy } = useCopy();

  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Dataset Details</h3>

      <Card className="gap-0 py-0">
        <CardContent className="divide-border divide-y p-0">
          {/* Core metadata grid */}
          <div className="p-3">
            <div className={DETAIL_GRID_CLASS}>
              <span className="text-muted-foreground">Bucket</span>
              <span>{dataset.bucket}</span>

              {displayVersion !== undefined && displayVersion > 0 && (
                <>
                  <span className="text-muted-foreground">Version</span>
                  <span>v{displayVersion}</span>
                </>
              )}

              <span className="text-muted-foreground">Size</span>
              <span>{formatBytes(sizeGib).display}</span>

              <span className="text-muted-foreground">Created</span>
              <span>{formatDateTimeSuccinct(createdAt)}</span>

              {/* Updated is entity-level; hide when viewing a specific version (versions are immutable) */}
              {!activeVersion && (
                <>
                  <span className="text-muted-foreground">Updated</span>
                  <span>{formatDateTimeSuccinct(dataset.updated_at)}</span>
                </>
              )}

              {createdBy && (
                <>
                  <span className="text-muted-foreground">Created by</span>
                  <span>{createdBy}</span>
                </>
              )}

              {displayPath && (
                <>
                  <span className="text-muted-foreground">Path</span>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 font-mono text-xs break-all">{displayPath}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground size-5 shrink-0"
                      onClick={() => void copy(displayPath)}
                      aria-label="Copy path"
                    >
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </Button>
                  </div>
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
            {dataset.labels && Object.keys(dataset.labels).length > 0 ? (
              <div className={DETAIL_GRID_CLASS}>
                {Object.entries(dataset.labels).map(([key, value]) => (
                  <Fragment key={key}>
                    <span className="text-muted-foreground">{key}</span>
                    <span>{value}</span>
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
