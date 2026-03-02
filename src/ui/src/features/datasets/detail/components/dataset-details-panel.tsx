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
 * DatasetDetailsPanel — Tabbed overview + versions/members panel for the detail page.
 *
 * Overview tab: uses useDatasetLatest (tag=latest) for a lightweight eager load.
 * Versions tab (datasets only): uses useDataset (full call) gated on tab activation.
 * Members tab (collections only): uses latestData.members (tag is ignored server-side).
 */

"use client";

import { useState, useMemo } from "react";
import { Skeleton } from "@/components/shadcn/skeleton";
import { PanelTabs, type PanelTab } from "@/components/panel/panel-tabs";
import { TabPanel } from "@/components/panel/tab-panel";
import { DatasetPanelDetails } from "@/features/datasets/list/components/panel/dataset-panel-details";
import { DatasetPanelVersions } from "@/features/datasets/list/components/panel/dataset-panel-versions";
import { CollectionPanelMembers } from "@/features/datasets/list/components/panel/collection-panel-members";
import { useDatasetLatest, useDataset } from "@/lib/api/adapter/datasets-hooks";
import { DatasetType } from "@/lib/api/generated";

interface Props {
  bucket: string;
  name: string;
}

const DATASET_TABS: PanelTab[] = [
  { id: "overview", label: "Overview" },
  { id: "versions", label: "Versions" },
];

const COLLECTION_TABS: PanelTab[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
];

const LoadingSkeleton = () => (
  <div className="space-y-4">
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-4 w-1/2" />
  </div>
);

export function DatasetDetailsPanel({ bucket, name }: Props) {
  const [activeTab, setActiveTab] = useState("overview");

  // Overview: lightweight call with tag=latest (eager load)
  const { data: latestData, isLoading: isLatestLoading } = useDatasetLatest(bucket, name);

  const isCollection = latestData?.type === DatasetType.COLLECTION;
  const tabs = useMemo(() => (isCollection ? COLLECTION_TABS : DATASET_TABS), [isCollection]);

  // Versions: full call with all versions (lazy — only when tab is active)
  // Not needed for collections since latestData already has all members.
  const { data: fullData, isLoading: isFullLoading } = useDataset(bucket, name, {
    enabled: !isCollection && activeTab === "versions",
  });

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <PanelTabs
        tabs={tabs}
        value={activeTab}
        onValueChange={setActiveTab}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-900">
        {/* Overview tab */}
        <TabPanel
          tab="overview"
          activeTab={activeTab}
          padding="standard"
        >
          {isLatestLoading && <LoadingSkeleton />}
          {latestData && <DatasetPanelDetails dataset={latestData.dataset} />}
        </TabPanel>

        {/* Versions tab — datasets only */}
        <TabPanel
          tab="versions"
          activeTab={activeTab}
          padding="standard"
        >
          {isFullLoading && <LoadingSkeleton />}
          {fullData?.type === DatasetType.DATASET && (
            <DatasetPanelVersions
              versions={fullData.versions}
              currentVersion={fullData.dataset.version}
            />
          )}
        </TabPanel>

        {/* Members tab — collections only */}
        <TabPanel
          tab="members"
          activeTab={activeTab}
          padding="standard"
        >
          {isLatestLoading && <LoadingSkeleton />}
          {latestData?.type === DatasetType.COLLECTION && <CollectionPanelMembers members={latestData.members} />}
        </TabPanel>
      </div>
    </div>
  );
}
