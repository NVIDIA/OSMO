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
 * DatasetPanel — Slideout detail panel for a single dataset.
 *
 * Fetches dataset detail (metadata + versions) and renders as a single
 * scrollable view: details card at top, versions card below.
 */

"use client";

import { useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Button } from "@/components/shadcn/button";
import { PanelHeader, PanelTitle } from "@/components/panel/panel-header";
import { PanelHeaderActions } from "@/components/panel/panel-header-controls";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { useViewTransition } from "@/hooks/use-view-transition";
import { useDataset } from "@/lib/api/adapter/datasets-hooks";
import { DatasetPanelDetails } from "@/features/datasets/list/components/panel/dataset-panel-details";
import { DatasetPanelVersions } from "@/features/datasets/list/components/panel/dataset-panel-versions";
import type { DatasetVersion } from "@/lib/api/adapter/datasets";

// =============================================================================
// Types
// =============================================================================

interface DatasetPanelProps {
  bucket: string;
  name: string;
  onClose: () => void;
  onVersionClick?: (version: DatasetVersion) => void;
}

// =============================================================================
// Component
// =============================================================================

export function DatasetPanel({ bucket, name, onClose, onVersionClick }: DatasetPanelProps) {
  const router = useNavigationRouter();
  const { startTransition } = useViewTransition();
  const { data, isLoading, error } = useDataset(bucket, name, { enabled: !!bucket && !!name });

  const dataset = data?.dataset;
  const versions = data?.versions ?? [];

  const handleBrowseFiles = useCallback(() => {
    startTransition(() => {
      router.push(`/datasets/${encodeURIComponent(bucket)}/${encodeURIComponent(name)}`);
    });
  }, [router, startTransition, bucket, name]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <PanelHeader
        title={<PanelTitle>{name}</PanelTitle>}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={handleBrowseFiles}
              aria-label={`Browse files for ${name}`}
            >
              <FolderOpen
                className="size-3.5"
                aria-hidden="true"
              />
              Browse files
            </Button>
            <PanelHeaderActions
              badge="Dataset"
              onClose={onClose}
            />
          </div>
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
              onVersionClick={onVersionClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}
