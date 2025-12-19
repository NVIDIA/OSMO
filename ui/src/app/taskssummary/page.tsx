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

import { useAuth } from "~/components/AuthProvider";
import { allDateRange, customDateRange } from "~/components/DateRangePicker";
import { FilterButton } from "~/components/FilterButton";
import { FilledIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { StatusFilterType } from "~/components/StatusFilter";
import { TASK_PINNED_KEY, UrlTypes } from "~/components/StoreProvider";
import { UserFilterType } from "~/components/UserFilter";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type TaskStatusType } from "~/models";
import { type TaskSummaryListItem } from "~/models/tasks-model";
import { api } from "~/trpc/react";

import { TasksTable } from "./components/TasksTable";
import { getTaskStatusArray } from "../tasks/components/StatusFilter";
import { TasksFilters, type TasksFiltersDataProps } from "../tasks/components/TasksFilters";
import { ToolsModal } from "../workflows/components/ToolsModal";
import WorkflowDetails from "../workflows/components/WorkflowDetails";
import { useWorkflow } from "../workflows/components/WorkflowLoader";
import useToolParamUpdater, { type ToolType } from "../workflows/hooks/useToolParamUpdater";

export default function TasksSummary() {
  const { username } = useAuth();
  const defaultState = {
    status: "RUNNING",
    statusFilterType: StatusFilterType.CURRENT,
    dateRange: allDateRange.toString(),
  };
  const {
    updateUrl,
    userFilter,
    poolFilter,
    userType,
    isSelectAllPoolsChecked,
    nameFilter,
    priority,
    selectedWorkflowName,
    selectedTaskName,
    retryId,
    tool,
    fullLog,
    lines,
    filterCount,
    showWF,
    dateRange,
    dateRangeDates,
    dateAfterFilter,
    dateBeforeFilter,
    statusFilterType,
    statusFilter,
    nodes,
    isSelectAllNodesChecked,
  } = useToolParamUpdater(UrlTypes.TasksSummary, username, defaultState);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const [taskPinned, setTaskPinned] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType | undefined>(tool);
  const [showFilters, setShowFilters] = useState(false);
  const [showTotalResources, setShowTotalResources] = useState(false);

  const {
    data: selectedWorkflow,
    error: selectedWorkflowError,
    isLoading: isLoadingWorkflow,
  } = useWorkflow(selectedWorkflowName, true, false);

  const {
    data: summaries,
    isLoading,
    isSuccess,
    error,
    refetch,
  } = api.tasks.getSummaryList.useQuery(
    {
      limit: 1000,
      order: "DESC",
      all_users: userType === UserFilterType.ALL,
      users: userType === UserFilterType.CUSTOM ? (userFilter?.split(",") ?? []) : [],
      all_pools: isSelectAllPoolsChecked,
      pools: isSelectAllPoolsChecked ? [] : poolFilter ? poolFilter.split(",") : [],
      statuses:
        statusFilterType === StatusFilterType.CUSTOM
          ? (statusFilter?.split(",") as TaskStatusType[])
          : getTaskStatusArray(statusFilterType),
      priority: priority,
      started_after: dateRangeDates?.fromDate?.toISOString(),
      started_before: dateRangeDates?.toDate?.toISOString(),
      workflow_id: nameFilter,
      nodes: isSelectAllNodesChecked ? [] : nodes.split(","),
      summary: !showWF,
      aggregate_by_workflow: showWF,
    },
    {
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const selectedTask = useMemo(() => {
    return (
      selectedWorkflow?.groups
        .flatMap((group) => group.tasks)
        .find((task) => task.name === selectedTaskName && task.retry_id === retryId) ?? undefined
    );
  }, [selectedWorkflow, selectedTaskName, retryId]);

  // Initialize localStorage values after component mounts
  useEffect(() => {
    try {
      const storedTaskPinned = localStorage.getItem(TASK_PINNED_KEY);
      if (storedTaskPinned !== null) {
        setTaskPinned(storedTaskPinned === "true");
      }
    } catch (error) {
      // localStorage might not be available in some environments
      console.warn("localStorage not available:", error);
    }
  }, []);

  useEffect(() => {
    if (selectedWorkflow) {
      setActiveTool(tool);
    }
  }, [tool, selectedWorkflow]);

  const validateFilters = useCallback(
    ({
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
    },
    [],
  );

  useEffect(() => {
    if (
      validateFilters({
        userType,
        isSelectAllPoolsChecked,
        selectedUsers: userFilter ?? "",
        selectedPools: poolFilter,
        dateRange,
        startedAfter: dateAfterFilter,
        startedBefore: dateBeforeFilter,
        workflowId: nameFilter ?? "",
        nodes: nodes ?? "",
        isSelectAllNodesChecked: isSelectAllNodesChecked ?? true,
        statusFilterType,
        statuses: statusFilter ?? "",
      }).length > 0
    ) {
      setShowFilters(true);
    }
  }, [
    userType,
    isSelectAllPoolsChecked,
    userFilter,
    poolFilter,
    dateRange,
    dateAfterFilter,
    dateBeforeFilter,
    validateFilters,
    nameFilter,
    username,
    nodes,
    isSelectAllNodesChecked,
    updateUrl,
    statusFilterType,
    statusFilter,
  ]);
  const { setSafeTimeout } = useSafeTimeout();

  const gridClass = useMemo(() => {
    if (taskPinned && selectedWorkflowName) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [taskPinned, selectedWorkflowName]);

  const processResources = useMemo((): TaskSummaryListItem[] => {
    if (!isSuccess) {
      return [];
    }

    return summaries ?? [];
  }, [summaries, isSuccess]);

  const totalResources = useMemo(() => {
    // Calculate totals for CPU, Memory, GPU, and Storage
    return (
      summaries?.reduce(
        (totals, task) => {
          // Handle possible undefined/null or non-numeric values
          const cpu = Number(task.cpu) || 0;
          const memory = Number(task.memory) || 0;
          const gpu = Number(task.gpu) || 0;
          const storage = Number(task.storage) || 0;
          return {
            CPU: totals.CPU + cpu,
            Memory: totals.Memory + memory,
            GPU: totals.GPU + gpu,
            Storage: totals.Storage + storage,
          };
        },
        { CPU: 0, Memory: 0, GPU: 0, Storage: 0 },
      ) ?? { CPU: 0, Memory: 0, GPU: 0, Storage: 0 }
    );
  }, [summaries]);

  const forceRefetch = useCallback(() => {
    // Wait to see if the refresh has already happened. If not call it explicitly
    const lastFetchTime = lastFetchTimeRef.current;

    setSafeTimeout(() => {
      if (!isLoading && lastFetchTimeRef.current === lastFetchTime) {
        void refetch();
      }
    }, 500);
  }, [refetch, isLoading, setSafeTimeout]);

  return (
    <>
      <PageHeader>
        <h2 className="grow capitalize">
          {`${statusFilterType?.toString() ?? "Current"} Tasks
          ${
            userType === UserFilterType.ALL
              ? " for All Users"
              : userFilter && userFilter.split(",").length === 1
                ? ` for ${userFilter}`
                : ""
          }`}
        </h2>
        <IconButton
          className={`btn ${showTotalResources ? "btn-primary" : ""}`}
          onClick={() => {
            setShowTotalResources(!showTotalResources);
          }}
          icon="memory"
          text="Total Resources"
          aria-expanded={showTotalResources}
          aria-haspopup="dialog"
          aria-controls="total-resources"
        />
        <FilterButton
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterCount={filterCount}
          aria-controls="tasks-filters"
        />
      </PageHeader>
      <div className={`${gridClass} h-full w-full overflow-x-auto relative`}>
        <SlideOut
          id="tasks-filters"
          open={showFilters}
          onClose={() => setShowFilters(false)}
          className="w-100 border-t-0"
          aria-label="Tasks Filter"
        >
          {/* By only adding it if showFilters is true, it will reset to url params if closed and reopened */}
          {showFilters && (
            <TasksFilters
              selectedUsers={userFilter ?? ""}
              userType={userType}
              selectedPools={poolFilter}
              isSelectAllPoolsChecked={isSelectAllPoolsChecked}
              currentUserName={username}
              onRefresh={forceRefetch}
              validateFilters={validateFilters}
              priority={priority}
              workflowId={nameFilter ?? ""}
              updateUrl={updateUrl}
              dateRange={dateRange}
              statusFilterType={statusFilterType}
              statuses={statusFilter ?? ""}
              nodes={nodes ?? ""}
              isSelectAllNodesChecked={isSelectAllNodesChecked ?? true}
            />
          )}
        </SlideOut>
        <SlideOut
          animate={true}
          id="total-resources"
          open={showTotalResources}
          onClose={() => setShowTotalResources(false)}
          header="Total Resources"
          className="mr-20 border-t-0"
        >
          <div className="h-full w-full p-global dag-details-body">
            <dl
              className="grid-cols-2"
              aria-labelledby="total-resources-header"
            >
              <dt>Storage</dt>
              <dd className="text-right">
                {Intl.NumberFormat("en-US", { style: "decimal" }).format(totalResources.Storage)}
              </dd>
              <dt>CPU</dt>
              <dd className="text-right">
                {Intl.NumberFormat("en-US", { style: "decimal" }).format(totalResources.CPU)}
              </dd>
              <dt>Memory</dt>
              <dd className="text-right">
                {Intl.NumberFormat("en-US", { style: "decimal" }).format(totalResources.Memory)}
              </dd>
              <dt>GPU</dt>
              <dd className="text-right">
                {Intl.NumberFormat("en-US", { style: "decimal" }).format(totalResources.GPU)}
              </dd>
            </dl>
          </div>
        </SlideOut>
        {error ? (
          <div className="h-full w-full">
            <PageError
              title="Error loading tasks"
              errorMessage={error?.message ?? "Unknown error"}
              size="md"
            />
          </div>
        ) : (
          <>
            <TasksTable
              processResources={processResources}
              isLoading={isLoading}
              selectedWorkflowId={selectedWorkflowName}
              updateUrl={updateUrl}
              showWF={showWF ?? false}
            />
            <SlideOut
              animate={true}
              header={
                <Link
                  id="workflow-details-header"
                  className="btn btn-action"
                  href={`/workflows/${selectedWorkflowName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Workflow Details - Open in new tab"
                >
                  <span className="font-semibold">Workflow Details</span>
                  <FilledIcon name="open_in_new" />
                </Link>
              }
              id="details-panel"
              open={!!showWF && !!selectedWorkflowName}
              paused={!!showWF && !!selectedWorkflowName && !selectedWorkflow}
              onClose={() => {
                updateUrl({ workflow: null, task: null });
              }}
              canPin={true}
              pinned={taskPinned}
              onPinChange={(pinned) => {
                setTaskPinned(pinned);
                localStorage.setItem(TASK_PINNED_KEY, pinned.toString());
              }}
              className="workflow-details-slideout border-t-0"
              headerClassName="brand-header"
              bodyClassName="dag-details-body"
            >
              {selectedWorkflowError ? (
                <PageError
                  title="Error loading workflow"
                  errorMessage={selectedWorkflowError.message}
                  size="md"
                />
              ) : selectedWorkflow ? (
                <WorkflowDetails
                  workflow={selectedWorkflow}
                  updateUrl={updateUrl}
                  includeName={true}
                  includeTasks={true}
                />
              ) : (
                !isLoadingWorkflow && (
                  <PageError
                    title="Error loading task"
                    errorMessage={`${selectedWorkflowName} not found`}
                    size="md"
                  />
                )
              )}
            </SlideOut>
          </>
        )}
      </div>
      <ToolsModal
        workflow={selectedWorkflow}
        selectedTask={selectedTask}
        tool={activeTool}
        fullLog={fullLog}
        lines={lines}
        updateUrl={updateUrl}
        verbose={true}
      />
    </>
  );
}
