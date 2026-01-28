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
import { z } from "zod";

import { CheckboxWithLabel } from "~/components/Checkbox";
import { FilterButton } from "~/components/FilterButton";
import FullPageModal from "~/components/FullPageModal";
import { FilledIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import { TaskHistoryBanner } from "~/components/TaskHistoryBanner";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { convertFields, ResourcesEntrySchema, roundResources } from "~/models";
import { api } from "~/trpc/react";

import { type AggregateProps } from "./components/AggregatePanels";
import { ResourceDetails, type ResourceListItem } from "./components/ResourceDetails";
import { ResourceGraph } from "./components/ResourceGraph";
import { ResourcesFilter } from "./components/ResourcesFilter";
import { ResourcesTable } from "./components/ResourcesTable";
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
    showDetails,
    selectedResource,
  } = useToolParamUpdater();
  const [showFilters, setShowFilters] = useState(false);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const { setSafeTimeout } = useSafeTimeout();

  const {
    data: resources,
    isFetching,
    isSuccess,
    refetch,
  } = api.resources.listResources.useQuery(
    {
      all_pools: true,
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
    if (showDetails) {
      return "grid grid-cols-[auto_1fr]";
    } else {
      return "flex flex-row";
    }
  }, [showDetails]);

  const processResources = useMemo((): ResourceListItem[] => {
    if (!isSuccess) {
      return [];
    }

    const parsedResponse = z.array(ResourcesEntrySchema).safeParse(resources);

    if (!parsedResponse.success) {
      console.error(parsedResponse.error);
      return [];
    }

    const result = parsedResponse.data.flatMap((resource) => {
      const poolPlatformMap = (resource.exposed_fields["pool/platform"] ?? []).reduce(
        (acc, poolPlatform) => {
          const [poolName, platformName] = poolPlatform.split("/");
          if (poolName && platformName) {
            acc[poolName] = [...(acc[poolName] ?? []), platformName];
          }
          return acc;
        },
        {} as Record<string, string[]>,
      );

      return Object.entries(poolPlatformMap).flatMap(([poolName, platforms]) =>
        platforms.map((platform) => {
          const item: ResourceListItem = {
            node: resource.exposed_fields.node ?? "-",
            pool: poolName,
            platform,
            storage: roundResources(convertFields("storage", resource, poolName, platform)),
            cpu: roundResources(convertFields("cpu", resource, poolName, platform)),
            memory: roundResources(convertFields("memory", resource, poolName, platform)),
            gpu: roundResources(convertFields("gpu", resource, poolName, platform)),
            resourceType: resource.resource_type ?? "-",
          };

          return item;
        }),
      );
    });
    return result;
  }, [resources, isSuccess]);

  const filteredResources = useMemo(() => {
    return processResources.filter((item) =>
      isSelectAllPoolsChecked ? true : selectedPools.split(",").includes(item.pool),
    );
  }, [processResources, isSelectAllPoolsChecked, selectedPools]);

  const aggregateTotals = useMemo<{
    byPool: Record<string, AggregateProps>;
    total: AggregateProps;
  }>(() => {
    const total: AggregateProps = {
      cpu: { allocatable: 0, usage: 0 },
      gpu: { allocatable: 0, usage: 0 },
      storage: { allocatable: 0, usage: 0 },
      memory: { allocatable: 0, usage: 0 },
    };
    const byPool: Record<string, AggregateProps> = {};
    const processedNodes = new Set<string>();

    processResources.forEach((item) => {
      if (processedNodes.has(item.node)) {
        return;
      }

      const poolKey = item.pool || "N/A";
      const poolTotals = byPool[poolKey] ?? {
        cpu: { allocatable: 0, usage: 0 },
        gpu: { allocatable: 0, usage: 0 },
        storage: { allocatable: 0, usage: 0 },
        memory: { allocatable: 0, usage: 0 },
      };

      poolTotals.cpu.allocatable += item.cpu.allocatable;
      poolTotals.cpu.usage += item.cpu.usage;
      poolTotals.gpu.allocatable += item.gpu.allocatable;
      poolTotals.gpu.usage += item.gpu.usage;
      poolTotals.storage.allocatable += item.storage.allocatable;
      poolTotals.storage.usage += item.storage.usage;
      poolTotals.memory.allocatable += item.memory.allocatable;
      poolTotals.memory.usage += item.memory.usage;

      byPool[poolKey] = poolTotals;

      total.cpu.allocatable += item.cpu.allocatable;
      total.cpu.usage += item.cpu.usage;
      total.gpu.allocatable += item.gpu.allocatable;
      total.gpu.usage += item.gpu.usage;
      total.storage.allocatable += item.storage.allocatable;
      total.storage.usage += item.storage.usage;
      total.memory.allocatable += item.memory.allocatable;
      total.memory.usage += item.memory.usage;

      processedNodes.add(item.node);
    });

    return { byPool, total };
  }, [processResources]);

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
          className={`btn ${showDetails ? "btn-primary" : ""}`}
          aria-pressed={showDetails}
          onClick={() => updateUrl({ showDetails: !showDetails })}
          icon="table_chart"
          text="Details"
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
            className="z-40 border-t-0 w-100"
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
          <section
            className={`h-full justify-center relative overflow-y-auto p-global gap-global ${showDetails ? "flex flex-col" : "flex flex-row flex-wrap w-full"}`}
            aria-labelledby="gauges-button"
          >
            <div className="card">
              <div className="body-header p-global">
                {showDetails ? (
                  <CheckboxWithLabel
                    checked={isSelectAllPoolsChecked}
                    onChange={() => updateUrl({ allPools: !isSelectAllPoolsChecked, pools: "" })}
                    label="Select All Pools"
                  />
                ) : (
                  <h2 className="text-base p-0 m-0">Total</h2>
                )}
              </div>
              <ResourceGraph
                {...aggregateTotals.total}
                isLoading={isFetching}
                isShowingUsed={isShowingUsed}
                width={200}
                height={150}
              />
            </div>
            {Object.entries(aggregateTotals.byPool)
              .sort(([poolA], [poolB]) => poolA.localeCompare(poolB))
              .map(([pool, totals]) => (
                <div
                  key={pool}
                  className="card"
                >
                  <div className="body-header p-global">
                    {showDetails ? (
                      <CheckboxWithLabel
                        checked={isSelectAllPoolsChecked ? true : selectedPools.split(",").includes(pool)}
                        onChange={() =>
                          updateUrl({
                            pools: selectedPools.split(",").includes(pool)
                              ? selectedPools
                                  .split(",")
                                  .filter((p) => p !== pool)
                                  .join(",")
                              : [...selectedPools, pool].join(","),
                            allPools: false,
                          })
                        }
                        id={pool}
                        label={pool}
                      />
                    ) : (
                      <h2 className="text-base p-0 m-0">{pool}</h2>
                    )}
                  </div>
                  <ResourceGraph
                    {...totals}
                    isLoading={isFetching}
                    isShowingUsed={isShowingUsed}
                    width={200}
                    height={150}
                  />
                </div>
              ))}
          </section>
          {showDetails && (
            <ResourcesTable
              isLoading={isFetching}
              resources={filteredResources}
              isShowingUsed={isShowingUsed}
              nodes={nodes}
              allNodes={isSelectAllNodesChecked}
              filterResourceTypes={filterResourceTypes}
              selectedResource={selectedResource}
              updateUrl={updateUrl}
            />
          )}
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
