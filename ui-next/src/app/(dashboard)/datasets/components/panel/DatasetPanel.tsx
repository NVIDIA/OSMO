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
 * DatasetPanel — Slideout detail panel for a single dataset.
 *
 * Fetches dataset detail (metadata + versions) and renders as a single
 * scrollable view: details card at top, versions card below.
 */

"use client";

import { Skeleton } from "@/components/shadcn/skeleton";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { PanelHeaderActions } from "@/components/panel/panel-header-controls";
import { useDataset } from "@/lib/api/adapter/datasets-hooks";
import { DatasetPanelDetails } from "@/app/(dashboard)/datasets/components/panel/DatasetPanelDetails";
import { DatasetPanelVersions } from "@/app/(dashboard)/datasets/components/panel/DatasetPanelVersions";

// =============================================================================
// Types
// =============================================================================

interface DatasetPanelProps {
  bucket: string;
  name: string;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function DatasetPanel({ bucket, name, onClose }: DatasetPanelProps) {
  const { data, isLoading, error } = useDataset(bucket, name, { enabled: !!bucket && !!name });

  const dataset = data?.dataset;
  const versions = data?.versions ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <PanelHeader
        title={<PanelTitle>{name}</PanelTitle>}
        actions={
          <PanelHeaderActions
            badge="Dataset"
            onClose={onClose}
          />
        }
      />

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}

        {error && !isLoading && (
          <div className="text-destructive flex h-32 items-center justify-center text-sm">
            Failed to load dataset details.
          </div>
        )}

        {dataset && !isLoading && (
          <div className="space-y-6">
            <DatasetPanelDetails dataset={dataset} />
            <DatasetPanelVersions
              versions={versions}
              currentVersion={dataset.version}
            />
          </div>
        )}
      </div>
    </div>
  );
}
