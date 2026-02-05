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

import { customDateRange, DateRangePicker } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { PoolsFilter } from "~/components/PoolsFilter";
import { Spinner } from "~/components/Spinner";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilter, UserFilterType } from "~/components/UserFilter";
import { type PriorityType, type ResourcesEntry, type TaskStatusType } from "~/models";
import { api } from "~/trpc/react";

import { getMapFromStatusArray, getTaskStatusArray, StatusFilter } from "./StatusFilter";

export const validateFilters = ({
  isSelectAllPoolsChecked,
  selectedPools,
  dateRange,
  startedAfter,
  startedBefore,
  statusFilterType,
  statuses,
  nodes,
  isSelectAllNodesChecked,
}: TasksFiltersDataProps): string[] => {
  const errors: string[] = [];
  if (!isSelectAllPoolsChecked && selectedPools.length === 0) {
    errors.push("Please select at least one pool");
  }
  if (dateRange === customDateRange && (startedAfter === undefined || startedBefore === undefined)) {
    errors.push("Please select a date range");
  }
  if (statusFilterType === StatusFilterType.CUSTOM && !statuses?.length) {
    errors.push("Please select at least one status");
  }
  if (!isSelectAllNodesChecked && nodes.length === 0) {
    errors.push("Please select at least one node");
  }
  return errors;
};

export interface TasksFiltersDataProps {
  userType: UserFilterType;
  selectedUsers: string;
  dateRange: number;
  startedAfter?: string;
  startedBefore?: string;
  statusFilterType?: StatusFilterType;
  statuses?: string;
  selectedPools: string;
  isSelectAllPoolsChecked: boolean;
  priority?: PriorityType;
  workflowId: string;
  nodes: string;
  isSelectAllNodesChecked: boolean;
}

interface TasksFiltersProps extends TasksFiltersDataProps {
  currentUserName: string;
  onSave: (params: TasksFiltersDataProps) => void;
  onReset?: () => void;
  onDelete?: () => void;
  fields?: Fields[];
  saveButtonText?: string;
  saveButtonIcon?: string;
}

export type Fields = "user" | "date" | "status" | "pool" | "node" | "priority" | "workflow";

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
  userType,
  selectedUsers,
  dateRange,
  startedAfter,
  startedBefore,
  statusFilterType,
  statuses,
  selectedPools,
  isSelectAllPoolsChecked,
  priority,
  currentUserName,
  workflowId,
  onSave,
  onReset,
  onDelete,
  saveButtonText = "Refresh",
  saveButtonIcon = "refresh",
  fields = ["user", "date", "status", "pool", "node", "priority", "node", "workflow"],
  nodes,
  isSelectAllNodesChecked,
}: TasksFiltersProps) => {
  const [localDateRange, setLocalDateRange] = useState(dateRange);
  const [localStartedAfter, setLocalStartedAfter] = useState<string | undefined>(undefined);
  const [localStartedBefore, setLocalStartedBefore] = useState<string | undefined>(undefined);
  const [localStatusMap, setLocalStatusMap] = useState<Map<TaskStatusType, boolean>>(new Map());
  const [localPools, setLocalPools] = useState(selectedPools);
  const [localUsers, setLocalUsers] = useState<string>(selectedUsers);
  const [localUserType, setLocalUserType] = useState<UserFilterType>(userType);
  const [localAllPools, setLocalAllPools] = useState<boolean>(isSelectAllPoolsChecked);
  const [localWorkflowId, setLocalWorkflowId] = useState<string>(workflowId);
  const [errors, setErrors] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<PriorityType | undefined>(priority);
  const [localNodes, setLocalNodes] = useState<Map<string, boolean>>(new Map());
  const [localAllNodes, setLocalAllNodes] = useState<boolean>(isSelectAllNodesChecked);
  const [localStatusFilterType, setLocalStatusFilterType] = useState<StatusFilterType | undefined>(statusFilterType);

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
    setLocalPools(selectedPools);
  }, [selectedPools]);

  useEffect(() => {
    setLocalUserType(userType);
  }, [userType]);

  useEffect(() => {
    setLocalStatusFilterType(statusFilterType);

    if (statusFilterType === StatusFilterType.CUSTOM) {
      const statusArray = statuses?.split(",") ?? [];
      setLocalStatusMap(getMapFromStatusArray(statusArray));
    } else {
      setLocalStatusMap(getMapFromStatusArray(getTaskStatusArray(statusFilterType)));
    }
  }, [statuses, statusFilterType]);

  const poolNodes = useMemo(() => {
    if (localAllPools) {
      return availableNodes?.flatMap(({ hostname }) => hostname);
    }

    const pools = localPools.split(",");

    // Return all hostnames for every match against selected pool(s)
    return availableNodes?.filter(({ pool }) => pool && pools.includes(pool)).flatMap(({ hostname }) => hostname);
  }, [availableNodes, localPools, localAllPools]);

  useEffect(() => {
    setLocalDateRange(dateRange);
    setLocalStartedAfter(startedAfter);
    setLocalStartedBefore(startedBefore);
    setLocalWorkflowId(workflowId);
  }, [dateRange, startedAfter, startedBefore, workflowId]);

  useEffect(() => {
    if (!poolNodes) {
      return;
    }

    setLocalNodes(initNodes(nodes, poolNodes));
  }, [poolNodes, nodes]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const statuses = getTaskStatusArray(localStatusFilterType, localStatusMap);
    const nodes = localAllNodes
      ? []
      : Array.from(localNodes.entries())
          .filter(([_, enabled]) => enabled)
          .map(([node]) => node);

    const formErrors = validateFilters({
      userType: localUserType,
      selectedUsers: localUsers,
      selectedPools: localPools,
      isSelectAllPoolsChecked: localAllPools,
      dateRange: localDateRange,
      startedAfter: localStartedAfter,
      startedBefore: localStartedBefore,
      workflowId: localWorkflowId,
      nodes: nodes.join(","),
      isSelectAllNodesChecked: localAllNodes,
      statusFilterType: localStatusFilterType,
      statuses: localStatusFilterType === StatusFilterType.CUSTOM ? statuses.join(",") : undefined,
    });

    setErrors(formErrors);

    if (formErrors.length > 0) {
      return;
    }

    onSave({
      userType: localUserType,
      selectedUsers: localUsers,
      selectedPools: localPools,
      isSelectAllPoolsChecked: localAllPools,
      dateRange: localDateRange,
      startedAfter: localStartedAfter,
      startedBefore: localStartedBefore,
      statusFilterType: localStatusFilterType,
      statuses: localStatusFilterType === StatusFilterType.CUSTOM ? statuses.join(",") : undefined,
      workflowId: localWorkflowId,
      nodes: nodes.join(","),
      isSelectAllNodesChecked: localAllNodes,
    });
  };

  const handleReset = () => {
    setLocalStatusFilterType(StatusFilterType.CURRENT);
    setLocalUserType(UserFilterType.CURRENT);
    setLocalUsers(currentUserName);
    setLocalAllPools(true);
    setLocalPools("");
    setErrors([]);
    setPriorityFilter(undefined);
    setLocalWorkflowId("");
    setLocalNodes(initNodes(nodes, poolNodes ?? []));
    setLocalAllNodes(true);

    onReset?.();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-global flex flex-col gap-global">
        {fields.includes("user") && (
          <UserFilter
            userType={localUserType}
            setUserType={setLocalUserType}
            selectedUsers={localUsers}
            setSelectedUsers={setLocalUsers}
            currentUserName={currentUserName}
          />
        )}
        {fields.includes("priority") && (
          <fieldset className="flex flex-col gap-1 mb-2">
            <legend>Priority</legend>
            <div className="flex flex-row gap-radios">
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
        )}
        {fields.includes("workflow") && (
          <TextInput
            id="workflowId"
            label="Workflow ID"
            value={localWorkflowId ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLocalWorkflowId(e.target.value)}
            className="w-full"
          />
        )}
        {fields.includes("status") && (
          <StatusFilter
            statusFilterType={localStatusFilterType}
            setStatusFilterType={setLocalStatusFilterType}
            statusMap={localStatusMap}
            setStatusMap={setLocalStatusMap}
          />
        )}
        {fields.includes("pool") && (
          <PoolsFilter
              isSelectAllPoolsChecked={localAllPools}
            selectedPools={localPools}
            setIsSelectAllPoolsChecked={setLocalAllPools}
            setSelectedPools={setLocalPools}
          />
        )}
        {fields.includes("node") && (
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
        )}
        {isLoadingNodes && !localAllNodes && <Spinner size="small" />}
        {fields.includes("date") && (
          <DateRangePicker
            selectedRange={localDateRange}
            setSelectedRange={setLocalDateRange}
            fromDate={localStartedAfter}
            setFromDate={setLocalStartedAfter}
            toDate={localStartedBefore}
            setToDate={setLocalStartedBefore}
            className="flex flex-col gap-global mt-2"
          />
        )}
      </div>
      <InlineBanner status={errors.length > 0 ? "error" : "none"}>
        <div className="flex flex-col">
          {errors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      </InlineBanner>
      <div className="flex flex-row gap-global justify-between body-footer p-global sticky bottom-0">
        {onReset && (
          <button
            type="button"
            className="btn"
            onClick={handleReset}
          >
            <OutlinedIcon name="undo" />
            Reset
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn"
            onClick={onDelete}
          >
            <OutlinedIcon name="delete" />
            Delete
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary"
        >
          <OutlinedIcon name={saveButtonIcon} />
          {saveButtonText}
        </button>
      </div>
    </form>
  );
};
