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
import { useEffect, useMemo, useState } from "react";

import { type ToolParamUpdaterProps } from "~/app/resources/hooks/useToolParamUpdater";
import { OutlinedIcon } from "~/components/Icon";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { Spinner } from "~/components/Spinner";
import { PoolsListResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { initNodes, type PoolNodes } from "../../tasks/components/TasksFilters";

export const ResourceType = {
  SHARED: "SHARED",
  RESERVED: "RESERVED",
} as const;

export const ResourcesFilter = ({
  isSelectAllPoolsChecked,
  selectedPools,
  isSelectAllNodesChecked,
  availableNodes,
  resourceTypes,
  nodes,
  updateUrl,
  onRefresh,
}: {
  isSelectAllPoolsChecked: boolean;
  selectedPools: string;
  isSelectAllNodesChecked: boolean;
  availableNodes: PoolNodes[];
  nodes: string;
  resourceTypes?: string;
  updateUrl: (props: ToolParamUpdaterProps) => void;
  onRefresh: () => void;
}) => {
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());
  const [resourceTypeFilter, setResourceTypeFilter] = useState(resourceTypes);
  const [localAllPools, setLocalAllPools] = useState<boolean>(isSelectAllPoolsChecked);
  const [localNodes, setLocalNodes] = useState<Map<string, boolean>>(new Map());
  const [localAllNodes, setLocalAllNodes] = useState<boolean>(isSelectAllNodesChecked);

  const { data: availablePools, isLoading: isLoadingPools } = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: !localAllPools,
  });

  useEffect(() => {
    setLocalAllPools(isSelectAllPoolsChecked);
    setLocalAllNodes(isSelectAllNodesChecked);
    setResourceTypeFilter(resourceTypes);
  }, [isSelectAllPoolsChecked, isSelectAllNodesChecked, resourceTypes]);

  const poolNodes = useMemo(() => {
    if (localAllPools) {
      return availableNodes.flatMap(({ hostname }) => hostname);
    }

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([pool]) => pool);

    // Return all hostnames for every match against selected pool(s)
    return availableNodes.filter(({ pool }) => pool && pools.includes(pool)).flatMap(({ hostname }) => hostname);
  }, [availableNodes, localPools, localAllPools]);

  useEffect(() => {
    if (!poolNodes) {
      return;
    }

    setLocalNodes(initNodes(nodes, poolNodes));
  }, [poolNodes, nodes]);

  useEffect(() => {
    const parsedData = PoolsListResponseSchema.safeParse(availablePools);
    const parsedAvailablePools = parsedData.success ? parsedData.data.pools : [];
    const filters = new Map<string, boolean>(Object.keys(parsedAvailablePools).map((pool) => [pool, false]));

    if (!parsedData.success) {
      console.error(parsedData.error);
    }

    if (selectedPools.length) {
      selectedPools.split(",").forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [availablePools, selectedPools]);

  const handleSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name)
      .join(",");

    const nodes = Array.from(localNodes.entries())
      .filter(([_, enabled]) => enabled)
      .map(([node]) => node)
      .join(",");

    updateUrl({
      nodes,
      allNodes: localAllNodes,
      resourceType: resourceTypeFilter ?? null,
      pools,
      allPools: localAllPools,
    });

    onRefresh();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3 p-3">
        <fieldset className="flex flex-col gap-1">
          <legend>Resource Type</legend>
          <div className="flex flex-row gap-7">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="resourceType"
                value=""
                checked={!resourceTypeFilter}
                onChange={() => setResourceTypeFilter(undefined)}
              />
              All
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="resourceType"
                value={ResourceType.RESERVED}
                checked={resourceTypeFilter === ResourceType.RESERVED}
                onChange={() => setResourceTypeFilter(ResourceType.RESERVED)}
              />
              RESERVED
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="resourceType"
                value={ResourceType.SHARED}
                checked={resourceTypeFilter === ResourceType.SHARED}
                onChange={() => setResourceTypeFilter(ResourceType.SHARED)}
              />
              SHARED
            </label>
          </div>
        </fieldset>
        <MultiselectWithAll
          id="pools"
          label="All Pools"
          placeholder="Filter by pool name..."
          aria-label="Filter by pool name"
          filter={localPools}
          setFilter={(pools) => {
            setLocalPools(pools);
          }}
          onSelectAll={setLocalAllPools}
          isSelectAllChecked={localAllPools}
          showAll={true}
        />
        {isLoadingPools && !localAllPools && <Spinner size="small" />}
        <MultiselectWithAll
          id="nodes"
          label="All Nodes"
          placeholder="Filter by node name..."
          aria-label="Filter by node name"
          filter={localNodes}
          setFilter={setLocalNodes}
          onSelectAll={setLocalAllNodes}
          isSelectAllChecked={localAllNodes}
        />
      </div>
      <div className="flex flex-row gap-3 justify-between body-footer p-3">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setResourceTypeFilter(undefined);
            setLocalNodes(new Map());
            setLocalPools(new Map(Array.from(localPools.keys()).map((key) => [key, false])));
            setLocalAllPools(true);
            setLocalAllNodes(true);
            updateUrl({
              nodes: "",
              allNodes: true,
              resourceType: null,
              pools: "",
              allPools: true,
            });
          }}
        >
          <OutlinedIcon name="undo" />
          Reset
        </button>
        <button
          type="submit"
          className="btn btn-primary"
        >
          <OutlinedIcon name="refresh" />
          Refresh
        </button>
      </div>
    </form>
  );
};
