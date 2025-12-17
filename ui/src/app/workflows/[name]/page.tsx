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
import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { ReactFlowProvider } from "reactflow";

import { useAuth } from "~/components/AuthProvider";
import { FilterButton } from "~/components/FilterButton";
import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import StatusBadge from "~/components/StatusBadge";
import { StatusFilterType } from "~/components/StatusFilter";
import { TASK_PINNED_KEY, UrlTypes } from "~/components/StoreProvider";
import { ViewToggleButton } from "~/components/ViewToggleButton";
import { env } from "~/env.mjs";
import { type Task, type WorkflowSlugParams } from "~/models/workflows-model";

import DirectedAcyclicGraph from "../components/DAG";
import TaskDetails from "../components/TaskDetails";
import { TasksFilter, type TasksFiltersDataProps } from "../components/TasksFilter";
import { TasksTable } from "../components/TasksTable";
import { ToolsModal } from "../components/ToolsModal";
import WorkflowDetails from "../components/WorkflowDetails";
import { useWorkflow } from "../components/WorkflowLoader";
import useToolParamUpdater, { type ToolType, ViewType } from "../hooks/useToolParamUpdater";

export default function WorkflowOverviewPage({ params }: WorkflowSlugParams) {
  const { username } = useAuth();
  const [taskPinned, setTaskPinned] = useState(false);
  const [workflowNameParts, setWorkflowNameParts] = useState<{ id: number; name: string } | undefined>(undefined);

  const {
    updateUrl,
    tool,
    fullLog,
    lines,
    view,
    statusFilter,
    statusFilterType,
    nameFilter,
    nodes,
    isSelectAllNodesChecked,
    podIp,
    filterCount,
    showWF,
    selectedTaskName,
    retryId,
  } = useToolParamUpdater(UrlTypes.Workflows, username, { showWF: "true", statusFilterType: StatusFilterType.ALL });
  const selectedWorkflow = useWorkflow(params.name, true, 2);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState<number | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ToolType | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const availableNodes = useMemo(
    () =>
      selectedWorkflow.data?.groups
        .flatMap((group) => group.tasks.map((task) => task.node_name ?? ""))
        .filter((node) => node.length > 0) ?? [],
    [selectedWorkflow.data],
  );

  const flatTasks = useMemo(() => {
    if (!selectedWorkflow.data) {
      return undefined;
    }
    return (selectedWorkflow.data?.groups ?? []).flatMap((group) => group.tasks);
  }, [selectedWorkflow.data]);

  const forceSingleTaskView = useMemo(() => {
    if (!flatTasks) {
      return undefined;
    }
    return flatTasks.length <= 1;
  }, [flatTasks]);

  const localView = useMemo(() => {
    if (forceSingleTaskView) {
      return ViewType.SingleTask;
    }

    return view ?? ViewType.List;
  }, [forceSingleTaskView, view]);

  useEffect(() => {
    if (localView === ViewType.SingleTask && (!selectedTaskName || retryId === undefined)) {
      const task = selectedWorkflow.data?.groups?.[0]?.tasks?.[0];
      if (task) {
        updateUrl({ task: task.name, retry_id: task.retry_id });
      }
    }
  }, [localView, selectedTaskName, retryId, selectedWorkflow.data, updateUrl]);

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
    document.title = `${env.NEXT_PUBLIC_APP_NAME} Workflow: ${params.name}`;

    const separator = params.name.lastIndexOf("-");
    const id = Number(params.name.slice(separator + 1));

    if (!Number.isNaN(id)) {
      setWorkflowNameParts({ id, name: params.name.slice(0, separator) });
    }
  }, [params.name]);

  useEffect(() => {
    if (selectedWorkflow.data) {
      setActiveTool(tool);
    }
  }, [selectedWorkflow.data, tool]);

  useEffect(() => {
    if (flatTasks && selectedTaskName && retryId !== undefined) {
      const taskIndex = flatTasks.findIndex((t) => t.name === selectedTaskName && t.retry_id === retryId);

      setSelectedTask(taskIndex === undefined ? undefined : flatTasks[taskIndex]);
      setSelectedTaskIndex(taskIndex);
    } else {
      setSelectedTask(undefined);
      setSelectedTaskIndex(undefined);
    }
  }, [flatTasks, selectedTaskName, retryId]);

  const nextTask = useMemo(() => {
    if (flatTasks && selectedTaskIndex !== undefined && selectedTaskIndex < flatTasks.length - 1) {
      return flatTasks[selectedTaskIndex + 1];
    }
    return undefined;
  }, [selectedTaskIndex, flatTasks]);

  const previousTask = useMemo(() => {
    if (flatTasks && selectedTaskIndex !== undefined && selectedTaskIndex > 0) {
      return flatTasks[selectedTaskIndex - 1];
    }
    return undefined;
  }, [selectedTaskIndex, flatTasks]);

  const onNextTask = useCallback(() => {
    if (nextTask) {
      updateUrl({ task: nextTask.name, retry_id: nextTask.retry_id });
    }
  }, [nextTask, updateUrl]);

  const onPreviousTask = useCallback(() => {
    if (previousTask) {
      updateUrl({ task: previousTask.name, retry_id: previousTask.retry_id });
    }
  }, [previousTask, updateUrl]);

  const gridClass = useMemo(() => {
    if (localView === ViewType.SingleTask) {
      return "grid grid-cols-[auto_0fr_1fr]";
    } else if (showWF && selectedTask && taskPinned) {
      return "grid grid-cols-[auto_1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [showWF, selectedTask, taskPinned, localView]);

  const verbose = useMemo(() => {
    const tasks = (selectedWorkflow.data?.groups ?? []).flatMap((group) => group.tasks);
    return tasks.some((task: Task) => task.retry_id && task.retry_id > 0);
  }, [selectedWorkflow.data]);

  const validateFilters = useCallback((props: TasksFiltersDataProps) => {
    const errors: string[] = [];
    if (!props.allNodes && props.nodes.length === 0) {
      errors.push("Please select at least one node");
    }
    if (props.statusFilterType === StatusFilterType.CUSTOM && !props.statuses?.length) {
      errors.push("Please select at least one status");
    }
    return errors;
  }, []);

  if (selectedWorkflow.error) {
    return (
      <PageError
        title="Failed to Fetch Workflow"
        errorMessage={selectedWorkflow.error.message}
      />
    );
  }

  if (!selectedWorkflow.data || !localView) {
    return (
      <div className="h-full w-full flex justify-center items-center">
        <Spinner
          description="Generating Overview..."
          size="large"
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader>
        <div className="flex items-center justify-center grow overflow-x-hidden">
          {workflowNameParts && workflowNameParts.id > 1 ? (
            <Link
              className="no-underline p-0 m-1"
              href={`/workflows/${workflowNameParts.name}-${workflowNameParts.id - 1}`}
              title="Previous Run"
            >
              <OutlinedIcon
                name="keyboard_double_arrow_left"
                className="text-lg!"
              />
            </Link>
          ) : (
            <OutlinedIcon
              name="keyboard_double_arrow_left"
              className="text-lg! opacity-50 m-1"
            />
          )}
          <h2>{params.name}</h2>
          {workflowNameParts && (
            <Link
              className="no-underline p-0 m-1"
              href={`/workflows/${workflowNameParts.name}-${workflowNameParts.id + 1}`}
              title="Next Run"
            >
              <OutlinedIcon
                name="keyboard_double_arrow_right"
                className="text-lg!"
              />
            </Link>
          )}
        </div>
        {!forceSingleTaskView && (
          <>
            <IconButton
              icon="work_outline"
              text="Workflow"
              className={`relative btn ${showWF ? "btn-primary" : ""}`}
              onClick={() => {
                updateUrl({ showWF: !showWF });
              }}
              aria-pressed={showWF}
              disabled={localView === ViewType.SingleTask}
            >
              <StatusBadge
                className="tag-filter right-[-0.75rem] top-[-0.35rem]"
                status={selectedWorkflow.data.status}
                compact
              />
            </IconButton>
            <fieldset
              className="toggle-group"
              aria-label="View Type"
            >
              <ViewToggleButton
                name="taskViewType"
                checked={localView === ViewType.SingleTask}
                onChange={() => updateUrl({ view: ViewType.SingleTask, showWF: true })}
              >
                <FilledIcon name="task" />
                <span
                  className="hidden lg:block"
                  aria-label="Single Task"
                >
                  Task
                </span>
              </ViewToggleButton>
              <ViewToggleButton
                name="taskViewType"
                checked={localView === ViewType.List}
                onChange={() => updateUrl({ view: ViewType.List })}
              >
                <FilledIcon name="list" />
                <span
                  className="hidden lg:block"
                  aria-label="List"
                >
                  List
                </span>
              </ViewToggleButton>
              <ViewToggleButton
                name="taskViewType"
                checked={localView === ViewType.Graph}
                onChange={() => updateUrl({ view: ViewType.Graph })}
              >
                <FilledIcon name="border_clear" />
                <span
                  className="hidden lg:block"
                  aria-label="Graph"
                >
                  Graph
                </span>
              </ViewToggleButton>
            </fieldset>
            <FilterButton
              showFilters={showFilters}
              setShowFilters={(showFilters) => {
                if (localView === ViewType.List) {
                  setShowFilters(showFilters);
                }
              }}
              filterCount={localView === ViewType.List ? filterCount : 0}
              aria-controls="tasks-filters"
              aria-disabled={localView !== ViewType.List}
            />
          </>
        )}
      </PageHeader>
      <div className={`${gridClass} h-full w-full overflow-x-auto relative`}>
        <SlideOut
          id="tasks-filter"
          open={showFilters}
          onClose={() => {
            setShowFilters(false);
          }}
          aria-label="Tasks Filter"
          className="z-20 border-t-0 w-100"
        >
          <TasksFilter
            name={nameFilter}
            nodes={nodes}
            allNodes={isSelectAllNodesChecked ?? true}
            statuses={statusFilter ?? ""}
            statusFilterType={statusFilterType}
            pod_ip={podIp}
            availableNodes={availableNodes}
            updateUrl={updateUrl}
            validateFilters={validateFilters}
          />
        </SlideOut>
        {showWF && (
          <div
            className="flex flex-col relative body-component workflow-details-slideout"
            role="region"
            aria-labelledby="workflow-details-header"
          >
            <div className={`popup-header sticky top-0 z-10 brand-header`}>
              <h2 id="workflow-details-header">Workflow Details</h2>
              {localView !== ViewType.SingleTask && (
                <button
                  className="btn btn-action"
                  aria-label="Close Workflow Details"
                  onClick={() => {
                    updateUrl({ showWF: false });
                  }}
                >
                  <OutlinedIcon name="close" />
                </button>
              )}
            </div>
            <div className="dag-details-body">
              <WorkflowDetails
                workflow={selectedWorkflow.data}
                updateUrl={updateUrl}
              />
            </div>
          </div>
        )}
        <div className={`h-full ${localView === ViewType.SingleTask ? "w-0" : "w-full grow"} overflow-x-auto`}>
          <div className={`h-full w-full ${localView === ViewType.Graph ? "block p-1" : "hidden"}`}>
            {selectedWorkflow.data?.groups?.length > 0 ? (
              <ReactFlowProvider>
                <DirectedAcyclicGraph
                  workflow={selectedWorkflow.data}
                  refetch={selectedWorkflow.refetch}
                  selectedTask={selectedTask}
                  visible={localView === ViewType.Graph}
                  updateUrl={updateUrl}
                />
              </ReactFlowProvider>
            ) : (
              <div className="flex items-center justify-center h-full w-full">
                <p
                  className="text-center"
                  role="alert"
                >
                  No tasks found
                </p>
              </div>
            )}
          </div>
          <div className={`h-full w-full ${localView === ViewType.List ? "block" : "hidden"}`}>
            <TasksTable
              workflow={selectedWorkflow.data}
              name={nameFilter}
              nodes={nodes}
              allNodes={isSelectAllNodesChecked}
              statuses={statusFilter}
              statusFilterType={statusFilterType}
              pod_ip={podIp}
              selectedTask={localView === ViewType.List ? selectedTask : undefined}
              visible={localView === ViewType.List}
              verbose={verbose}
              updateUrl={updateUrl}
            />
          </div>
        </div>
        <SlideOut
          animate={true}
          canClose={localView !== ViewType.SingleTask}
          canPin={localView !== ViewType.SingleTask}
          pinned={localView === ViewType.SingleTask || taskPinned}
          paused={!!activeTool}
          onPinChange={(pinned) => {
            setTaskPinned(pinned);
            localStorage.setItem(TASK_PINNED_KEY, pinned.toString());
          }}
          id={"task-details"}
          header="Task Details"
          aria-label={`Task Details for ${selectedTaskName}`}
          open={!!selectedTask}
          onClose={() => {
            updateUrl({ task: null });
          }}
          className={`body-component ${localView === ViewType.SingleTask ? "h-full overflow-y-auto grow" : "workflow-details-slideout"}`}
          headerClassName="brand-header"
          bodyClassName="dag-details-body"
        >
          {selectedTask && (
            <TaskDetails
              task={selectedTask}
              updateUrl={updateUrl}
              hasNavigation={localView === ViewType.SingleTask && !forceSingleTaskView}
              onNext={onNextTask}
              onPrevious={onPreviousTask}
              hasNext={!!nextTask}
              hasPrevious={!!previousTask}
            />
          )}
        </SlideOut>
      </div>
      <ToolsModal
        tool={activeTool}
        workflow={selectedWorkflow.data}
        selectedTask={selectedTask}
        fullLog={fullLog}
        lines={lines}
        verbose={verbose}
        updateUrl={updateUrl}
      />
    </>
  );
}
