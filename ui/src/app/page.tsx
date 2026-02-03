//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { ResourcesGraph } from "~/app/resources/components/ResourceGraph";
import { useAuth } from "~/components/AuthProvider";
import { allDateRange } from "~/components/DateRangePicker";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import PageHeader from "~/components/PageHeader";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilterType } from "~/components/UserFilter";
import { PoolsListResponseSchema, type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import { calcAggregateTotals, calcResourceUsages } from "./resources/components/utils";
import { TasksFilters, type TasksFiltersDataProps } from "./tasks/components/TasksFilters";
import { TasksWidget, type TaskWidgetDataProps } from "./widgets/tasks";
import { WorkflowsWidget, type WorkflowWidgetDataProps } from "./widgets/workflows";
import { WorkflowsFilters, type WorkflowsFiltersDataProps } from "./workflows/components/WorkflowsFilters";

interface WidgetDataProps {
  workflows: WorkflowWidgetDataProps[];
  tasks: TaskWidgetDataProps[];
  allPools: boolean;
  pools: string[];
}

export default function Home() {
  const currentDays = 365;
  const { username } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [widgetName, setWidgetName] = useState("");
  const [widgetDescription, setWidgetDescription] = useState("");
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());
  const [allPools, setAllPools] = useState(true);
  const [editingWorkflowWidget, setEditingWorkflowWidget] = useState<WorkflowWidgetDataProps | undefined>(undefined);
  const [editingTaskWidget, setEditingTaskWidget] = useState<TaskWidgetDataProps | undefined>(undefined);
  const [editingPool, setEditingPool] = useState(false);

  const createWidgetId = () => crypto.randomUUID();
  const [widgets, setWidgets] = useState<WidgetDataProps>({
    workflows: [],
    tasks: [],
    allPools: true,
    pools: [],
  });
  const updateWidgets = (updater: WidgetDataProps | ((prev: WidgetDataProps) => WidgetDataProps)) => {
    setWidgets((prevWidgets) => {
      const nextWidgets = typeof updater === "function" ? updater(prevWidgets) : updater;

      localStorage.setItem("widgets", JSON.stringify(nextWidgets));

      return nextWidgets;
    });
  };

  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });

  const pools = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const {
    data: resources,
    isFetching: isResourcesFetching,
    isSuccess: isResourcesSuccess,
    refetch: refetchResources,
  } = api.resources.listResources.useQuery(
    {
      all_pools: widgets.allPools,
      pools: widgets.allPools ? [] : widgets.pools,
    },
    {
      refetchOnWindowFocus: false,
    },
  );

  const processResources = useMemo(() => {
    if (!isResourcesSuccess) {
      return [];
    }

    return calcResourceUsages(resources);
  }, [resources, isResourcesSuccess]);

  const aggregateTotals = useMemo(() => calcAggregateTotals(processResources), [processResources]);

  const onSaveWorkflowWidget = (data: WorkflowsFiltersDataProps) => {
    if (!editingWorkflowWidget) {
      return;
    }
    updateWidgets((prevWidgets) => ({
      ...prevWidgets,
      workflows: prevWidgets.workflows.map((widget) =>
        widget.id === editingWorkflowWidget.id
          ? {
              id: editingWorkflowWidget.id,
              name: widgetName,
              description: widgetDescription,
              filters: data,
            }
          : widget,
      ),
    }));
    setEditingWorkflowWidget(undefined);
  };

  const onSaveTaskWidget = (data: TasksFiltersDataProps) => {
    if (!editingTaskWidget) {
      return;
    }
    updateWidgets((prevWidgets) => ({
      ...prevWidgets,
      tasks: prevWidgets.tasks.map((widget) =>
        widget.id === editingTaskWidget.id
          ? {
              id: editingTaskWidget.id,
              name: widgetName,
              description: widgetDescription,
              filters: data,
            }
          : widget,
      ),
    }));
    setEditingTaskWidget(undefined);
  };

  useEffect(() => {
    const parsedData = PoolsListResponseSchema.safeParse(pools.data);
    const availablePools = parsedData.success ? parsedData.data.pools : [];

    const filters = new Map<string, boolean>(Object.keys(availablePools).map((pool) => [pool, false]));

    if (widgets.pools.length) {
      widgets.pools.forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [pools.data, widgets.pools]);

  useEffect(() => {
    const storedWidgets = localStorage.getItem("widgets");

    if (storedWidgets !== null) {
      updateWidgets(JSON.parse(storedWidgets) as WidgetDataProps);
    } else {
      updateWidgets({
        workflows: [
          {
            id: createWidgetId(),
            name: "Current Workflows",
            description: "Current Workflows for the current user",
            filters: {
              userType: UserFilterType.CURRENT,
              selectedUsers: username,
              isSelectAllPoolsChecked: true,
              selectedPools: "",
              dateRange: -2,
              statusFilterType: StatusFilterType.CURRENT,
              name: "",
            },
          },
          {
            id: createWidgetId(),
            name: "Today's Workflows",
            description: "Workflows for current user for the last 365 days",
            filters: {
              userType: UserFilterType.CURRENT,
              selectedUsers: username,
              isSelectAllPoolsChecked: true,
              selectedPools: "",
              dateRange: 365,
              statusFilterType: StatusFilterType.ALL,
              name: "",
            },
          },
          {
            id: createWidgetId(),
            name: "Low Priority Workflows",
            description: "Low Priority Workflows for all users in the last 7 days",
            filters: {
              userType: UserFilterType.ALL,
              selectedUsers: "",
              isSelectAllPoolsChecked: true,
              selectedPools: "",
              dateRange: 7,
              statusFilterType: StatusFilterType.ALL,
              name: "",
              priority: "LOW",
            },
          },
        ],
        tasks: [
          {
            id: createWidgetId(),
            name: "Current Tasks",
            description: "Current Tasks for the current user",
            filters: {
              userType: UserFilterType.CURRENT,
              selectedUsers: username,
              isSelectAllPoolsChecked: true,
              selectedPools: "",
              dateRange: allDateRange,
              statusFilterType: StatusFilterType.CURRENT,
            },
          },
          {
            id: createWidgetId(),
            name: "Today's Tasks",
            description: "Tasks for current user for the last 365 days",
            filters: {
              userType: UserFilterType.CURRENT,
              selectedUsers: username,
              isSelectAllPoolsChecked: true,
              selectedPools: "",
              dateRange: currentDays,
              statusFilterType: StatusFilterType.ALL,
            },
          },
        ],
        allPools: true,
        pools: [profile?.profile.pool ?? ""],
      });
    }
  }, [username, currentDays, profile?.profile.pool]);

  return (
    <>
      <PageHeader>
        <IconButton
          icon="edit"
          text="Edit"
          className={`btn ${isEditing ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setIsEditing(!isEditing)}
        />
      </PageHeader>
      <div className="h-full w-full flex justify-center items-baseline">
        <div className="flex flex-col md:grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6 gap-global p-global">
          {widgets.workflows.map((widget) => (
            <WorkflowsWidget
              key={widget.name}
              widget={widget}
              onEdit={(widget) => {
                setEditingWorkflowWidget(widget);
                setWidgetName(widget.name);
                setWidgetDescription(widget.description ?? "");
                setEditingTaskWidget(undefined);
              }}
              onDelete={setEditingWorkflowWidget}
              isEditing={isEditing}
            />
          ))}
          {widgets.tasks.map((widget) => (
            <TasksWidget
              key={widget.id}
              widget={widget}
              onEdit={(widget) => {
                setEditingTaskWidget(widget);
                setWidgetName(widget.name);
                setWidgetDescription(widget.description ?? "");
                setEditingWorkflowWidget(undefined);
              }}
              onDelete={(widget) => {
                setEditingTaskWidget(undefined);
                setEditingWorkflowWidget(undefined);
              }}
              isEditing={isEditing}
            />
          ))}
          {aggregateTotals.byPool &&
            Object.entries(aggregateTotals.byPool).map(([pool, totals]) => (
              <section
                key={pool}
                className="card"
                aria-labelledby={pool}
              >
                <div className="popup-header body-header">
                  <h2 id={pool}>{pool}</h2>
                  {isEditing ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setEditingWorkflowWidget(undefined);
                        setEditingTaskWidget(undefined);
                        setEditingPool(true);
                      }}
                    >
                      <OutlinedIcon name="edit" />
                    </button>
                  ) : (
                    <div className="flex flex-row gap-global">
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          void refetchResources();
                        }}
                        title="Refresh"
                      >
                        <OutlinedIcon name="refresh" />
                      </button>
                      <Link
                        href={`/resources?pools=${pool}`}
                        className="btn btn-secondary"
                        title={`View Resources for ${pool}`}
                      >
                        <OutlinedIcon name="list_alt" />
                      </Link>
                    </div>
                  )}
                </div>
                <ResourcesGraph
                  {...totals}
                  isLoading={isResourcesFetching}
                  isShowingUsed={false}
                  width={200}
                  height={150}
                />
              </section>
            ))}
          <section className="card p-global">
            <button
              className="btn btn-secondary border-dashed w-full h-full justify-center items-center text-[10rem] opacity-30 hover:opacity-100 hover:cursor-pointer focus:opacity-100"
              aria-label="Add Widget"
            >
              <OutlinedIcon
                name="add"
                className="text-[7rem]!"
              />
            </button>
          </section>
        </div>
      </div>
      <FullPageModal
        open={!!editingWorkflowWidget || !!editingTaskWidget || editingPool}
        onClose={() => {
          setEditingWorkflowWidget(undefined);
          setEditingTaskWidget(undefined);
          setEditingPool(false);
        }}
        headerChildren={<h2 id="edit-header">{editingWorkflowWidget ? "Edit Workflow" : "Edit Task"}</h2>}
        aria-labelledby="edit-header"
        size="md"
      >
        <TextInput
          id="widget-name"
          label="Name"
          helperText="Name of the widget (unique)"
          className="w-full"
          required
          containerClassName="w-full p-global"
          value={widgetName}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setWidgetName(event.target.value);
          }}
        />
        <TextInput
          id="widget-description"
          label="Description"
          helperText="Optional"
          className="w-full"
          containerClassName="w-full p-global"
          value={widgetDescription}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setWidgetDescription(event.target.value);
          }}
        />
        {editingPool ? (
          <div className="p-global">
            <MultiselectWithAll
              id="pools"
              label="All Pools"
              placeholder="Filter by pool name..."
              aria-label="Filter by pool name"
              filter={localPools}
              setFilter={setLocalPools}
              onSelectAll={setAllPools}
              isSelectAllChecked={allPools}
              showAll
            />
          </div>
        ) : editingWorkflowWidget ? (
          <WorkflowsFilters
            hideNameFilter={true}
            name={""}
            userType={editingWorkflowWidget.filters.userType}
            selectedUsers={editingWorkflowWidget.filters.selectedUsers}
            selectedPools={editingWorkflowWidget.filters.selectedPools}
            dateRange={editingWorkflowWidget.filters.dateRange}
            statusFilterType={editingWorkflowWidget.filters.statusFilterType}
            submittedAfter={editingWorkflowWidget.filters.submittedAfter}
            submittedBefore={editingWorkflowWidget.filters.submittedBefore}
            isSelectAllPoolsChecked={editingWorkflowWidget.filters.isSelectAllPoolsChecked}
            currentUserName={username}
            priority={editingWorkflowWidget.filters.priority}
            onSave={onSaveWorkflowWidget}
            saveButtonText="Save"
            saveButtonIcon="save"
          />
        ) : editingTaskWidget ? (
          <TasksFilters
            userType={editingTaskWidget.filters.userType}
            selectedUsers={editingTaskWidget.filters.selectedUsers}
            dateRange={editingTaskWidget.filters.dateRange}
            startedAfter={editingTaskWidget.filters.startedAfter}
            startedBefore={editingTaskWidget.filters.startedBefore}
            statusFilterType={editingTaskWidget.filters.statusFilterType}
            statuses={editingTaskWidget.filters.statuses}
            selectedPools={editingTaskWidget.filters.selectedPools}
            isSelectAllPoolsChecked={editingTaskWidget.filters.isSelectAllPoolsChecked}
            currentUserName={username}
            isSelectAllNodesChecked={true}
            nodes=""
            workflowId=""
            onSave={onSaveTaskWidget}
            saveButtonText="Save"
            saveButtonIcon="save"
          />
        ) : undefined}
      </FullPageModal>
    </>
  );
}
