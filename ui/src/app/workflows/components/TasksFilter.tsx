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
import { useEffect, useState, type ChangeEvent } from "react";

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { StatusFilter } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { type TaskStatusType, TaskStatusValues } from "~/models";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export interface TasksFiltersDataProps {
  name: string;
  nodes: string;
  allNodes: boolean;
  allStatuses: boolean;
  statuses: string;
  pod_ip: string;
}

interface TasksFiltersProps extends TasksFiltersDataProps {
  updateUrl: (params: ToolParamUpdaterProps) => void;
  validateFilters: (props: TasksFiltersDataProps) => string[];
  availableNodes: string[];
}

export const TasksFilter = ({
  name,
  allStatuses,
  statuses,
  nodes,
  allNodes,
  pod_ip,
  availableNodes,
  updateUrl,
  validateFilters,
}: TasksFiltersProps) => {
  const [localAllStatuses, setLocalAllStatuses] = useState(allStatuses);
  const [localStatusMap, setLocalStatusMap] = useState<Map<TaskStatusType, boolean>>(new Map());
  const [taskNameFilter, setTaskNameFilter] = useState<string>(name);
  const [localNodes, setLocalNodes] = useState<Map<string, boolean>>(new Map());
  const [localAllNodes, setLocalAllNodes] = useState<boolean>(allNodes);
  const [podIpFilter, setPodIpFilter] = useState<string>(pod_ip);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const statusArray = statuses.split(",");

    setLocalStatusMap(
      new Map(TaskStatusValues.map((value) => [value, allStatuses || statusArray.includes(value.toString())])),
    );
  }, [name, statuses, allStatuses]);

  useEffect(() => {
    const filters = new Map<string, boolean>(availableNodes.map((node) => [node, false]));

    if (nodes) {
      const selectedNodes = nodes.split(",");

      selectedNodes.forEach((node) => {
        filters.set(node, true);
      });
    }

    setLocalNodes(filters);
  }, [availableNodes, nodes]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const statuses = Array.from(localStatusMap.entries())
      .filter(([_, enabled]) => enabled)
      .map(([status]) => status);

    const nodes = Array.from(localNodes.entries())
      .filter(([_, enabled]) => enabled)
      .map(([node]) => node);

    const formErrors = validateFilters({
      name: taskNameFilter,
      nodes: nodes.join(","),
      allNodes: localAllNodes,
      allStatuses: localAllStatuses,
      statuses: statuses.join(","),
      pod_ip: podIpFilter,
    });

    setErrors(formErrors);

    if (formErrors.length > 0) {
      return;
    }

    updateUrl({
      filterName: taskNameFilter.length > 0 ? taskNameFilter : null,
      allNodes: localAllNodes,
      nodes: nodes.length > 0 ? nodes.join(",") : undefined,
      allStatuses: localAllStatuses,
      status: localAllStatuses ? undefined : statuses.join(","),
      pod_ip: podIpFilter.length > 0 ? podIpFilter : null,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3">
        <TextInput
          id="taskSearch"
          label="Task Name"
          type="search"
          className="w-full h-8 w-min-250"
          containerClassName="mx-3 mt-3"
          aria-label="Filter by task name..."
          placeholder="Filter by task name..."
          value={taskNameFilter}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setTaskNameFilter(event.target.value);
          }}
          slotLeft={<OutlinedIcon name="search" />}
          autoComplete="off"
        />
        <div className="px-3">
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
        <TextInput
          id="podIp"
          label="Pod IP"
          type="search"
          className="w-full h-8 w-min-250"
          containerClassName="mx-3 mt-3"
          aria-label="Filter by pod IP..."
          placeholder="Filter by pod IP..."
          value={podIpFilter}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setPodIpFilter(event.target.value);
          }}
          slotLeft={<OutlinedIcon name="search" />}
          autoComplete="off"
        />
        <div className="p-3">
          <StatusFilter
            statusMap={localStatusMap}
            setStatusMap={(statusMap) => {
              setLocalStatusMap(statusMap);
            }}
            allStatuses={localAllStatuses}
            setAllStatuses={(allStatuses) => {
              setLocalAllStatuses(allStatuses);
            }}
          />
        </div>
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
          onClick={() => {
            setTaskNameFilter("");
            setLocalNodes(new Map());
            setLocalAllNodes(true);
            setPodIpFilter("");
            setLocalStatusMap(new Map(TaskStatusValues.map((value) => [value, true])));
            setLocalAllStatuses(true);
            updateUrl({
              filterName: null,
              nodes: undefined,
              status: undefined,
              pod_ip: undefined,
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
