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

import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { SlideOut } from "~/components/SlideOut";
import { POOL_PINNED_KEY, SHOW_USED_KEY, UrlTypes } from "~/components/StoreProvider";
import { ViewToggleButton } from "~/components/ViewToggleButton";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type PoolResourceUsage, PoolsQuotaResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { PoolDetails } from "./components/PoolDetails";
import { PoolsFilter } from "./components/PoolsFilter";
import { PoolsTable } from "./components/PoolsTable";
import useToolParamUpdater from "./hooks/useToolParamUpdater";
import { type PoolListItem, poolToPoolListItem } from "./models/PoolListitem";

export default function Pools() {
  const {
    updateUrl,
    isSelectAllPoolsChecked,
    selectedPools,
    filterCount,
    isShowingUsed,
    selectedPool,
    selectedPlatform,
  } = useToolParamUpdater(UrlTypes.Pools);
  const [showFilters, setShowFilters] = useState(false);
  const [showTotalResources, setShowTotalResources] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const [detailsPinned, setDetailsPinned] = useState(false);
  const { setSafeTimeout } = useSafeTimeout();

  const {
    data: nodeSets,
    isFetching,
    isSuccess,
    refetch,
  } = api.resources.getPoolsQuota.useQuery(
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

  const processPools = useMemo((): { pools: PoolListItem[]; totalResources?: PoolResourceUsage } => {
    if (!isSuccess) {
      return { pools: [], totalResources: undefined };
    }

    const parsedResponse = PoolsQuotaResponseSchema.safeParse(nodeSets);

    if (!parsedResponse.success) {
      console.error(parsedResponse.error);
      return { pools: [], totalResources: undefined };
    }

    return {
      pools: parsedResponse.data.node_sets.flatMap((nodeSet) => {
        // nodeSet.pools is an array of Pool objects
        const nodeSetPools = nodeSet.pools.map((pool) => pool.name);
        return nodeSet.pools.map((pool) => poolToPoolListItem(pool, nodeSetPools));
      }),
      totalResources: parsedResponse.data.resource_sum,
    };
  }, [nodeSets, isSuccess]);

  // Initialize localStorage values after component mounts
  useEffect(() => {
    try {
      const storedDetailsPinned = localStorage.getItem(POOL_PINNED_KEY);
      if (storedDetailsPinned !== null) {
        setDetailsPinned(storedDetailsPinned === "true");
      }
    } catch (error) {
      // localStorage might not be available in some environments
      console.warn("localStorage not available:", error);
    }
  }, []);

  const gridClass = useMemo(() => {
    if (detailsPinned && selectedPool) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [detailsPinned, selectedPool]);

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
        <h1>Pools</h1>
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
            className={`btn ${showTotalResources ? "btn-primary" : ""}`}
            onClick={() => {
              setShowTotalResources(!showTotalResources);
            }}
          >
            <OutlinedIcon name="memory" />
            Total {isShowingUsed ? "Used" : "Free"}
          </button>
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
          id="total-resources"
          open={showTotalResources}
          onClose={() => setShowTotalResources(false)}
          containerRef={headerRef}
          top={headerRef.current?.getBoundingClientRect().top ?? 0}
          header={<h2>Total Resources</h2>}
          dimBackground={false}
          className="mr-30 border-t-0"
        >
          <div className="h-full w-full p-3 dag-details-body">
            <dl className="grid-cols-2">
              {isShowingUsed ? (
                <>
                  <dt>Quota Used</dt>
                  <dd className="text-right">
                    {Intl.NumberFormat("en-US", { style: "decimal" }).format(
                      processPools.totalResources?.quota_used ?? 0,
                    )}
                  </dd>
                  <dt>Quota Limit</dt>
                  <dd className="text-right">
                    {Intl.NumberFormat("en-US", { style: "decimal" }).format(
                      processPools.totalResources?.quota_limit ?? 0,
                    )}
                  </dd>
                  <dt>Total Usage</dt>
                  <dd className="text-right">
                    {Intl.NumberFormat("en-US", { style: "decimal" }).format(
                      processPools.totalResources?.total_usage ?? 0,
                    )}
                  </dd>
                  <dt>Total Capacity</dt>
                  <dd className="text-right">
                    {Intl.NumberFormat("en-US", { style: "decimal" }).format(
                      processPools.totalResources?.total_capacity ?? 0,
                    )}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Quota Free</dt>
                  <dd className="text-right">
                    {Intl.NumberFormat("en-US", { style: "decimal" }).format(
                      processPools.totalResources?.quota_free ?? 0,
                    )}
                  </dd>
                  <dt>Total Free</dt>
                  <dd className="text-right">
                    {Intl.NumberFormat("en-US", { style: "decimal" }).format(
                      processPools.totalResources?.total_free ?? 0,
                    )}
                  </dd>
                </>
              )}
            </dl>
          </div>
        </SlideOut>
        <SlideOut
          top={headerRef.current?.offsetHeight ?? 0}
          containerRef={headerRef}
          id="resources-filter"
          open={showFilters}
          onClose={() => {
            setShowFilters(false);
          }}
          aria-label="Pools Filter"
          dimBackground={false}
          className="z-40 border-t-0 w-100"
        >
          <PoolsFilter
            selectedPools={selectedPools}
            isSelectAllPoolsChecked={isSelectAllPoolsChecked}
            updateUrl={updateUrl}
            onRefresh={forceRefetch}
          />
        </SlideOut>
      </div>
      <div
        ref={containerRef}
        className={`${gridClass} h-full w-full overflow-x-auto relative px-3 gap-3`}
      >
        <PoolsTable
          isLoading={isFetching}
          pools={processPools.pools}
          isShowingUsed={isShowingUsed}
          selectedPool={selectedPool}
          updateUrl={updateUrl}
        />
        <SlideOut
          header={selectedPool ? <h2>{selectedPool}</h2> : undefined}
          id="pools-details"
          open={!!selectedPool}
          paused={!!selectedPlatform}
          canPin={true}
          pinned={detailsPinned}
          containerRef={containerRef}
          heightOffset={10}
          position="right"
          bodyClassName="dag-details-body"
          headerClassName="brand-header"
          className="workflow-details-slideout"
          onPinChange={(pinned) => {
            setDetailsPinned(pinned);
            localStorage.setItem(POOL_PINNED_KEY, pinned.toString());
          }}
          onClose={() => {
            updateUrl({ selectedPool: null });
          }}
        >
          <PoolDetails
            pools={processPools.pools ?? []}
            selectedPool={selectedPool}
            selectedPlatform={selectedPlatform}
            onShowPlatformDetails={(platform) => updateUrl({ selectedPlatform: platform })}
            isShowingUsed={isShowingUsed}
          />
        </SlideOut>
      </div>
    </>
  );
}
