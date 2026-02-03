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

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { ResourcesGraph } from "~/app/resources/components/ResourceGraph";
import { useAuth } from "~/components/AuthProvider";
import { allDateRange } from "~/components/DateRangePicker";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import { InlineBanner } from "~/components/InlineBanner";
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import PageHeader from "~/components/PageHeader";
import { Select } from "~/components/Select";
import { SlideOut } from "~/components/SlideOut";
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

const NEW_DASHBOARD_NAME = "-- Create New Dashboard --";

interface Dashboard {
  workflows: WorkflowWidgetDataProps[];
  tasks: TaskWidgetDataProps[];
  allPools: boolean;
  pools: string[];
}

interface DashboardList {
  widgets: Record<string, Dashboard>;
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
  const [dashboardName, setDashboardName] = useState("default");
  const [showNewDashboard, setShowNewDashboard] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [newDashboardNameError, setNewDashboardNameError] = useState<string | undefined>(undefined);

  const createWidgetId = () => crypto.randomUUID();
  const [dashboards, setDashboards] = useState<DashboardList>({
    widgets: {},
  });

  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });

  const emptyDashboard = useMemo<Dashboard>(
    () => ({
      workflows: [],
      tasks: [],
      allPools: false,
      pools: [],
    }),
    [],
  );

  const defaultDashboard = useMemo<Dashboard>(
    () => ({
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
      allPools: false,
      pools: profile?.profile.pool ? [profile.profile.pool] : [],
    }),
    [currentDays, profile?.profile.pool, username],
  );

  const currentDashboard = useMemo(() => {
    return dashboards.widgets[dashboardName] ?? emptyDashboard;
  }, [dashboards.widgets, dashboardName, emptyDashboard]);

  const persistDashboards = (nextDashboards: DashboardList) => {
    localStorage.setItem("widgets", JSON.stringify(nextDashboards));
  };

  const updateCurrentDashboard = useCallback(
    (updater: Dashboard | ((prev: Dashboard) => Dashboard)) => {
      setDashboards((prevDashboards) => {
        const prevDashboard = prevDashboards.widgets[dashboardName] ?? emptyDashboard;
        const nextDashboard = typeof updater === "function" ? updater(prevDashboard) : updater;
        const nextDashboards = {
          ...prevDashboards,
          widgets: {
            ...prevDashboards.widgets,
            [dashboardName]: nextDashboard,
          },
        };

        persistDashboards(nextDashboards);
        return nextDashboards;
      });
    },
    [dashboardName, emptyDashboard],
  );

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
      all_pools: currentDashboard.allPools,
      pools: currentDashboard.allPools ? [] : currentDashboard.pools,
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
    updateCurrentDashboard((prevWidgets) => ({
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
    updateCurrentDashboard((prevWidgets) => ({
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

    if (currentDashboard.pools.length) {
      currentDashboard.pools.forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [currentDashboard.pools, pools.data]);

  useEffect(() => {
    const storedWidgets = localStorage.getItem("widgets");

    if (storedWidgets !== null) {
      const storedDashboards = JSON.parse(storedWidgets) as DashboardList;
      const nextDashboards = storedDashboards.widgets?.[dashboardName]
        ? storedDashboards
        : {
            widgets: {
              ...storedDashboards.widgets,
              [dashboardName]: emptyDashboard,
            },
          };

      setDashboards(nextDashboards);
    } else {
      const nextDashboards = {
        widgets: {
          [dashboardName]: defaultDashboard,
        },
      };

      setDashboards(nextDashboards);
      persistDashboards(nextDashboards);
    }
  }, [currentDays, dashboardName, defaultDashboard, emptyDashboard, profile?.profile.pool, username]);

  useEffect(() => {
    const pool = profile?.profile.pool ?? "";
    if (!pool || dashboardName !== "default" || !dashboards.widgets[dashboardName]) {
      return;
    }

    updateCurrentDashboard((prevDashboard) => {
      if (prevDashboard.allPools || prevDashboard.pools.length > 0) {
        return prevDashboard;
      }

      return {
        ...prevDashboard,
        pools: [pool],
      };
    });
  }, [profile?.profile.pool, dashboardName, dashboards.widgets, updateCurrentDashboard]);

  const addDashboard = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = newDashboardName.trim();
    if (!trimmedName) {
      return;
    }

    if (dashboards.widgets[trimmedName]) {
      setNewDashboardNameError("Dashboard name already exists");
      return;
    }

    setDashboards((prevDashboards) => {
      const nextDashboards = {
        ...prevDashboards,
        widgets: {
          ...prevDashboards.widgets,
          [trimmedName]: emptyDashboard,
        },
      };

      persistDashboards(nextDashboards);
      return nextDashboards;
    });

    setDashboardName(trimmedName);
    setNewDashboardName("");
    setNewDashboardNameError(undefined);
    setShowNewDashboard(false);
  };

  return (
    <>
      <PageHeader>
        <div className="flex flex-row flex-wrap gap-global items-center">
          <Select
            id="dashboard-name"
            aria-label="Select a dashboard"
            value={dashboardName}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              if (event.target.value === NEW_DASHBOARD_NAME) {
                setShowNewDashboard(true);
              } else {
                setDashboardName(event.target.value);
                setShowNewDashboard(false);
              }
            }}
          >
            {Object.keys(dashboards.widgets).map((name) => (
              <option
                key={name}
                value={name}
              >
                {name}
              </option>
            ))}
            <option value={NEW_DASHBOARD_NAME}>{NEW_DASHBOARD_NAME}</option>
          </Select>
          <IconButton
            icon={isEditing ? "done" : "edit"}
            text={isEditing ? "Done" : "Edit"}
            className={"btn btn-secondary"}
            onClick={() => setIsEditing(!isEditing)}
          />
        </div>
      </PageHeader>
      <div className="h-full w-full flex justify-center items-baseline">
        <div className="flex flex-col md:grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6 gap-global p-global">
          {currentDashboard.workflows.map((widget) => (
            <WorkflowsWidget
              key={widget.name}
              widget={widget}
              onEdit={(widget) => {
                setEditingWorkflowWidget(widget);
                setWidgetName(widget.name);
                setWidgetDescription(widget.description ?? "");
                setEditingTaskWidget(undefined);
                setEditingPool(false);
              }}
              isEditing={isEditing}
            />
          ))}
          {currentDashboard.tasks.map((widget) => (
            <TasksWidget
              key={widget.id}
              widget={widget}
              onEdit={(widget) => {
                setEditingTaskWidget(widget);
                setWidgetName(widget.name);
                setWidgetDescription(widget.description ?? "");
                setEditingWorkflowWidget(undefined);
                setEditingPool(false);
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
                      title="Edit Pools"
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
                  isEditing={isEditing}
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
        headerChildren={
          <h2 id="edit-header">{editingPool ? "Edit Pools" : editingWorkflowWidget ? "Edit Workflow" : "Edit Task"}</h2>
        }
        aria-labelledby="edit-header"
        size="md"
      >
        {(editingWorkflowWidget ?? editingTaskWidget) && (
          <>
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
              className="w-full"
              containerClassName="w-full p-global"
              value={widgetDescription}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setWidgetDescription(event.target.value);
              }}
            />
          </>
        )}
        {editingPool ? (
          <div className="flex flex-col gap-global">
            <InlineBanner status="info">Select the pools to include in the widget</InlineBanner>
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
            <div className="flex flex-row gap-global justify-between body-footer p-global sm:sticky sm:bottom-0">
              <button
                className="btn btn-primary"
                onClick={() => {
                  const pools = Array.from(localPools.entries())
                    .filter(([_, enabled]) => enabled)
                    .map(([pool]) => pool);

                  updateCurrentDashboard((prevWidgets) => ({
                    ...prevWidgets,
                    pools,
                    allPools,
                  }));
                  setEditingPool(false);
                }}
              >
                <OutlinedIcon name="save" />
                Save
              </button>
            </div>
          </div>
        ) : editingWorkflowWidget ? (
          <WorkflowsFilters
            fields={["user", "date", "status", "pool", "priority"]}
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
            onDelete={() => {
              updateCurrentDashboard((prevWidgets) => ({
                ...prevWidgets,
                workflows: prevWidgets.workflows.filter((widget) => widget.id !== editingWorkflowWidget?.id),
              }));
              setEditingWorkflowWidget(undefined);
            }}
            saveButtonText="Save"
            saveButtonIcon="save"
          />
        ) : editingTaskWidget ? (
          <TasksFilters
            fields={["user", "date", "status", "pool", "priority", "workflow"]}
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
            onDelete={() => {
              updateCurrentDashboard((prevWidgets) => ({
                ...prevWidgets,
                tasks: prevWidgets.tasks.filter((widget) => widget.id !== editingTaskWidget?.id),
              }));
              setEditingTaskWidget(undefined);
            }}
            saveButtonText="Save"
            saveButtonIcon="save"
          />
        ) : undefined}
      </FullPageModal>
      <SlideOut
        id="new-dashboard"
        open={showNewDashboard}
        onClose={() => {
          setShowNewDashboard(false);
          setNewDashboardNameError(undefined);
          setNewDashboardName("");
        }}
        bodyClassName="p-global"
        className="border-t-0"
      >
        <form onSubmit={addDashboard}>
          <div className="flex flex-row gap-global">
            <TextInput
              id="dashboard-name"
              label="Name"
              className="w-full"
              value={newDashboardName}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setNewDashboardName(event.target.value);
                setNewDashboardNameError(undefined);
              }}
              errorText={newDashboardNameError}
              required
            />
            <button
              className="btn btn-secondary mt-5 h-8"
              type="submit"
              aria-disabled={!newDashboardName.trim()}
            >
              <OutlinedIcon name="add" />
              Add
            </button>
          </div>
        </form>
      </SlideOut>
    </>
  );
}
