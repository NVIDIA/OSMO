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
 * Dataset Detail Content (Client Component)
 *
 * Main client component for dataset detail page with tabs.
 * Manages tab state in URL for shareable deep links.
 */

"use client";

import { usePage } from "@/components/chrome/page-context";
import { useQueryState } from "nuqs";
import { Info, History, FolderTree } from "lucide-react";
import { PanelTabs, type PanelTab } from "@/components/panel/panel-tabs";
import { TabPanel } from "@/components/panel/tab-panel";
import { DatasetDetailHeader } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/DatasetDetailHeader";
import { OverviewTab } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/tabs/OverviewTab";
import { VersionsTable } from "@/app/(dashboard)/datasets/[bucket]/[name]/components/tabs/VersionsTable";
import { useDatasetDetail } from "@/app/(dashboard)/datasets/[bucket]/[name]/hooks/use-dataset-detail";
import { useMemo, useCallback } from "react";

interface Props {
  bucket: string;
  name: string;
}

export function DatasetDetailContent({ bucket, name }: Props) {
  const { dataset, versions, error } = useDatasetDetail(bucket, name);

  // Tab state in URL (deep-linkable)
  const [activeTab, setActiveTab] = useQueryState("tab", {
    defaultValue: "overview",
    shallow: true,
    history: "replace",
  });

  // Tab configuration matching workflows pattern
  const tabs = useMemo<PanelTab[]>(
    () => [
      { id: "overview", label: "Overview", icon: Info },
      { id: "versions", label: "Versions", icon: History },
      { id: "files", label: "File Browser", icon: FolderTree },
    ],
    [],
  );

  // Handle tab change
  const handleTabChange = useCallback(
    (value: string) => {
      setActiveTab(value);
    },
    [setActiveTab],
  );

  // Set page title and breadcrumbs with bucket filter link
  usePage({
    title: dataset ? `${bucket} / ${dataset.name}` : `${bucket} / ${name}`,
    breadcrumbs: [
      { label: "Datasets", href: "/datasets" },
      { label: bucket, href: `/datasets?f=bucket:${encodeURIComponent(bucket)}` },
    ],
  });

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Error loading dataset</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return null; // Loading state handled by skeleton
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 p-6">
        <DatasetDetailHeader dataset={dataset} />
      </div>

      {/* Tab Navigation - Chrome-style tabs matching workflows */}
      <PanelTabs
        tabs={tabs}
        value={activeTab}
        onValueChange={handleTabChange}
      />

      {/* Tab Content */}
      <div className="relative flex-1 overflow-hidden bg-white dark:bg-zinc-900">
        <TabPanel
          tab="overview"
          activeTab={activeTab}
          padding="with-bottom"
        >
          <OverviewTab dataset={dataset} />
        </TabPanel>

        <TabPanel
          tab="versions"
          activeTab={activeTab}
          padding="with-bottom"
        >
          <VersionsTable
            versions={versions}
            currentVersion={dataset.version}
          />
        </TabPanel>

        <TabPanel
          tab="files"
          activeTab={activeTab}
          centered
          className="p-4"
        >
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Coming Soon</p>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">File browser for exploring dataset contents</p>
          </div>
        </TabPanel>
      </div>
    </div>
  );
}
