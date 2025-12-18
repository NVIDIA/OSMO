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

import { getTaskStatusArray, StatusFilter } from "~/app/tasks/components/StatusFilter";
import { getMapFromStatusArray } from "~/app/tasks/components/StatusFilter";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { type TaskStatusType, TaskStatusValues } from "~/models";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export interface TasksFiltersDataProps {
  name: string;
  nodes: string;
  allNodes: boolean;
  statusFilterType?: StatusFilterType;
  statuses?: string;
  pod_ip: string;
}

interface TasksFiltersProps extends TasksFiltersDataProps {
  updateUrl: (params: ToolParamUpdaterProps) => void;
  validateFilters: (props: TasksFiltersDataProps) => string[];
  availableNodes: string[];
}

export const TasksFilter = ({
  name,
  statusFilterType,
  statuses,
  nodes,
  allNodes,
  pod_ip,
  availableNodes,
  updateUrl,
  validateFilters,
}: TasksFiltersProps) => {
  const [localStatusMap, setLocalStatusMap] = useState<Map<TaskStatusType, boolean>>(new Map());
  const [localStatusFilterType, setLocalStatusFilterType] = useState<StatusFilterType | undefined>(statusFilterType);
  const [taskNameFilter, setTaskNameFilter] = useState<string>(name);
  const [localNodes, setLocalNodes] = useState<Map<string, boolean>>(new Map());
  const [localAllNodes, setLocalAllNodes] = useState<boolean>(allNodes);
  const [podIpFilter, setPodIpFilter] = useState<string>(pod_ip);
  const [errors, setErrors] = useState<string[]>([]);

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

  useEffect(() => {
    setLocalStatusFilterType(statusFilterType);

    if (statusFilterType === StatusFilterType.CUSTOM) {
      const statusArray = statuses?.split(",") ?? [];
      setLocalStatusMap(getMapFromStatusArray(statusArray));
    } else {
      setLocalStatusMap(getMapFromStatusArray(getTaskStatusArray(statusFilterType)));
    }
  }, [statuses, statusFilterType]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const statuses = getTaskStatusArray(localStatusFilterType, localStatusMap);

    const nodes = Array.from(localNodes.entries())
      .filter(([_, enabled]) => enabled)
      .map(([node]) => node);

    const formErrors = validateFilters({
      name: taskNameFilter,
      nodes: nodes.join(","),
      allNodes: localAllNodes,
      statusFilterType: localStatusFilterType,
      statuses: localStatusFilterType === StatusFilterType.CUSTOM ? statuses.join(",") : undefined,
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
      statusFilterType: localStatusFilterType,
      status: localStatusFilterType === StatusFilterType.CUSTOM ? statuses.join(",") : null,
      pod_ip: podIpFilter.length > 0 ? podIpFilter : null,
    });
  };

  const handleReset = () => {
    setTaskNameFilter("");
    setLocalNodes(new Map());
    setLocalAllNodes(true);
    setPodIpFilter("");
    setLocalStatusMap(new Map(TaskStatusValues.map((value) => [value, true])));
    setLocalStatusFilterType(StatusFilterType.ALL);
    setErrors([]);
    updateUrl({
      filterName: null,
      nodes: undefined,
      status: undefined,
      pod_ip: undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-global">
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
        <div className="px-global">
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
        <div className="p-global">
          <StatusFilter
            statusMap={localStatusMap}
            setStatusMap={(statusMap) => {
              setLocalStatusMap(statusMap);
            }}
            statusFilterType={localStatusFilterType}
            setStatusFilterType={setLocalStatusFilterType}
          />
        </div>
      </div>
      <InlineBanner status={errors.length > 0 ? "error" : "none"}>
        {errors.length > 0 ? (
          <div className="flex flex-col">
            {errors.map((error, index) => (
              <div key={index}>{error}</div>
            ))}
          </div>
        ) : (
          ""
        )}
      </InlineBanner>
      <div className="flex flex-row gap-global justify-between body-footer p-global sticky bottom-0">
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
