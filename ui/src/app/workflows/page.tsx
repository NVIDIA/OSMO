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
import { customDateRange, defaultDateRange } from "~/components/DateRangePicker";
import { FilledIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import { UrlTypes, WORKFLOW_PINNED_KEY } from "~/components/StoreProvider";
import { UserFilterType } from "~/components/UserFilter";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type Task, type WorkflowListItem } from "~/models";
import { api } from "~/trpc/react";

import { ToolsModal } from "./components/ToolsModal";
import WorkflowDetails from "./components/WorkflowDetails";
import { useWorkflow } from "./components/WorkflowLoader";
import { WorkflowsFilters, type WorkflowsFiltersDataProps } from "./components/WorkflowsFilters";
import { WorkflowsTable } from "./components/WorkflowsTable";
import useToolParamUpdater, { type ToolType } from "./hooks/useToolParamUpdater";
import { PoolDetails } from "../pools/components/PoolDetails";

export default function Workflows() {
  const { username } = useAuth();
  const {
    updateUrl,
    userFilter,
    poolFilter,
    statusFilter,
    allStatuses,
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
    dateRangeDates,
    selectedTaskName,
    retryId,
    selectedPool,
    selectedPlatform,
  } = useToolParamUpdater(UrlTypes.Workflows, username, {
    allStatuses: "true",
    status: "",
    dateRange: defaultDateRange.toString(),
  });
  const headerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFetchTimeRef = useRef<number>(Date.now());
  const [workflowPinned, setWorkflowPinned] = useState(false);
  const selectedWorkflow = useWorkflow(selectedWorkflowName, true, false);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ToolType | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  // focus trap onDeacticate is happening in the DOM and state is not reliable - use ref instead
  const detailsContext = useRef<"pool" | "workflow" | null>(null);

  // Initialize localStorage values after component mounts
  useEffect(() => {
    try {
      const storedWorkflowPinned = localStorage.getItem(WORKFLOW_PINNED_KEY);
      if (storedWorkflowPinned !== null) {
        setWorkflowPinned(storedWorkflowPinned === "true");
      }
    } catch (error) {
      // localStorage might not be available in some environments
      console.warn("localStorage not available:", error);
    }
  }, []);

  useEffect(() => {
    if (selectedWorkflow.data) {
      setActiveTool(tool);
    }
  }, [selectedWorkflow.data, tool]);

  // Set detailsContext when the slideout opens; don't clear it on close so onClose can use a stable value
  useEffect(() => {
    detailsContext.current = selectedPool ? "pool" : selectedWorkflowName ? "workflow" : null;
  }, [selectedPool, selectedWorkflowName]);

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
  }, [selectedWorkflow.data, selectedTaskName, retryId]);

  const validateFilters = useCallback(
    ({
      selectedUsers,
      userType,
      isSelectAllPoolsChecked,
      selectedPools,
      dateRange,
      submittedAfter,
      submittedBefore,
      allStatuses,
      statuses,
    }: WorkflowsFiltersDataProps): string[] => {
      const errors: string[] = [];
      if (selectedUsers.length === 0 && userType !== UserFilterType.ALL) {
        errors.push("Please select at least one user");
      }
      if (!isSelectAllPoolsChecked && selectedPools.length === 0) {
        errors.push("Please select at least one pool");
      }
      if (dateRange === customDateRange && (submittedAfter === undefined || submittedBefore === undefined)) {
        errors.push("Please select a date range");
      }
      if (!allStatuses && !statuses?.length) {
        errors.push("Please select at least one status");
      }
      return errors;
    },
    [],
  );

  // Show filters if the params are not valid
  useEffect(() => {
    if (allStatuses === undefined || statusFilter === undefined) {
      return; // Params not read yet
    }

    const errors = validateFilters({
      userType,
      isSelectAllPoolsChecked,
      selectedUsers: userFilter ?? "",
      selectedPools: poolFilter,
      dateRange,
      submittedAfter: dateAfterFilter,
      submittedBefore: dateBeforeFilter,
      name: nameFilter,
      allStatuses: allStatuses,
      statuses: statusFilter,
    });

    if (errors.length > 0) {
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
    nameFilter,
    allStatuses,
    statusFilter,
    validateFilters,
    updateUrl,
  ]);
  const { setSafeTimeout } = useSafeTimeout();

  const gridClass = useMemo(() => {
    if (workflowPinned && (selectedWorkflowName ?? selectedPool)) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [workflowPinned, selectedWorkflowName, selectedPool]);

  const {
    data: workflows,
    isSuccess,
    isFetching,
    refetch,
  } = api.workflows.getList.useQuery(
    {
      all_users: userType === UserFilterType.ALL,
      users: userType === UserFilterType.CUSTOM ? (userFilter?.split(",") ?? []) : [],
      all_pools: isSelectAllPoolsChecked,
      pools: isSelectAllPoolsChecked ? [] : poolFilter.split(","),
      submitted_after: dateRangeDates?.fromDate?.toISOString(),
      submitted_before: dateRangeDates?.toDate?.toISOString(),
      statuses: allStatuses ? [] : (statusFilter?.split(",") ?? []),
      name: nameFilter,
      priority: priority,
    },
    {
      refetchOnWindowFocus: false,
      onSuccess: () => {
        lastFetchTimeRef.current = Date.now();
      },
    },
  );

  const processResources = useMemo((): WorkflowListItem[] => {
    // Can't pass workflows?.data ?? [] to useReactTable or it causes infinite loops and hangs the page
    // See https://github.com/TanStack/table/issues/4566
    // Momoizing it so that it does not get a new instance of [] every time fixes it
    if (!isSuccess) {
      return [];
    }

    return workflows ?? [];
  }, [workflows, isSuccess]);

  const forceRefetch = useCallback(() => {
    // Wait to see if the refresh has already happened. If not call it explicitly
    const lastFetchTime = lastFetchTimeRef.current;

    setSafeTimeout(() => {
      if (!isFetching && lastFetchTimeRef.current === lastFetchTime) {
        void refetch();
      }
    }, 500);
  }, [refetch, isFetching, setSafeTimeout]);

  return (
    <>
      <div
        className="page-header mb-3"
        ref={headerRef}
      >
        <h1>Workflows</h1>
        <div className="flex items-center gap-3">
          <Link
            className="btn btn-primary"
            href="/workflows/submit"
          >
            Submit a Workflow
          </Link>
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
          id="workflows-filters"
          open={showFilters}
          onClose={() => setShowFilters(false)}
          className="w-100 border-t-0"
          containerRef={headerRef}
          top={headerRef.current?.getBoundingClientRect().top ?? 0}
          dimBackground={false}
        >
          <WorkflowsFilters
            selectedUsers={userFilter ?? ""}
            userType={userType}
            dateRange={dateRange}
            submittedAfter={dateAfterFilter}
            submittedBefore={dateBeforeFilter}
            allStatuses={allStatuses ?? true}
            statuses={statusFilter ?? ""}
            selectedPools={poolFilter}
            isSelectAllPoolsChecked={isSelectAllPoolsChecked}
            name={nameFilter}
            currentUserName={username}
            onRefresh={forceRefetch}
            validateFilters={validateFilters}
            priority={priority}
            updateUrl={updateUrl}
          />
        </SlideOut>
      </div>
      <div
        ref={containerRef}
        className={`${gridClass} h-full w-full overflow-x-auto relative px-3 gap-3`}
      >
        <WorkflowsTable
          processResources={processResources}
          isLoading={isFetching}
          selectedWorkflowName={selectedWorkflowName}
          updateUrl={updateUrl}
        />
        <SlideOut
          header={
            <>
              {selectedPool ? (
                <h2>{selectedPool}</h2>
              ) : (
                selectedWorkflowName && (
                  <Link
                    id="workflow-details-header"
                    className="btn btn-action"
                    href={`/workflows/${selectedWorkflowName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in new tab"
                  >
                    <span className="font-semibold">Workflow Details</span>
                    <FilledIcon name="open_in_new" />
                  </Link>
                )
              )}
            </>
          }
          id="details-slideout"
          open={!!selectedWorkflowName || !!selectedPool}
          onClose={() => {
            if (!workflowPinned) {
              updateUrl({ selectedPool: null, selectedPlatform: null, workflow: null });
            } else if (detailsContext.current === "pool") {
              updateUrl({ selectedPool: null, selectedPlatform: null });
            } else {
              updateUrl({ workflow: null });
            }
          }}
          canPin={true}
          pinned={workflowPinned}
          onPinChange={(pinned) => {
            setWorkflowPinned(pinned);
            localStorage.setItem(WORKFLOW_PINNED_KEY, pinned.toString());
          }}
          className="workflow-details-slideout border-t-0"
          headerClassName="brand-header"
          bodyClassName="dag-details-body"
          containerRef={containerRef}
          heightOffset={10}
        >
          {selectedPool ? (
            <PoolDetails
              selectedPool={selectedPool}
              selectedPlatform={selectedPlatform}
              isShowingUsed={false}
              onShowPlatformDetails={(platform) => updateUrl({ selectedPlatform: platform })}
            />
          ) : selectedWorkflow.isLoading ? (
            <div className="flex justify-center items-center h-full">
              <Spinner description="Loading workflow..." />
            </div>
          ) : selectedWorkflow.error ? (
            <PageError
              title="Error loading workflow"
              errorMessage={selectedWorkflow.error.message}
              subText={selectedWorkflowName}
              size="md"
            />
          ) : selectedWorkflow.data ? (
            <WorkflowDetails
              workflow={selectedWorkflow.data}
              includeName
              includeTasks
              updateUrl={updateUrl}
            />
          ) : undefined}
        </SlideOut>
      </div>
      <ToolsModal
        workflow={selectedWorkflow.data}
        tool={activeTool}
        fullLog={fullLog}
        lines={lines}
        selectedTask={selectedTask}
        verbose={false}
        updateUrl={updateUrl}
      />
    </>
  );
}
