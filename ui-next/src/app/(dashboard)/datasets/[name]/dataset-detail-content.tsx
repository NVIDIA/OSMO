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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/shadcn/tabs";
import { DatasetDetailHeader } from "@/app/(dashboard)/datasets/[name]/components/DatasetDetailHeader";
import { OverviewTab } from "@/app/(dashboard)/datasets/[name]/components/tabs/OverviewTab";
import { useDatasetDetail } from "@/app/(dashboard)/datasets/[name]/hooks/use-dataset-detail";

interface Props {
  bucket: string;
  name: string;
}

export function DatasetDetailContent({ bucket, name }: Props) {
  const { dataset, error } = useDatasetDetail(bucket, name);

  // Tab state in URL
  const [activeTab, setActiveTab] = useQueryState("tab", {
    defaultValue: "overview",
    shallow: true,
    history: "replace",
  });

  // Set page title and breadcrumbs
  usePage({
    title: dataset ? dataset.name : name,
    breadcrumbs: [
      { label: "Datasets", href: "/datasets" },
      { label: name, href: null },
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
    <div className="flex flex-col gap-6 p-6">
      <DatasetDetailHeader dataset={dataset} />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">File Browser</TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          className="mt-6"
        >
          <OverviewTab dataset={dataset} />
        </TabsContent>

        <TabsContent
          value="files"
          className="mt-6"
        >
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">File Browser (Phase 5)</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
