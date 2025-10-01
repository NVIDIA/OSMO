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
import { ReactFlowProvider } from "reactflow";

import { PoolDetails } from "~/app/pools/components/PoolDetails";
import { useAuth } from "~/components/AuthProvider";
import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import StatusBadge from "~/components/StatusBadge";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const {
    updateUrl,
    tool,
    fullLog,
    lines,
    view,
    statusFilter,
    allStatuses,
    nameFilter,
    nodes,
    isSelectAllNodesChecked,
    podIp,
    filterCount,
    showWF,
    selectedTaskName,
    retryId,
    selectedPool,
    selectedPlatform,
  } = useToolParamUpdater(UrlTypes.Workflows, username, { showWF: "true", allStatuses: "true", status: "" });
  const selectedWorkflow = useWorkflow(params.name, true, 2);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ToolType | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const availableNodes = useMemo(
    () =>
      selectedWorkflow.data?.groups
        .flatMap((group) => group.tasks.map((task) => task.node_name ?? ""))
        .filter((node) => node.length > 0) ?? [],
    [selectedWorkflow.data],
  );

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
    if (selectedTaskName) {
      setSelectedTask(
        selectedWorkflow.data?.groups
          ?.find((g) =>
            g.tasks.some((t) => t.name === selectedTaskName && (retryId === undefined || t.retry_id === retryId)),
          )
          ?.tasks.find((t) => t.name === selectedTaskName && (retryId === undefined || t.retry_id === retryId)),
      );
    } else {
      setSelectedTask(undefined);
    }
  }, [selectedWorkflow?.data, selectedTaskName, retryId]);

  const gridClass = useMemo(() => {
    if (showWF && (selectedTask ?? selectedPool) && taskPinned) {
      return "grid grid-cols-[auto_1fr_auto]";
    } else if (showWF) {
      return "grid grid-cols-[auto_1fr]";
    } else if (taskPinned && (selectedTask ?? selectedPool)) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [showWF, selectedTask, selectedPool, taskPinned]);

  const verbose = useMemo(() => {
    const tasks = (selectedWorkflow.data?.groups ?? []).flatMap((group) => group.tasks);
    return tasks.some((task: Task) => task.retry_id && task.retry_id > 0);
  }, [selectedWorkflow.data]);

  const validateFilters = useCallback((props: TasksFiltersDataProps) => {
    const errors: string[] = [];
    if (!props.allNodes && props.nodes.length === 0) {
      errors.push("Please select at least one node");
    }
    if (!props.allStatuses && props.statuses.length === 0) {
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

  if (!selectedWorkflow.data) {
    return (
      <div className="h-full flex justify-center items-center">
        <Spinner
          description="Generating Overview..."
          size="large"
        />
      </div>
    );
  }

  return (
    <>
      <div
        className="page-header mb-3 flex items-center text-center gap-3"
        ref={headerRef}
      >
        <button
          className={`btn ${showWF ? "btn-primary" : ""}`}
          onClick={() => {
            updateUrl({ showWF: !showWF });
          }}
          aria-pressed={showWF}
        >
          <StatusBadge
            status={selectedWorkflow.data.status}
            compact
          />
          Workflow
          <FilledIcon name="more_vert" />
        </button>
        <div className="flex items-center gap-1">
          {workflowNameParts && workflowNameParts.id > 1 ? (
            <Link
              className="no-underline"
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
              className="text-lg! opacity-50 mx-1"
            />
          )}
          <h1>{params.name}</h1>
          {workflowNameParts && (
            <Link
              className="no-underline"
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
        <div className="flex items-center gap-3">
          <fieldset
            className="flex flex-row gap-3"
            aria-label="View Type"
          >
            <ViewToggleButton
              name="list"
              checked={view === ViewType.List}
              onChange={() => updateUrl({ view: ViewType.List })}
            >
              <FilledIcon name="list" />
              List
            </ViewToggleButton>
            <ViewToggleButton
              name="graph"
              checked={view === ViewType.Graph}
              onChange={() => updateUrl({ view: ViewType.Graph })}
            >
              <FilledIcon name="border_clear" />
              Graph
            </ViewToggleButton>
          </fieldset>
          <button
            className={`btn ${showFilters ? "btn-primary" : ""}`}
            onClick={() => {
              setShowFilters(!showFilters);
            }}
          >
            <FilledIcon name="filter_list" />
            Filters {filterCount > 0 ? `(${filterCount})` : ""}
          </button>
        </div>
        <SlideOut
          top={headerRef.current?.offsetHeight ?? 0}
          containerRef={headerRef}
          id="tasks-filter"
          open={showFilters}
          onClose={() => {
            setShowFilters(false);
          }}
          aria-label="Tasks Filter"
          className="z-20 border-t-0 w-100"
          dimBackground={false}
        >
          <TasksFilter
            name={nameFilter}
            nodes={nodes}
            allNodes={isSelectAllNodesChecked ?? true}
            statuses={statusFilter ?? ""}
            allStatuses={allStatuses ?? true}
            pod_ip={podIp}
            availableNodes={availableNodes}
            updateUrl={updateUrl}
            validateFilters={validateFilters}
          />
        </SlideOut>
      </div>
      <div
        ref={containerRef}
        className={`${gridClass} h-full w-full overflow-x-auto relative px-3 gap-3`}
      >
        {showWF && (
          <div
            className="workflow-details-slideout flex flex-col relative overflow-y-auto body-component"
            style={{
              maxHeight: `calc(100vh - ${10 + (containerRef?.current?.getBoundingClientRect()?.top ?? 0)}px)`,
            }}
          >
            <div className={`popup-header sticky top-0 z-10 brand-header`}>
              <h2>Workflow Details</h2>
              <button
                className="btn btn-action"
                aria-label="Close"
                onClick={() => {
                  updateUrl({ showWF: false });
                }}
              >
                <OutlinedIcon name="close" />
              </button>
            </div>
            <div className="dag-details-body">
              <WorkflowDetails
                workflow={selectedWorkflow.data}
                updateUrl={updateUrl}
              />
            </div>
          </div>
        )}
        <div className="h-full w-full">
          <div className={`h-full w-full p-3 ${view === ViewType.Graph ? "block" : "hidden"}`}>
            {selectedWorkflow.data?.groups?.length > 0 ? (
              <ReactFlowProvider>
                <DirectedAcyclicGraph
                  workflow={selectedWorkflow.data}
                  refetch={selectedWorkflow.refetch}
                  selectedTask={selectedTask}
                  visible={view === ViewType.Graph}
                  updateUrl={updateUrl}
                />
              </ReactFlowProvider>
            ) : (
              <div className="flex items-center justify-center h-full w-full">
                <p
                  className="text-center"
                  aria-live="polite"
                >
                  No tasks found
                </p>
              </div>
            )}
          </div>
          <div className={`h-full w-full ${view === ViewType.List ? "block" : "hidden"}`}>
            <TasksTable
              workflow={selectedWorkflow.data}
              name={nameFilter}
              nodes={nodes}
              allNodes={isSelectAllNodesChecked}
              statuses={statusFilter}
              allStatuses={allStatuses}
              pod_ip={podIp}
              selectedTask={view === ViewType.List ? selectedTask : undefined}
              visible={view === ViewType.List}
              verbose={verbose}
              updateUrl={updateUrl}
            />
          </div>
        </div>
        <SlideOut
          canPin
          containerRef={containerRef}
          heightOffset={10}
          pinned={taskPinned}
          paused={!!activeTool}
          onPinChange={(pinned) => {
            setTaskPinned(pinned);
            localStorage.setItem(TASK_PINNED_KEY, pinned.toString());
          }}
          id={"task-details"}
          header={selectedPool ? <h2>{selectedPool}</h2> : "Task Details"}
          open={!!selectedTask || !!selectedPool}
          onClose={() => {
            if (selectedPool) {
              updateUrl({ selectedPool: null, selectedPlatform: null });
            } else {
              updateUrl({ task: null });
            }
          }}
          className="workflow-details-slideout"
          headerClassName="brand-header"
          bodyClassName="dag-details-body"
        >
          {selectedPool ? (
            <PoolDetails
              selectedPool={selectedPool}
              selectedPlatform={selectedPlatform}
              isShowingUsed={false}
              onShowPlatformDetails={(platform) => updateUrl({ selectedPlatform: platform })}
            />
          ) : (
            selectedTask && (
              <TaskDetails
                task={selectedTask}
                updateUrl={updateUrl}
              />
            )
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
