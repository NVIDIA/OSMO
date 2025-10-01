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

import { type ToolParamUpdaterProps } from "~/app/workflows/hooks/useToolParamUpdater";
import { customDateRange, DateRangePicker } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { Spinner } from "~/components/Spinner";
import { StatusFilter } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilter, UserFilterType } from "~/components/UserFilter";
import { PoolsListResponseSchema, type PriorityType, type ResourcesEntry } from "~/models";
import { api } from "~/trpc/react";

export interface TasksFiltersDataProps {
  userType: UserFilterType;
  selectedUsers: string;
  dateRange: number;
  startedAfter?: string;
  startedBefore?: string;
  allStatuses: boolean;
  statuses: string;
  selectedPools: string;
  isSelectAllPoolsChecked: boolean;
  priority?: PriorityType;
  workflowId: string;
  nodes: string;
  isSelectAllNodesChecked: boolean;
}

interface TasksFiltersProps extends TasksFiltersDataProps {
  statusValues: string[];
  currentUserName: string;
  onRefresh: () => void;
  validateFilters: (props: TasksFiltersDataProps) => string[];
  updateUrl: (params: ToolParamUpdaterProps) => void;
  defaults: Record<string, string | undefined>;
}

export const initNodes = (nodes: string, poolNodes: string[]) => {
  const map = new Map<string, boolean>(poolNodes.map((hostname) => [hostname, false]));

  if (nodes) {
    const selectedNodes = nodes.split(",");

    selectedNodes.forEach((node) => {
      map.set(node, true);
    });
  }

  return map;
};

export interface PoolNodes {
  hostname: string;
  pool?: string;
}

export const resourcesToNodes = (resources: ResourcesEntry[]): PoolNodes[] => {
  return resources.flatMap((resource: ResourcesEntry) => {
    const pools = resource.exposed_fields?.["pool/platform"] ?? [];
    return pools.map((pool: string) => ({
      hostname: resource.hostname,
      pool: pool.split("/")[0],
    }));
  });
};

export const TasksFilters = ({
  statusValues,
  userType,
  selectedUsers,
  dateRange,
  startedAfter,
  startedBefore,
  allStatuses,
  statuses,
  selectedPools,
  isSelectAllPoolsChecked,
  priority,
  currentUserName,
  onRefresh,
  validateFilters,
  workflowId,
  updateUrl,
  nodes,
  isSelectAllNodesChecked,
  defaults,
}: TasksFiltersProps) => {
  const [localDateRange, setLocalDateRange] = useState(dateRange);
  const [localStartedAfter, setLocalStartedAfter] = useState<string | undefined>(undefined);
  const [localStartedBefore, setLocalStartedBefore] = useState<string | undefined>(undefined);
  const [localStatusMap, setLocalStatusMap] = useState<Map<string, boolean>>(new Map());
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());
  const [localUsers, setLocalUsers] = useState<string>(selectedUsers);
  const [localUserType, setLocalUserType] = useState<UserFilterType>(userType);
  const [localAllPools, setLocalAllPools] = useState<boolean>(isSelectAllPoolsChecked);
  const [localWorkflowId, setLocalWorkflowId] = useState<string>(workflowId);
  const [errors, setErrors] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<PriorityType | undefined>(priority);
  const [localNodes, setLocalNodes] = useState<Map<string, boolean>>(new Map());
  const [localAllNodes, setLocalAllNodes] = useState<boolean>(isSelectAllNodesChecked);
  const [localAllStatuses, setLocalAllStatuses] = useState(allStatuses);

  const { data: availablePools, isLoading: isLoadingPools } = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: !localAllPools,
  });

  const { data: availableNodes, isLoading: isLoadingNodes } = api.resources.listResources.useQuery(
    {
      all_pools: true,
    },
    {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      enabled: !localAllNodes,
      select: (data) => resourcesToNodes(data),
    },
  );

  useEffect(() => {
    setLocalAllPools(isSelectAllPoolsChecked);
  }, [isSelectAllPoolsChecked]);

  useEffect(() => {
    setLocalUserType(userType);
  }, [userType]);

  const poolNodes = useMemo(() => {
    if (localAllPools) {
      return availableNodes?.flatMap(({ hostname }) => hostname);
    }

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([pool]) => pool);

    // Return all hostnames for every match against selected pool(s)
    return availableNodes?.filter(({ pool }) => pool && pools.includes(pool)).flatMap(({ hostname }) => hostname);
  }, [availableNodes, localPools, localAllPools]);

  useEffect(() => {
    setLocalDateRange(dateRange);
    setLocalStartedAfter(startedAfter);
    setLocalStartedBefore(startedBefore);
    setLocalWorkflowId(workflowId);

    setLocalStatusMap(
      new Map(statusValues.map((value: string) => [value, !statuses || statuses.split(",").includes(value)])),
    );
  }, [dateRange, startedAfter, startedBefore, statuses, workflowId, statusValues]);

  useEffect(() => {
    const parsedData = PoolsListResponseSchema.safeParse(availablePools);
    const parsedAvailablePools = parsedData.success ? parsedData.data.pools : [];
    const filters = new Map<string, boolean>(Object.keys(parsedAvailablePools).map((pool) => [pool, false]));

    if (selectedPools.length) {
      selectedPools.split(",").forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [availablePools, selectedPools]);

  useEffect(() => {
    if (!poolNodes) {
      return;
    }

    setLocalNodes(initNodes(nodes, poolNodes));
  }, [poolNodes, nodes]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const statuses = localAllStatuses
      ? []
      : Array.from(localStatusMap.entries())
          .filter(([_, enabled]) => enabled)
          .map(([status]) => status);

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([pool]) => pool);

    const nodes = localAllNodes
      ? []
      : Array.from(localNodes.entries())
          .filter(([_, enabled]) => enabled)
          .map(([node]) => node);

    const formErrors = validateFilters({
      userType: localUserType,
      selectedUsers: localUsers,
      selectedPools: pools.join(","),
      isSelectAllPoolsChecked: localAllPools,
      dateRange: localDateRange,
      startedAfter: localStartedAfter,
      startedBefore: localStartedBefore,
      workflowId: localWorkflowId,
      nodes: nodes.join(","),
      isSelectAllNodesChecked: localAllNodes,
      allStatuses: localAllStatuses,
      statuses: statuses.join(","),
    });

    setErrors(formErrors);

    if (formErrors.length > 0) {
      return;
    }

    updateUrl({
      dateRange: localDateRange,
      dateAfter: localDateRange === customDateRange ? localStartedAfter : null,
      dateBefore: localDateRange === customDateRange ? localStartedBefore : null,
      allStatuses: localAllStatuses,
      status: statuses.length > 0 ? statuses.join(",") : undefined,
      allPools: localAllPools,
      pools: localAllPools ? null : pools,
      allUsers: localUserType === UserFilterType.ALL,
      users: localUserType === UserFilterType.ALL ? null : localUsers.split(","),
      priority: priorityFilter ?? null,
      filterName: localWorkflowId ?? null,
      nodes: nodes.length > 0 ? nodes.join(",") : undefined,
      allNodes: localAllNodes,
    });

    onRefresh();
  };

  const handleReset = () => {
    setLocalAllStatuses(defaults.allStatuses ? defaults.allStatuses === "true" : true);

    if (defaults.status) {
      const statuses = defaults.status.split(",");
      setLocalStatusMap(new Map(statusValues.map((value) => [value, statuses.includes(value)])));
    } else {
      setLocalStatusMap(new Map(statusValues.map((value) => [value, true])));
    }

    setLocalUserType(UserFilterType.CURRENT);
    setLocalUsers(currentUserName);
    setLocalAllPools(true);
    setLocalPools(new Map(Array.from(localPools.keys(), (pool) => [pool, false])));
    setErrors([]);
    setPriorityFilter(undefined);
    setLocalWorkflowId("");
    setLocalNodes(initNodes(nodes, poolNodes ?? []));
    setLocalAllNodes(true);

    updateUrl({
      status: undefined,
      allStatuses: false,
      allPools: true,
      allUsers: false,
      users: [currentUserName],
      dateRange: null,
      dateAfter: null,
      dateBefore: null,
      priority: null,
      filterName: null,
      nodes: undefined,
      allNodes: true,
    });

    onRefresh();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="body-component p-3 flex flex-col gap-3">
        <UserFilter
          userType={localUserType}
          setUserType={setLocalUserType}
          selectedUsers={localUsers}
          setSelectedUsers={setLocalUsers}
          currentUserName={currentUserName}
        />
        <fieldset className="flex flex-col gap-1 mb-2">
          <legend>Priority</legend>
          <div className="flex flex-row gap-7">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value=""
                checked={priorityFilter === undefined}
                onChange={() => setPriorityFilter(undefined)}
              />
              All
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value={"HIGH"}
                checked={priorityFilter === "HIGH"}
                onChange={() => setPriorityFilter("HIGH")}
              />
              HIGH
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value={"NORMAL"}
                checked={priorityFilter === "NORMAL"}
                onChange={() => setPriorityFilter("NORMAL")}
              />
              NORMAL
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="priority"
                value={"LOW"}
                checked={priorityFilter === "LOW"}
                onChange={() => setPriorityFilter("LOW")}
              />
              LOW
            </label>
          </div>
        </fieldset>
        <TextInput
          id="workflowId"
          label="Workflow ID"
          value={localWorkflowId ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalWorkflowId(e.target.value)}
          className="w-full"
        />
        <StatusFilter
          statusMap={localStatusMap}
          setStatusMap={setLocalStatusMap}
          allStatuses={localAllStatuses}
          setAllStatuses={setLocalAllStatuses}
        />
        <MultiselectWithAll
          id="pools"
          label="All Pools"
          placeholder="Filter by pool name..."
          aria-label="Filter by pool name"
          filter={localPools}
          setFilter={setLocalPools}
          onSelectAll={setLocalAllPools}
          isSelectAllChecked={localAllPools}
          showAll
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
        {isLoadingNodes && !localAllNodes && <Spinner size="small" />}
        <DateRangePicker
          selectedRange={localDateRange}
          setSelectedRange={setLocalDateRange}
          fromDate={localStartedAfter}
          setFromDate={setLocalStartedAfter}
          toDate={localStartedBefore}
          setToDate={setLocalStartedBefore}
          className="flex flex-col gap-3 mt-2"
        />
        {errors.length > 0 && (
          <InlineBanner status="error">
            <div className="flex flex-col gap-2">
              {errors.map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          </InlineBanner>
        )}
      </div>
      <div className="flex flex-row gap-3 justify-between body-footer p-3 sticky bottom-0">
        <button
          type="button"
          className="btn"
          onClick={handleReset}
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
