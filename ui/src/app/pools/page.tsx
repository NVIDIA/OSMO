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

import { useCallback, useMemo, useRef, useState } from "react";

import { FilledIcon } from "~/components/Icon";
import { SlideOut } from "~/components/SlideOut";
import { UrlTypes } from "~/components/StoreProvider";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type PoolResourceUsage } from "~/models";
import { api } from "~/trpc/react";

import { AggregatePanels } from "./components/AggregatePanels";
import { PoolsFilter } from "./components/PoolsFilter";
import { PoolsTable } from "./components/PoolsTable";
import { UsedFreeToggle } from "./components/UsedFreeToggle";
import useToolParamUpdater from "./hooks/useToolParamUpdater";
import { type PoolListItem, processPoolsQuotaResponse } from "./models/PoolListitem";

export default function Pools() {
  const { updateUrl, isSelectAllPoolsChecked, selectedPools, filterCount, isShowingUsed } = useToolParamUpdater(
    UrlTypes.Pools,
  );
  const [showFilters, setShowFilters] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
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
    return processPoolsQuotaResponse(isSuccess, nodeSets);
  }, [nodeSets, isSuccess]);

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
          <UsedFreeToggle
            isShowingUsed={isShowingUsed}
            updateUrl={updateUrl}
          />
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
        className="h-full w-full px-3 gap-3 grid grid-cols-[auto_1fr]"
        ref={containerRef}
      >
        <div
          className="h-full w-40 2xl:w-50 3xl:w-80 4xl:w-100 flex flex-col relative overflow-y-auto overflow-x-hidden body-component"
          style={{
            maxHeight: `calc(100vh - ${10 + (containerRef?.current?.getBoundingClientRect()?.top ?? 0)}px)`,
          }}
        >
          <div className={`popup-header sticky top-0 z-10 brand-header`}>
            <h2>Gauges</h2>
          </div>
          <div className="flex flex-col gap-3 p-3 h-full justify-between">
            <AggregatePanels
              totals={processPools.totalResources}
              isLoading={isFetching}
              isShowingUsed={isShowingUsed}
            />
          </div>
        </div>
        <PoolsTable
          isLoading={isFetching}
          pools={processPools.pools}
          isShowingUsed={isShowingUsed}
        />
      </div>
    </>
  );
}
