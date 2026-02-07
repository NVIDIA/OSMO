//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { FilterButton } from "~/components/FilterButton";
import FullPageModal from "~/components/FullPageModal";
import { FilledIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import { TaskHistoryBanner } from "~/components/TaskHistoryBanner";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { api } from "~/trpc/react";

import { AggregatePanels, type AggregateProps } from "./components/AggregatePanels";
import { ResourceDetails } from "./components/ResourceDetails";
import { ResourcesFilter } from "./components/ResourcesFilter";
import { ResourcesTable } from "./components/ResourcesTable";
import { calcAggregateTotals, calcResourceUsages } from "./components/utils";
import useToolParamUpdater from "./hooks/useToolParamUpdater";
import { UsedFreeToggle } from "../pools/components/UsedFreeToggle";
import { resourcesToNodes } from "../tasks/components/TasksFilters";

export default function Resources() {
  const {
    updateUrl,
    isSelectAllPoolsChecked,
    isSelectAllNodesChecked,
    selectedPools,
    nodes,
    filterCount,
    filterResourceTypes,
    isShowingUsed,
    showGauges,
    selectedResource,
  } = useToolParamUpdater();
  const [showFilters, setShowFilters] = useState(false);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const { setSafeTimeout } = useSafeTimeout();

  const [aggregates, setAggregates] = useState<AggregateProps>({
    cpu: { allocatable: 0, usage: 0 },
    gpu: { allocatable: 0, usage: 0 },
    storage: { allocatable: 0, usage: 0 },
    memory: { allocatable: 0, usage: 0 },
  });

  const {
    data: resources,
    isFetching,
    isSuccess,
    refetch,
  } = api.resources.listResources.useQuery(
    {
      all_pools: isSelectAllPoolsChecked,
      pools: isSelectAllPoolsChecked ? [] : selectedPools.split(","),
    },
    {
      refetchOnWindowFocus: false,
      onSuccess: () => {
        lastFetchTimeRef.current = Date.now();
      },
    },
  );

  const availableNodes = useMemo(() => {
    return resources ? resourcesToNodes(resources) : undefined;
  }, [resources]);

  const gridClass = useMemo(() => {
    if (showGauges) {
      return "grid grid-cols-[auto_1fr]";
    } else {
      return "flex flex-row";
    }
  }, [showGauges]);

  const processResources = useMemo(() => {
    if (!isSuccess) {
      return [];
    }

    return calcResourceUsages(resources);
  }, [resources, isSuccess]);

  const filteredResources = useMemo(() => {
    return processResources.filter((item) =>
      isSelectAllPoolsChecked ? true : selectedPools.split(",").includes(item.pool),
    );
  }, [processResources, isSelectAllPoolsChecked, selectedPools]);

  const forceRefetch = useCallback(() => {
    // Wait to see if the refresh has already happened. If not call it explicitly
    const lastFetchTime = lastFetchTimeRef.current;

    setSafeTimeout(() => {
      if (!isFetching && lastFetchTimeRef.current === lastFetchTime) {
        void refetch();
      }
    }, 500);
  }, [isFetching, refetch, setSafeTimeout]);

  return (
    <>
      <PageHeader>
        <IconButton
          id="gauges-button"
          className={`btn ${showGauges ? "btn-primary" : ""}`}
          aria-pressed={showGauges}
          onClick={() => updateUrl({ showGauges: !showGauges })}
          icon="speed"
          text="Gauges"
        />
        <UsedFreeToggle
          isShowingUsed={isShowingUsed}
          updateUrl={updateUrl}
        />
        <FilterButton
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterCount={filterCount}
          aria-controls="resources-filters"
        />
      </PageHeader>
      {isFetching ? (
        <div className="h-full w-full flex justify-center items-center">
          <Spinner size="large" />
        </div>
      ) : (
        <div className={`${gridClass} h-full w-full overflow-x-auto relative`}>
          <SlideOut
            id="resources-filter"
            open={showFilters}
            onClose={() => {
              setShowFilters(false);
            }}
            aria-label="Resources Filter"
            className="z-40 filter-slideout"
          >
            <ResourcesFilter
              selectedPools={selectedPools}
              isSelectAllPoolsChecked={isSelectAllPoolsChecked}
              isSelectAllNodesChecked={isSelectAllNodesChecked}
              availableNodes={availableNodes ?? []}
              nodes={nodes ?? ""}
              resourceTypes={filterResourceTypes}
              updateUrl={updateUrl}
              onRefresh={forceRefetch}
            />
          </SlideOut>
          {showGauges && (
            <section
              className="h-full w-40 2xl:w-50 3xl:w-80 4xl:w-100 flex flex-col relative overflow-y-auto overflow-x-hidden body-component"
            >
              <AggregatePanels
                cpu={aggregates.cpu}
                memory={aggregates.memory}
                gpu={aggregates.gpu}
                storage={aggregates.storage}
                isLoading={isFetching}
                isShowingUsed={isShowingUsed}
              />
            </section>
          )}
          <ResourcesTable
            setAggregates={setAggregates}
            isLoading={isFetching}
            resources={filteredResources}
            isShowingUsed={isShowingUsed}
            nodes={nodes}
            allNodes={isSelectAllNodesChecked}
            filterResourceTypes={filterResourceTypes}
            selectedResource={selectedResource}
            updateUrl={updateUrl}
          />
        </div>
      )}
      <FullPageModal
        headerChildren={
          selectedResource?.node && (
            <Link
              id="workflow-details-header"
              className="btn btn-action"
              href={`/resources/${selectedResource.node}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${selectedResource.node} - Open in new tab`}
            >
              <span className="font-semibold">{selectedResource.node}</span>
              <FilledIcon name="open_in_new" />
            </Link>
          )
        }
        aria-label={selectedResource?.node ?? "Node Details"}
        open={!!selectedResource}
        onClose={() => {
          updateUrl({ selectedResource: null });
        }}
      >
        {selectedResource && (
          <ResourceDetails
            node={selectedResource.node}
            defaultPool={selectedResource.pool}
            defaultPlatform={selectedResource.platform}
          >
            <TaskHistoryBanner nodeName={selectedResource.node} />
          </ResourceDetails>
        )}
      </FullPageModal>
    </>
  );
}
