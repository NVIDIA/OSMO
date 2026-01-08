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
import { useCallback, useEffect, useState } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { allDateRange, defaultDateRange, getBestDateRange, getDateFromValues, type DateRange } from "~/components/DateRangePicker";
import { StatusFilterType } from "~/components/StatusFilter";
import { type UrlTypes, useStore } from "~/components/StoreProvider";
import { UserFilterType } from "~/components/UserFilter";
import { PARAM_KEYS as TABLE_PARAM_KEYS } from "~/hooks/useTablePageLoader";
import { PARAM_KEYS as SORT_PARAM_KEYS } from "~/hooks/useTableSortLoader";
import { type PriorityType } from "~/models";

export enum ToolType {
  TaskLogs = "task_logs",
  TaskErrorLogs = "task_error_logs",
  WorkflowLogs = "workflow_logs",
  WorkflowErrorLogs = "workflow_error_logs",
  Spec = "spec",
  Template = "template",
  Shell = "shell",
  ShellPicker = "shell_picker",
  JSON = "json",
  TaskEvents = "task_events",
  WorkflowEvents = "workflow_events",
  Outputs = "outputs",
  Nodes = "nodes",
  PortForwarding = "port_forwarding",
  Cancel = "cancel",
}

export enum ViewType {
  List = "list",
  Graph = "graph",
  SingleTask = "single_task",
}

export const PARAM_KEYS = {
  workflow: "workflow",
  task: "task",
  tool: "tool",
  full_log: "full_log",
  last_n_lines: "last_n_lines",
  view: "view",
  filterName: "filter_name",
  allNodes: "allNodes",
  nodes: "nodes",
  statusType: "statusType",
  status: "status",
  showWF: "showWF",
  showTask: "showTask",
  allPools: "allPools",
  pools: "pools",
  allUsers: "allUsers",
  users: "users",
  dateRange: "dateRange",
  dateAfter: "dateAfter",
  dateBefore: "dateBefore",
  priority: "priority",
  pod_ip: "pod_ip",
  retry_id: "retry_id",
  entry_command: "entry_command",
} as const;

export interface ToolParamUpdaterProps {
  workflow?: string | null;
  tool?: ToolType | null;
  task?: string | null;
  fullLog?: boolean;
  lines?: number;
  view?: ViewType;
  filterName?: string | null;
  nodes?: string;
  allNodes?: boolean;
  statusFilterType?: StatusFilterType;
  status?: string | null;
  showWF?: boolean;
  pools?: string[] | null;
  users?: string[] | null;
  dateRange?: number | null;
  dateAfter?: string | null;
  dateBefore?: string | null;
  allPools?: boolean;
  allUsers?: boolean;
  priority?: PriorityType | null;
  pod_ip?: string | null;
  retry_id?: number | null;
  entry_command?: string | null;
}

// Undefined means no change; null means clear
const useToolParamUpdater = (urlType?: UrlTypes, username?: string, defaults: Record<string, string | undefined> = {}) => {
  const pathname = usePathname();
  const router = useRouter();
  const urlParams = useSearchParams();
  const { handleChangeSidebarData } = useStore();
  const [tool, setTool] = useState<ToolType | undefined>(undefined);
  const [fullLog, showFullLog] = useState(false);
  const [lines, setLines] = useState(1000);
  const [view, setView] = useState<ViewType | undefined>(undefined);
  const [nameFilter, setNameFilter] = useState("");
  const [isSelectAllNodesChecked, setIsSelectAllNodesChecked] = useState<boolean | undefined>(undefined);
  const [nodes, setNodes] = useState("");
  const [podIp, setPodIp] = useState("");
  const [userFilter, setUserFilter] = useState<string | undefined>(username);
  const [poolFilter, setPoolFilter] = useState<string>("");
  const [statusFilterType, setStatusFilterType] = useState<StatusFilterType | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [isSelectAllUsersChecked, setIsSelectAllUsersChecked] = useState(false);
  const [isSelectAllPoolsChecked, setIsSelectAllPoolsChecked] = useState(true);
  const [priority, setPriority] = useState<PriorityType | undefined>(undefined);
  const [dateRange, setDateRange] = useState<number>(
    defaults.dateRange ? Number(defaults.dateRange) : defaultDateRange,
  );
  const [dateAfterFilter, setDateAfterFilter] = useState<string | undefined>(undefined);
  const [dateBeforeFilter, setDateBeforeFilter] = useState<string | undefined>(undefined);
  const [filterCount, setFilterCount] = useState(0);
  const [selectedWorkflowName, setSelectedWorkflowName] = useState<string | undefined>(undefined);
  const [selectedTaskName, setSelectedTaskName] = useState<string | undefined>(undefined);
  const [retryId, setRetryId] = useState<number | undefined>(undefined);
  const [dateRangeDates, setDateRangeDates] = useState<DateRange | undefined>(undefined);
  const [showWF, setShowWF] = useState<boolean | undefined>(defaults.showWF ? defaults.showWF === "true" : undefined);
  const [showTask, setShowTask] = useState<boolean | undefined>(undefined);
  const [userType, setUserType] = useState<UserFilterType>(UserFilterType.CURRENT);
  useEffect(() => {
    let filterCount = 0;

    setTool(urlParams.get(PARAM_KEYS.tool) as ToolType | undefined);
    setShowTask(urlParams.get(PARAM_KEYS.showTask) !== "false");
    showFullLog(urlParams.get(PARAM_KEYS.full_log) === "true");
    setDateAfterFilter(urlParams.get(PARAM_KEYS.dateAfter) ?? undefined);
    setDateBeforeFilter(urlParams.get(PARAM_KEYS.dateBefore) ?? undefined);
    setSelectedWorkflowName(urlParams.get(PARAM_KEYS.workflow) ?? undefined);
    setSelectedTaskName(urlParams.get(PARAM_KEYS.task) ?? undefined);
    setView(urlParams.get(PARAM_KEYS.view) as ViewType);
    showFullLog(urlParams.get(PARAM_KEYS.full_log) === "true");

    const showWFParam = urlParams.get(PARAM_KEYS.showWF);
    if (showWFParam !== null) {
      setShowWF(showWFParam === "true");
    } else {
      setShowWF(defaults.showWF ? defaults.showWF === "true" : undefined);
    }

    const showTaskParam = urlParams.get(PARAM_KEYS.showTask);
    if (showTaskParam !== null) {
      setShowTask(showTaskParam === "true");
    } else {
      setShowTask(undefined);
    }

    const linesParam = urlParams.get(PARAM_KEYS.last_n_lines);
    const num = Number(linesParam);
    if (linesParam !== null && !Number.isNaN(num)) {
      setLines(num);
    }

    const name = urlParams.get(PARAM_KEYS.filterName);
    setNameFilter(name ?? "");
    if (name) {
      filterCount++;
    }

    const allNodesParam = urlParams.get(PARAM_KEYS.allNodes);
    const allNodes = allNodesParam !== null ? allNodesParam === "true" : true;
    setIsSelectAllNodesChecked(allNodes);
    if (!allNodes) {
      filterCount++;
    }

    setNodes(urlParams.get(PARAM_KEYS.nodes) ?? "");

    const podIp = urlParams.get(PARAM_KEYS.pod_ip);
    setPodIp(podIp ?? "");
    if (podIp) {
      filterCount++;
    }

    const retryIdParam = urlParams.get(PARAM_KEYS.retry_id);
    let retryId: number | undefined = undefined;
    if (retryIdParam) {
      const num = Number(retryIdParam);
      if (!Number.isNaN(num)) {
        retryId = num;
      }
    }
    setRetryId(retryId ?? undefined);

    const dateRangeParam = urlParams.get(PARAM_KEYS.dateRange);
    const dateRangeNum = dateRangeParam ? Number(dateRangeParam) : defaults.dateRange ? Number(defaults.dateRange) : defaultDateRange;
    if (dateRangeNum !== allDateRange) {
      filterCount++;
    }
    setDateRange(getBestDateRange(dateRangeNum));

    const allUsers = urlParams.get(PARAM_KEYS.allUsers) === "true";
    setIsSelectAllUsersChecked(allUsers);
    if (!allUsers) {
      filterCount++;
    }

    const allPools = urlParams.get(PARAM_KEYS.allPools) !== "false";
    setIsSelectAllPoolsChecked(allPools);
    if (!allPools) {
      filterCount++;
    }

    const priority = urlParams.get(PARAM_KEYS.priority);
    setPriority(priority ? (priority as PriorityType) : undefined);
    if (priority) {
      filterCount++;
    }

    const users = urlParams.get(PARAM_KEYS.users);
    if (users?.length) {
      setUserFilter(users);
    } else {
      setUserFilter(username);
    }

    setPoolFilter(urlParams.get(PARAM_KEYS.pools) ?? "");

    const statusFilterTypeParam = urlParams.get(PARAM_KEYS.statusType);
    const statusFilterTypeValue = statusFilterTypeParam as StatusFilterType ?? defaults.statusFilterType as StatusFilterType;
    setStatusFilterType(statusFilterTypeValue);
    setStatusFilter(urlParams.get(PARAM_KEYS.status) ?? undefined);

    if (statusFilterTypeValue !== StatusFilterType.ALL) {
      filterCount++;
    }

    setFilterCount(filterCount);
  }, [urlParams, username, defaults]);

  useEffect(() => {
    setDateRangeDates(getDateFromValues(dateRange, dateAfterFilter, dateBeforeFilter));
  }, [dateRange, dateAfterFilter, dateBeforeFilter]);

  useEffect(() => {
    if (isSelectAllUsersChecked) {
      setUserType(UserFilterType.ALL);
    } else if (userFilter === username) {
      setUserType(UserFilterType.CURRENT);
    } else {
      setUserType(UserFilterType.CUSTOM);
    }
  }, [isSelectAllUsersChecked, userFilter, username]);

  const updateUrl = useCallback((props: ToolParamUpdaterProps): void => {
    const {
      tool,
      task,
      fullLog,
      lines,
      view,
      filterName,
      nodes,
      allNodes: isSelectAllNodesChecked,
      status,
      statusFilterType,
      showWF,
      workflow,
      pools,
      users,
      dateRange,
      dateAfter,
      dateBefore,
      allPools,
      allUsers,
      priority,
      pod_ip,
      retry_id,
      entry_command,
    } = props;
    const newParams = new URLSearchParams(window.location.search);

    if (pathname !== window.location.pathname) {
      console.info("URL switched... ignoring update");
      return;
    }

    if (tool) {
      newParams.set(PARAM_KEYS.tool, tool);
    } else if (tool === null) {
      newParams.delete(PARAM_KEYS.tool);
    }

    if (workflow) {
      newParams.set(PARAM_KEYS.workflow, workflow);
    } else if (workflow === null) {
      newParams.delete(PARAM_KEYS.workflow);
    }

    if (task) {
      newParams.set(PARAM_KEYS.task, task);
    } else if (task === null) {
      newParams.delete(PARAM_KEYS.task);
    }

    if (fullLog !== undefined) {
      newParams.set(PARAM_KEYS.full_log, fullLog.toString());
    }

    if (lines !== undefined) {
      newParams.set(PARAM_KEYS.last_n_lines, lines.toString());
    }

    if (view !== undefined) {
      newParams.set(PARAM_KEYS.view, view);
    }

    if (filterName === null) {
      newParams.delete(PARAM_KEYS.filterName);
    } else if (filterName !== undefined) {
      newParams.set(PARAM_KEYS.filterName, filterName);
    }

    if (isSelectAllNodesChecked !== undefined) {
      newParams.set(PARAM_KEYS.allNodes, isSelectAllNodesChecked.toString());
    }

    if (isSelectAllNodesChecked) {
      newParams.delete(PARAM_KEYS.nodes);
    } else if (nodes !== undefined) {
      newParams.set(PARAM_KEYS.nodes, nodes);
    }

    if (status === null) {
      newParams.delete(PARAM_KEYS.status);
    } else if (status !== undefined) {
      newParams.set(PARAM_KEYS.status, status);
    }

    if (statusFilterType !== undefined) {
      newParams.set(PARAM_KEYS.statusType, statusFilterType);
    }

    if (showWF !== undefined) {
      newParams.set(PARAM_KEYS.showWF, showWF.toString());
    }

    if (allUsers !== undefined) {
      newParams.set(PARAM_KEYS.allUsers, allUsers.toString());
    }

    if (allPools !== undefined) {
      newParams.set(PARAM_KEYS.allPools, allPools.toString());
    }

    if (pools === null) {
      newParams.delete(PARAM_KEYS.pools);
    } else if (pools !== undefined) {
      newParams.set(PARAM_KEYS.pools, pools.join(","));
    }

    if (users === null) {
      newParams.delete(PARAM_KEYS.users);
    } else if (users !== undefined) {
      newParams.set(PARAM_KEYS.users, users.join(","));
    }

    if (dateRange === null) {
      newParams.delete(PARAM_KEYS.dateRange);
    } else if (dateRange !== undefined) {
      newParams.set(PARAM_KEYS.dateRange, dateRange.toString());
    }

    if (dateAfter === null) {
      newParams.delete(PARAM_KEYS.dateAfter);
    } else if (dateAfter !== undefined) {
      newParams.set(PARAM_KEYS.dateAfter, dateAfter);
    }

    if (dateBefore === null) {
      newParams.delete(PARAM_KEYS.dateBefore);
    } else if (dateBefore !== undefined) {
      newParams.set(PARAM_KEYS.dateBefore, dateBefore);
    }

    if (priority === null) {
      newParams.delete(PARAM_KEYS.priority);
    } else if (priority !== undefined) {
      newParams.set(PARAM_KEYS.priority, priority);
    }

    if (pod_ip === null) {
      newParams.delete(PARAM_KEYS.pod_ip);
    } else if (pod_ip !== undefined) {
      newParams.set(PARAM_KEYS.pod_ip, pod_ip);
    }

    if (retry_id === null) {
      newParams.delete(PARAM_KEYS.retry_id);
    } else if (retry_id !== undefined) {
      newParams.set(PARAM_KEYS.retry_id, retry_id.toString());
    }

    if (entry_command === null) {
      newParams.delete(PARAM_KEYS.entry_command);
    } else if (entry_command !== undefined) {
      newParams.set(PARAM_KEYS.entry_command, entry_command);
    }

    router.replace(`${pathname}?${newParams.toString()}`);

    if (urlType) {
      // Remove specific urlParams from the sidebar data
      newParams.delete(TABLE_PARAM_KEYS.pageSize);
      newParams.delete(TABLE_PARAM_KEYS.pageIndex);
      newParams.delete(SORT_PARAM_KEYS.sorting);
      newParams.delete(PARAM_KEYS.tool);
      newParams.delete(PARAM_KEYS.workflow);
      newParams.delete(PARAM_KEYS.task);
      newParams.delete(PARAM_KEYS.status);
      newParams.delete(PARAM_KEYS.showWF);
      newParams.delete(PARAM_KEYS.showTask);
      newParams.delete(PARAM_KEYS.nodes);
      newParams.delete(PARAM_KEYS.allNodes);
      newParams.delete(PARAM_KEYS.filterName);
      newParams.delete(PARAM_KEYS.full_log);
      newParams.delete(PARAM_KEYS.last_n_lines);
      handleChangeSidebarData(urlType, `?${newParams.toString()}`);
    }
  }, [handleChangeSidebarData, pathname, router, urlType]);

  return {
    updateUrl,
    tool,
    fullLog,
    lines,
    view,
    nameFilter,
    nodes,
    isSelectAllNodesChecked,
    podIp,
    filterCount,
    userFilter,
    poolFilter,
    statusFilterType,
    statusFilter,
    userType,
    isSelectAllPoolsChecked,
    priority,
    dateRange,
    dateAfterFilter,
    dateBeforeFilter,
    selectedWorkflowName,
    selectedTaskName,
    retryId,
    dateRangeDates,
    showTask,
    showWF,
  };
};

export default useToolParamUpdater;
