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
import { Spinner } from "~/components/Spinner";
import { StatusFilterType } from "~/components/StatusFilter";
import { TASK_PINNED_KEY, UrlTypes } from "~/components/StoreProvider";
import { Colors, Tag } from "~/components/Tag";
import { UserFilterType } from "~/components/UserFilter";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type TaskStatusType } from "~/models";
import { type TaskListItem } from "~/models/tasks-model";
import { api } from "~/trpc/react";
import { formatForWrapping } from "~/utils/string";

import { getTaskStatusArray } from "./components/StatusFilter";
import { TasksFilters, type TasksFiltersDataProps } from "./components/TasksFilters";
import { TasksTable } from "./components/TasksTable";
import { getActionId } from "./components/TasksTable";
import TaskDetails from "../workflows/components/TaskDetails";
import { ToolsModal } from "../workflows/components/ToolsModal";
import WorkflowDetails from "../workflows/components/WorkflowDetails";
import { useWorkflow } from "../workflows/components/WorkflowLoader";
import useToolParamUpdater, { type ToolType } from "../workflows/hooks/useToolParamUpdater";

export default function Tasks() {
  const { username } = useAuth();
  const defaultState = {
    statusFilterType: StatusFilterType.CURRENT,
    dateRange: allDateRange.toString(),
  };
  const {
    updateUrl,
    userFilter,
    poolFilter,
    statusFilterType,
    statusFilter,
    userType,
    isSelectAllPoolsChecked,
    nameFilter,
    priority,
    dateRange,
    dateAfterFilter,
    dateBeforeFilter,
    selectedWorkflowName,
    tool,
    fullLog,
    lines,
    filterCount,
    selectedTaskName,
    retryId,
    dateRangeDates,
    showWF,
    nodes,
    isSelectAllNodesChecked,
  } = useToolParamUpdater(UrlTypes.Tasks, username, defaultState);
  const focusReturnIdRef = useRef<string | undefined>(undefined);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const [taskPinned, setTaskPinned] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType | undefined>(tool);
  const [showFilters, setShowFilters] = useState(false);
  const [showTotalResources, setShowTotalResources] = useState(false);

  const {
    data: selectedWorkflow,
    error: selectedWorkflowError,
    isLoading: isLoadingWorkflow,
  } = useWorkflow(selectedTaskName ? selectedWorkflowName : undefined, true, false);

  const {
    data: tasks,
    isLoading,
    isSuccess,
    refetch,
  } = api.tasks.getList.useQuery(
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
    },
    {
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const selectedTask = useMemo(() => {
    return selectedWorkflow?.groups
      ?.find((g) => g.tasks.some((t) => t.name === selectedTaskName && t.retry_id === retryId))
      ?.tasks.find((t) => t.name === selectedTaskName && t.retry_id === retryId);
  }, [selectedWorkflow, selectedTaskName, retryId]);

  useEffect(() => {
    if (selectedTaskName && selectedWorkflowName && retryId !== undefined) {
      focusReturnIdRef.current = getActionId(!!showWF, selectedWorkflowName, selectedTaskName, retryId);
    }
  }, [selectedTaskName, selectedWorkflowName, retryId, showWF]);

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
    if (taskPinned && selectedTaskName) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [taskPinned, selectedTaskName]);

  const extraData = useMemo((): Record<string, React.ReactNode> => {
    const taskItem = tasks?.find((t) => t.task_name === selectedTaskName && t.retry_id === retryId);
    const extraData: Record<string, React.ReactNode> = {};

    if (taskItem) {
      extraData.Workflow = (
        <button
          className="tag-container"
          onClick={() => {
            updateUrl({ showWF: true });
          }}
        >
          <Tag
            color={Colors.tag}
            className="text-start"
          >
            {formatForWrapping(taskItem.workflow_id)}
          </Tag>
        </button>
      );

      if (taskItem.pool) {
        extraData.Pool = (
          <Link
            href={`/pools/${taskItem.pool}`}
            className="tag-container"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Tag color={Colors.pool}>{taskItem.pool}</Tag>
          </Link>
        );
      }

      extraData.GPU = taskItem.gpu;
      extraData.CPU = taskItem.cpu;
      extraData.Memory = taskItem.memory;
      extraData.Storage = taskItem.storage;
    }

    return extraData;
  }, [tasks, selectedTaskName, retryId, updateUrl]);

  const processResources = useMemo((): TaskListItem[] => {
    if (!isSuccess) {
      return [];
    }

    return tasks ?? [];
  }, [tasks, isSuccess]);

  const totalResources = useMemo(() => {
    // Calculate totals for CPU, Memory, GPU, and Storage
    return (
      tasks?.reduce(
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
  }, [tasks]);

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
        <IconButton
          icon="memory"
          text="Total Resources"
          className={`btn ${showTotalResources ? "btn-primary" : ""}`}
          onClick={() => {
            setShowTotalResources(!showTotalResources);
          }}
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
              dateRange={dateRange}
              startedAfter={dateAfterFilter}
              startedBefore={dateBeforeFilter}
              statusFilterType={statusFilterType}
              statuses={statusFilter ?? ""}
              selectedPools={poolFilter}
              isSelectAllPoolsChecked={isSelectAllPoolsChecked}
              currentUserName={username}
              onRefresh={forceRefetch}
              validateFilters={validateFilters}
              priority={priority}
              workflowId={nameFilter ?? ""}
              updateUrl={updateUrl}
              nodes={nodes ?? ""}
              isSelectAllNodesChecked={isSelectAllNodesChecked ?? true}
            />
          )}
        </SlideOut>
        <SlideOut
          id="total-resources"
          open={showTotalResources}
          onClose={() => setShowTotalResources(false)}
          header="Total Resources"
          className="lg:mr-20 border-t-0"
        >
          <div className="w-full p-global dag-details-body">
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
        <TasksTable
          processResources={processResources}
          isLoading={isLoading}
          selectedTaskName={selectedTaskName}
          retryId={retryId}
          selectedWorkflowId={selectedWorkflowName}
          updateUrl={updateUrl}
          showWF={showWF ?? false}
        />
        <SlideOut
          animate={true}
          header={
            showWF ? (
              <Link
                id="workflow-details-header"
                className="btn btn-action"
                href={`/workflows/${selectedWorkflowName}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="font-semibold">Workflow Details</span>
                <FilledIcon name="open_in_new" />
              </Link>
            ) : (
              "Task Details"
            )
          }
          id="tasks-details"
          open={!!selectedTaskName}
          paused={!!selectedTaskName && !selectedTask}
          returnFocusOnDeactivate={false}
          onClose={() => {
            setSafeTimeout(() => {
              // focus-trap-react does not work well with useReactTable as the ref for button inside the table that triggered the slideout is not persistent
              const el = focusReturnIdRef.current ? document.getElementById(focusReturnIdRef.current) : undefined;
              el?.focus();
            }, 500);

            if (showWF) {
              updateUrl({ showWF: false });
            } else {
              updateUrl({ task: null });
            }
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
          ) : showWF && selectedWorkflow ? (
            <WorkflowDetails
              workflow={selectedWorkflow}
              updateUrl={updateUrl}
              includeName={true}
              includeTasks={true}
            />
          ) : selectedTask ? (
            <TaskDetails
              task={selectedTask}
              updateUrl={updateUrl}
              extraData={extraData}
            />
          ) : !isLoadingWorkflow ? (
            <PageError
              title="Error loading task"
              errorMessage={`${selectedTaskName} not found in ${selectedWorkflowName}`}
              size="md"
            />
          ) : (
            <div className="h-full w-full flex justify-center items-center">
              <Spinner />
            </div>
          )}
        </SlideOut>
      </div>
      <ToolsModal
        selectedTask={selectedTask}
        workflow={selectedWorkflow}
        tool={activeTool}
        fullLog={fullLog}
        lines={lines}
        updateUrl={updateUrl}
        verbose={true}
      />
    </>
  );
}
