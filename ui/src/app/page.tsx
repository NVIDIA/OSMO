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
import { MultiselectWithAll } from "~/components/MultiselectWithAll";
import PageHeader from "~/components/PageHeader";
import { Select } from "~/components/Select";
import { SlideOut } from "~/components/SlideOut";
import { StatusFilterType } from "~/components/StatusFilter";
import { Switch } from "~/components/Switch";
import { TextInput } from "~/components/TextInput";
import { UserFilterType } from "~/components/UserFilter";
import { PoolsListResponseSchema, type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import { calcAggregateTotals, calcResourceUsages } from "./resources/components/utils";
import { TasksFilters, type TasksFiltersDataProps } from "./tasks/components/TasksFilters";
import { TasksWidget, type TaskWidgetDataProps } from "./widgets/tasks";
import { WorkflowsWidget, type WorkflowWidgetDataProps } from "./widgets/workflows";
import { WorkflowsFilters, type WorkflowsFiltersDataProps } from "./workflows/components/WorkflowsFilters";

interface Dashboard {
  id: string;
  name: string;
  workflows: WorkflowWidgetDataProps[];
  tasks: TaskWidgetDataProps[];
  allPools: boolean;
  pools: string[];
}

interface DashboardList {
  widgets: Dashboard[];
  defaultDashboardID: string;
}

const createWidgetId = () => crypto.randomUUID();

const makeDefaultDashboard = (username: string, days: number, allPools: boolean, pools: string[], widgetAllPools: boolean, widgetPools: string[]) => {
  return {
    id: "default",
    name: "Personal",
    workflows: [
      {
        id: createWidgetId(),
        name: "Current Workflows",
        description: "Current Workflows for the current user",
        filters: {
          userType: UserFilterType.CURRENT,
          selectedUsers: username,
          isSelectAllPoolsChecked: widgetAllPools,
          selectedPools: widgetPools.join(","),
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
          isSelectAllPoolsChecked: widgetAllPools,
          selectedPools: widgetPools.join(","),
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
          isSelectAllPoolsChecked: widgetAllPools,
          selectedPools: widgetPools.join(","),
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
          isSelectAllPoolsChecked: widgetAllPools,
          selectedPools: widgetPools.join(","),
          dateRange: days,
          statusFilterType: StatusFilterType.ALL,
        },
      },
    ],
    allPools,
    pools,
  };
};

export default function Home() {
  const currentDays = 365;
  const { username } = useAuth();
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [widgetName, setWidgetName] = useState("");
  const [widgetDescription, setWidgetDescription] = useState("");
  const [localPools, setLocalPools] = useState<Map<string, boolean>>(new Map());
  const [allPools, setAllPools] = useState(true);
  const [editingWorkflowWidget, setEditingWorkflowWidget] = useState<WorkflowWidgetDataProps | undefined>(undefined);
  const [editingTaskWidget, setEditingTaskWidget] = useState<TaskWidgetDataProps | undefined>(undefined);
  const [dashboardName, setDashboardName] = useState<string | undefined>(undefined);
  const [showNewDashboard, setShowNewDashboard] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [newDashboardNameError, setNewDashboardNameError] = useState<string | undefined>(undefined);
  const [currentDashboardID, setCurrentDashboardID] = useState<string | undefined>(undefined);
  const [isDefaultDashboard, setIsDefaultDashboard] = useState(false);

  const [dashboards, setDashboards] = useState<DashboardList>({
    widgets: [],
    defaultDashboardID: "",
  });

  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });

  const pools = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const currentDashboard = useMemo(() => dashboards.widgets.find((widget) => widget.id === currentDashboardID), [dashboards.widgets, currentDashboardID]);

  const {
    data: resources,
    isFetching: isResourcesFetching,
    isSuccess: isResourcesSuccess,
    refetch: refetchResources,
  } = api.resources.listResources.useQuery(
    {
      all_pools: currentDashboard?.allPools,
      pools: currentDashboard?.allPools ? [] : (currentDashboard?.pools ?? []),
    },
    {
      refetchOnWindowFocus: false,
      enabled: currentDashboard?.allPools ? true : (currentDashboard?.pools?.length ?? 0) > 0,
    },
  );

  const defaultDashboard = useMemo<Dashboard>(
    () => makeDefaultDashboard(username, currentDays, false, profile?.profile.pool ? [profile?.profile.pool] : [], true, []),
    [username, currentDays, profile?.profile.pool],
  );

  const persistDashboards = (nextDashboards: DashboardList) => {
    localStorage.setItem("widgets", JSON.stringify(nextDashboards));
  };

  const updateCurrentDashboard = useCallback(
    (updater: Dashboard | ((prev: Dashboard) => Dashboard)) => {
      if (!currentDashboard) {
        return;
      }

      setDashboards((prevDashboards) => {
        const prevDashboard = prevDashboards.widgets.find((widget) => widget.name === currentDashboard.name);
        if (!prevDashboard) {
          return prevDashboards;
        }
        const nextDashboard = typeof updater === "function" ? updater(prevDashboard) : updater;
        const nextDashboards = {
          ...prevDashboards,
          widgets: prevDashboards.widgets.map((widget) =>
            widget.name === currentDashboard.name ? nextDashboard : widget,
          ),
        };

        persistDashboards(nextDashboards);
        return nextDashboards;
      });
    },
    [currentDashboard],
  );

  const processResources = useMemo(() => {
    // resource list api will return users default pool if all_pools is false and pools is empty
    // Instead, if the user does not want pools, we should return an empty array.
    if (!isResourcesSuccess || (!currentDashboard?.allPools && (currentDashboard?.pools?.length ?? 0)) === 0) {
      return [];
    }

    return calcResourceUsages(resources);
  }, [resources, isResourcesSuccess, currentDashboard?.allPools, currentDashboard?.pools]);

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

    if (currentDashboard?.pools.length) {
      currentDashboard?.pools.forEach((pool) => {
        filters.set(pool, true);
      });
    }

    setLocalPools(filters);
  }, [currentDashboard?.pools, pools.data]);

  useEffect(() => {
    const storedWidgets = localStorage.getItem("widgets");

    if (storedWidgets !== null) {
      const storedDashboards = JSON.parse(storedWidgets) as DashboardList;
      setDashboards(storedDashboards);
      setCurrentDashboardID(storedDashboards.defaultDashboardID);
    } else {
      setDashboards({
        widgets: [defaultDashboard],
        defaultDashboardID: defaultDashboard.id,
      });
      setCurrentDashboardID(defaultDashboard.id);
    }
  }, [defaultDashboard]);

  // Back-fill the default dashboard with the current user's pool if it is not already set.
  useEffect(() => {
    const pool = profile?.profile.pool ?? "";
    if (!pool || !currentDashboard || currentDashboard.name !== dashboards.defaultDashboardID) {
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
  }, [profile?.profile.pool, currentDashboard, updateCurrentDashboard, dashboards.defaultDashboardID]);

  const addDashboard = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = newDashboardName.trim();
    if (!trimmedName) {
      return;
    }

    if (dashboards.widgets.some((widget) => widget.name === trimmedName)) {
      setNewDashboardNameError("Dashboard name already exists");
      return;
    }

    setDashboards((prevDashboards) => {
      const newDashboard: Dashboard = {
        id: createWidgetId(),
        name: trimmedName,
        workflows: [],
        tasks: [],
        allPools: false,
        pools: [],
      };
      const nextDashboards = {
        ...prevDashboards,
        widgets: [
          ...prevDashboards.widgets,
          newDashboard,
        ],
      };

      persistDashboards(nextDashboards);
      setCurrentDashboardID(newDashboard.id);
      return nextDashboards;
    });

    setDashboardName(trimmedName);
    setIsDefaultDashboard(false);
    setNewDashboardName("");
    setNewDashboardNameError(undefined);
    setShowNewDashboard(false);
  };

  const handleEditDashboard = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const pools = Array.from(localPools.entries())
      .filter(([_, enabled]) => enabled)
      .map(([pool]) => pool);

    updateCurrentDashboard((prevWidgets) => ({
      ...prevWidgets,
      pools,
      allPools,
      name: dashboardName ?? "",
      defaultDashboard: isDefaultDashboard ? dashboardName ?? "" : dashboards.defaultDashboardID,
    }));

    setIsEditingMetadata(false);
  };

  return (
    <>
      <PageHeader>
        <div className="flex flex-row flex-wrap gap-global items-center">
          <Select
            id="dashboard-name"
            aria-label="Select a dashboard"
            value={currentDashboard?.name ?? ""}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              setCurrentDashboardID(event.target.value);
            }
            }
          >
            {dashboards.widgets.map((widget) => (
              <option
                key={widget.id}
                value={widget.name}
              >
                {widget.name}
              </option>
            ))}
          </Select>
          <button
            className="btn btn-secondary"
            onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
            title="Dashboard Actions"
          >
            <OutlinedIcon name="more_vert" />
          </button>
        </div>
      </PageHeader>
      <div className="h-full w-full flex justify-center items-baseline">
        <div className="flex flex-col md:grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6 gap-global p-global">
          {currentDashboard?.workflows.map((widget) => (
            <WorkflowsWidget
              key={widget.name}
              widget={widget}
              onEdit={(widget) => {
                setEditingWorkflowWidget(widget);
                setWidgetName(widget.name);
                setWidgetDescription(widget.description ?? "");
                setEditingTaskWidget(undefined);
              }}
            />
          ))}
          {currentDashboard?.tasks.map((widget) => (
            <TasksWidget
              key={widget.id}
              widget={widget}
              onEdit={(widget) => {
                setEditingTaskWidget(widget);
                setWidgetName(widget.name);
                setWidgetDescription(widget.description ?? "");
                setEditingWorkflowWidget(undefined);
              }}
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
        </div>
      </div>
      <FullPageModal
        open={!!editingWorkflowWidget || !!editingTaskWidget}
        onClose={() => {
          setEditingWorkflowWidget(undefined);
          setEditingTaskWidget(undefined);
        }}
        headerChildren={
          <h2 id="edit-header">{editingWorkflowWidget ? "Edit Workflow" : "Edit Task"}</h2>
        }
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
          className="w-full"
          containerClassName="w-full p-global"
          value={widgetDescription}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setWidgetDescription(event.target.value);
          }}
        />
        {editingWorkflowWidget ? (
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
      <SlideOut
        id="edit-dashboard"
        open={isActionsMenuOpen}
        onClose={() => {
          setIsActionsMenuOpen(false);
        }}
        className="border-t-0"
        aria-labelledby="edit-dashboard-header"
        canPin={false}
      >
        <div className="flex flex-col gap-global p-global">
          <button className="btn btn-action" onClick={() => {
            setIsEditingMetadata(true);
            setDashboardName(currentDashboard?.name ?? "");
            setAllPools(currentDashboard?.allPools ?? false);
            setLocalPools(new Map(currentDashboard?.pools.map((pool) => [pool, true])));
            setIsDefaultDashboard(currentDashboard?.id === dashboards.defaultDashboardID);
          }
          } role="listitem"><OutlinedIcon name="edit" />Edit Dashboard</button>
          <button className="btn btn-action" role="listitem"><OutlinedIcon name="work_outline" />Add Workflow Widget</button>
          <button className="btn btn-action" role="listitem"><OutlinedIcon name="task" />Add Task Widget</button>
        </div>
        <div className="flex flex-col gap-global p-global border-t-1 border-border">
          <button className="btn btn-action" onClick={() => setShowNewDashboard(true)} role="listitem"><OutlinedIcon name="dashboard_customize" />New Dashboard</button>
          <button className="btn btn-action" role="listitem"><OutlinedIcon name="copy" />Clone Current Dashboard</button>
          <button className="btn btn-action" role="listitem"><OutlinedIcon name="share" />Share Dashboard</button>
        </div>
      </SlideOut>
      <FullPageModal
        open={isEditingMetadata}
        onClose={() => {
          setIsEditingMetadata(false);
        }}
        headerChildren="Edit Dashboard"
        size="sm"
      >
        <form onSubmit={handleEditDashboard}>
          <div className="flex flex-col gap-global p-global">
            <TextInput
              id="dashboard-name"
              label="Name"
              className="w-full"
              value={dashboardName ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setDashboardName(event.target.value);
              }}
              required
            />
            <Switch
              id="is-default"
              label="Default Dashboard"
              checked={isDefaultDashboard}
              onChange={(checked) => {
                setIsDefaultDashboard(checked);
              }}
              size="small"
              labelPosition="right"
            />
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
          <div className="flex justify-end p-global bg-footerbg">
            <button
              className="btn btn-primary"
              type="submit"
            >
              <OutlinedIcon name="save" />
              Save
            </button>
          </div>
        </form>
      </FullPageModal>
    </>
  );
}
