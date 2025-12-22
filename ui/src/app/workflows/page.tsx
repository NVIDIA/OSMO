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
import { FilterButton } from "~/components/FilterButton";
import { FilledIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import { StatusFilterType } from "~/components/StatusFilter";
import { UrlTypes, WORKFLOW_PINNED_KEY } from "~/components/StoreProvider";
import { UserFilterType } from "~/components/UserFilter";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { type WorkflowStatusType, type Task, type WorkflowListItem } from "~/models";
import { api } from "~/trpc/react";

import { getWorkflowStatusArray } from "./components/StatusFilter";
import { ToolsModal } from "./components/ToolsModal";
import WorkflowDetails from "./components/WorkflowDetails";
import { useWorkflow } from "./components/WorkflowLoader";
import { WorkflowsFilters, type WorkflowsFiltersDataProps } from "./components/WorkflowsFilters";
import { getActionId, WorkflowsTable } from "./components/WorkflowsTable";
import useToolParamUpdater, { type ToolType } from "./hooks/useToolParamUpdater";

export default function Workflows() {
  const { username } = useAuth();
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
    dateRangeDates,
    selectedTaskName,
    retryId,
  } = useToolParamUpdater(UrlTypes.Workflows, username, {
    statusFilterType: StatusFilterType.ALL,
    dateRange: defaultDateRange.toString(),
  });
  const lastFetchTimeRef = useRef<number>(Date.now());
  const [workflowPinned, setWorkflowPinned] = useState(false);
  const selectedWorkflow = useWorkflow(selectedWorkflowName, true, false);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);
  const [activeTool, setActiveTool] = useState<ToolType | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);
  const focusReturnIdRef = useRef<string | undefined>(undefined);
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
      isSelectAllPoolsChecked,
      selectedPools,
      dateRange,
      submittedAfter,
      submittedBefore,
      statusFilterType,
      statuses,
    }: WorkflowsFiltersDataProps): string[] => {
      const errors: string[] = [];
      if (!isSelectAllPoolsChecked && selectedPools.length === 0) {
        errors.push("Please select at least one pool");
      }
      if (dateRange === customDateRange && (submittedAfter === undefined || submittedBefore === undefined)) {
        errors.push("Please select a date range");
      }
      if (statusFilterType === StatusFilterType.CUSTOM && !statuses?.length) {
        errors.push("Please select at least one status");
      }
      return errors;
    },
    [],
  );

  // Show filters if the params are not valid
  useEffect(() => {
    if (statusFilterType === undefined) {
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
      statusFilterType,
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
    statusFilterType,
    statusFilter,
    validateFilters,
    updateUrl,
  ]);
  const { setSafeTimeout } = useSafeTimeout();

  const gridClass = useMemo(() => {
    if (workflowPinned && selectedWorkflowName) {
      return "grid grid-cols-[1fr_auto]";
    } else {
      return "flex flex-row";
    }
  }, [workflowPinned, selectedWorkflowName]);

  useEffect(() => {
    if (selectedWorkflowName) {
      focusReturnIdRef.current = getActionId(selectedWorkflowName);
    }
  }, [selectedWorkflowName]);

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
      statuses:
        statusFilterType === StatusFilterType.CUSTOM
          ? (statusFilter?.split(",") as WorkflowStatusType[])
          : getWorkflowStatusArray(statusFilterType),
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
      <PageHeader>
        <Link
          className="btn"
          aria-label="Submit Workflow"
          href="/workflows/submit"
        >
          <FilledIcon name="send" />
          <span className="hidden lg:block">Submit Workflow</span>
        </Link>
        <FilterButton
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterCount={filterCount}
          aria-controls="workflows-filters"
        />
      </PageHeader>
      <div className={`${gridClass} h-full w-full overflow-hidden relative`}>
        <SlideOut
          id="workflows-filters"
          open={showFilters}
          onClose={() => setShowFilters(false)}
          className="w-100 border-t-0"
          aria-label="Workflows Filter"
        >
          <WorkflowsFilters
            selectedUsers={userFilter ?? ""}
            userType={userType}
            dateRange={dateRange}
            submittedAfter={dateAfterFilter}
            submittedBefore={dateBeforeFilter}
            statusFilterType={statusFilterType}
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
        <WorkflowsTable
          processResources={processResources}
          isLoading={isFetching}
          selectedWorkflowName={selectedWorkflowName}
          updateUrl={updateUrl}
        />
        <SlideOut
          animate={true}
          header={
            selectedWorkflowName && (
              <Link
                id="workflow-details-header"
                className="btn btn-action"
                href={`/workflows/${selectedWorkflowName}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Workflow Details for ${selectedWorkflowName} - Open in new tab`}
              >
                <span className="font-semibold">Workflow Details</span>
                <FilledIcon name="open_in_new" />
              </Link>
            )
          }
          id="workflow-details"
          open={!!selectedWorkflowName}
          onClose={() => {
            setSafeTimeout(() => {
              // focus-trap-react does not work well with useReactTable as the ref for button inside the table that triggered the slideout is not persistent
              const el = focusReturnIdRef.current ? document.getElementById(focusReturnIdRef.current) : undefined;
              el?.focus();
            }, 500);
            updateUrl({ workflow: null });
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
          ariaLabel={`Workflow Details for ${selectedWorkflowName}`}
        >
          {selectedWorkflow.isLoading ? (
            <div className="flex justify-center items-center h-full w-full">
              <Spinner description="Loading workflow..." />
            </div>
          ) : selectedWorkflow.error ? (
            <PageError
              title="Error loading workflow"
              errorMessage={selectedWorkflow.error.message}
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
