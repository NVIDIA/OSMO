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
import { PoolsFilter } from "~/components/PoolsFilter";

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
  const [localPools, setLocalPools] = useState(selectedPools);
  const [localAllPools, setLocalAllPools] = useState(isSelectAllPoolsChecked);
  const [resourceTypeFilter, setResourceTypeFilter] = useState(resourceTypes);
  const [localNodes, setLocalNodes] = useState<Map<string, boolean>>(new Map());
  const [localAllNodes, setLocalAllNodes] = useState<boolean>(isSelectAllNodesChecked);

  useEffect(() => {
    setLocalAllPools(isSelectAllPoolsChecked);
    setLocalAllNodes(isSelectAllNodesChecked);
    setResourceTypeFilter(resourceTypes);
    setLocalPools(selectedPools);
  }, [isSelectAllPoolsChecked, isSelectAllNodesChecked, resourceTypes, selectedPools]);

  const poolNodes = useMemo(() => {
    if (localAllPools) {
      return availableNodes.flatMap(({ hostname }) => hostname);
    }

    const pools = localPools.split(",");

    // Return all hostnames for every match against selected pool(s)
    return availableNodes.filter(({ pool }) => pool && pools.includes(pool)).flatMap(({ hostname }) => hostname);
  }, [availableNodes, localPools, localAllPools]);

  useEffect(() => {
    if (!poolNodes) {
      return;
    }

    setLocalNodes(initNodes(nodes, poolNodes));
  }, [poolNodes, nodes]);

  const handleSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const nodes = Array.from(localNodes.entries())
      .filter(([_, enabled]) => enabled)
      .map(([node]) => node)
      .join(",");

    updateUrl({
      nodes,
      allNodes: localAllNodes,
      resourceType: resourceTypeFilter ?? null,
      pools: localPools,
      allPools: localAllPools,
    });

    onRefresh();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-global p-global">
        <fieldset className="flex flex-col gap-1">
          <legend>Resource Type</legend>
          <div className="flex flex-row gap-radios">
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
        <PoolsFilter
          isSelectAllPoolsChecked={localAllPools}
          setIsSelectAllPoolsChecked={setLocalAllPools}
          selectedPools={localPools}
          setSelectedPools={setLocalPools}
        />
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
      <div className="flex flex-row gap-global justify-between body-footer p-global">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setResourceTypeFilter(undefined);
            setLocalNodes(new Map());
            setLocalPools("");
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
