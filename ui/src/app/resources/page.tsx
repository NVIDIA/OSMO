//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { z } from "zod";

import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { SlideOut } from "~/components/SlideOut";
import { RESOURCE_PINNED_KEY, SHOW_USED_KEY } from "~/components/StoreProvider";
import { ViewToggleButton } from "~/components/ViewToggleButton";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { convertFields, ResourcesEntrySchema, roundResources } from "~/models";
import { api } from "~/trpc/react";

import { AggregatePanels, type AggregateProps } from "./components/AggregatePanels";
import { ResourceDetails, type ResourceListItem } from "./components/ResourceDetails";
import { ResourcesFilter } from "./components/ResourcesFilter";
import { ResourcesTable } from "./components/ResourcesTable";
import useToolParamUpdater from "./hooks/useToolParamUpdater";
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
  const headerRef = useRef<HTMLDivElement>(null);
  const [resourcesPinned, setResourcesPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Initialize localStorage values after component mounts
  useEffect(() => {
    try {
      const storedResourcesPinned = localStorage.getItem(RESOURCE_PINNED_KEY);
      if (storedResourcesPinned !== null) {
        setResourcesPinned(storedResourcesPinned === "true");
      }
    } catch (error) {
      // localStorage might not be available in some environments
      console.warn("localStorage not available:", error);
    }
  }, []);

  const gridClass = useMemo(() => {
    if (showGauges && selectedResource && resourcesPinned) {
      return "grid grid-cols-[auto_1fr_auto]";
    } else if (showGauges) {
      return "grid grid-cols-[auto_1fr]";
    } else if (resourcesPinned && selectedResource) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [showGauges, selectedResource, resourcesPinned]);

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
      <div
        className="page-header mb-3"
        ref={headerRef}
      >
        <div className="flex items-center gap-8">
          <button
            className={`btn ${showGauges ? "btn-primary" : ""}`}
            aria-pressed={showGauges}
            onClick={() => updateUrl({ showGauges: !showGauges })}
          >
            <OutlinedIcon name="speed" />
            Gauges
            <FilledIcon name="more_vert" />
          </button>
          <h1>Resources</h1>
        </div>
        <div className="flex items-center gap-3">
          <fieldset
            className="flex flex-row gap-3"
            aria-label="View Type"
          >
            <ViewToggleButton
              name="isShowingUsed"
              checked={isShowingUsed}
              onChange={() => {
                updateUrl({ isShowingUsed: true });
                localStorage.setItem(SHOW_USED_KEY, "true");
              }}
            >
              Used
            </ViewToggleButton>
            <ViewToggleButton
              name="isShowingUsed"
              checked={!isShowingUsed}
              onChange={() => {
                updateUrl({ isShowingUsed: false });
                localStorage.setItem(SHOW_USED_KEY, "false");
              }}
            >
              Free
            </ViewToggleButton>
          </fieldset>
          <button
            className={`btn ${showFilters ? "btn-primary" : ""}`}
            onClick={() => {
              setShowFilters(true);
            }}
          >
            <FilledIcon name="filter_list" />
            Filters {filterCount > 0 ? `(${filterCount})` : ""}
          </button>
        </div>
        <SlideOut
          top={headerRef.current?.offsetHeight ?? 0}
          containerRef={headerRef}
          id="resources-filter"
          open={showFilters}
          onClose={() => {
            setShowFilters(false);
          }}
          aria-label="Resources Filter"
          dimBackground={false}
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
      </div>
      <div
        ref={containerRef}
        className={`${gridClass} h-full w-full overflow-x-auto relative px-3 gap-3`}
      >
        {showGauges && (
          <div
            className="h-full w-40 2xl:w-50 3xl:w-80 4xl:w-100 flex flex-col relative overflow-y-auto overflow-x-hidden body-component"
            style={{
              maxHeight: `calc(100vh - ${10 + (containerRef?.current?.getBoundingClientRect()?.top ?? 0)}px)`,
            }}
          >
            <div className={`popup-header sticky top-0 z-10 brand-header`}>
              <h2>Gauges</h2>
              <button
                className="btn btn-action"
                aria-label="Close"
                onClick={() => {
                  updateUrl({ showGauges: false });
                }}
              >
                <OutlinedIcon name="close" />
              </button>
            </div>
            <AggregatePanels
              {...aggregates}
              isLoading={isFetching}
              isShowingUsed={isShowingUsed}
            />
          </div>
        )}
        <div className="h-full w-full">
          <ResourcesTable
            isLoading={isFetching}
            resources={processResources}
            isShowingUsed={isShowingUsed}
            setAggregates={setAggregates}
            nodes={nodes}
            allNodes={isSelectAllNodesChecked}
            filterResourceTypes={filterResourceTypes}
            selectedResource={selectedResource}
            updateUrl={updateUrl}
          />
        </div>
        <SlideOut
          canPin={true}
          pinned={resourcesPinned}
          containerRef={containerRef}
          heightOffset={10}
          id="selected-resource"
          header={selectedResource?.node ?? ""}
          position="right"
          bodyClassName="p-0 h-full"
          headerClassName="brand-header"
          className="workflow-details-slideout"
          open={!!selectedResource}
          onClose={() => {
            updateUrl({ selectedResource: null });
          }}
          onPinChange={(pinned) => {
            setResourcesPinned(pinned);
            localStorage.setItem(RESOURCE_PINNED_KEY, pinned.toString());
          }}
        >
          {selectedResource && (
            <ResourceDetails
              node={selectedResource.node}
              defaultPool={selectedResource.pool}
              defaultPlatform={selectedResource.platform}
              narrowView={true}
            >
              <InlineBanner
                status="info"
                className="sticky top-0"
              >
                <p>
                  See{" "}
                  <Link
                    href={`/tasks?allUsers=true&allPools=true&nodes=${selectedResource.node}&allNodes=false&allStatuses=true`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-inline"
                  >
                    Task History
                  </Link>{" "}
                  on this node
                </p>
              </InlineBanner>
            </ResourceDetails>
          )}
        </SlideOut>
      </div>
    </>
  );
}
