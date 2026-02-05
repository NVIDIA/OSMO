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
import { OutlinedIcon } from "~/components/Icon";
import PageHeader from "~/components/PageHeader";
import { Select } from "~/components/Select";
import { SlideOut } from "~/components/SlideOut";
import { StatusFilterType } from "~/components/StatusFilter";
import { TextInput } from "~/components/TextInput";
import { UserFilterType } from "~/components/UserFilter";
import { type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import EditDashboardMetadataModal from "./components/EditDashboardMetadataModal";
import { calcAggregateTotals, calcResourceUsages } from "./resources/components/utils";
import { TasksWidget, type TaskWidgetDataProps } from "./widgets/tasks";
import { WorkflowsWidget, type WorkflowWidgetDataProps } from "./widgets/workflows";

export interface Dashboard {
  id: string;
  name: string;
  workflows: WorkflowWidgetDataProps[];
  tasks: TaskWidgetDataProps[];
  allPools: boolean;
  pools: string[];
}

interface DashboardList {
  dashboards: Dashboard[];
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
  const [showNewDashboard, setShowNewDashboard] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [newDashboardNameError, setNewDashboardNameError] = useState<string | undefined>(undefined);
  const [currentDashboardID, setCurrentDashboardID] = useState<string | undefined>(undefined);

  const [dashboards, setDashboards] = useState<DashboardList>({
    dashboards: [],
    defaultDashboardID: "",
  });

  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });

  const currentDashboard = useMemo(() => dashboards.dashboards.find((widget) => widget.id === currentDashboardID), [dashboards.dashboards, currentDashboardID]);

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
      if (!currentDashboardID) {
        return;
      }

      setDashboards((prevDashboards) => {
        const prevDashboard = prevDashboards.dashboards.find((widget) => widget.id === currentDashboardID);
        if (!prevDashboard) {
          return prevDashboards;
        }
        const nextDashboard = typeof updater === "function" ? updater(prevDashboard) : updater;
        const nextDashboards = {
          ...prevDashboards,
          dashboards: prevDashboards.dashboards.map((widget) =>
            widget.id === currentDashboardID ? nextDashboard : widget,
          ),
        };

        persistDashboards(nextDashboards);
        return nextDashboards;
      });
    },
    [currentDashboardID],
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

  useEffect(() => {
    const storedWidgets = localStorage.getItem("widgets");

    if (storedWidgets !== null) {
      const storedDashboards = JSON.parse(storedWidgets) as DashboardList;
      setDashboards(storedDashboards);
      setCurrentDashboardID(storedDashboards.defaultDashboardID);
    } else {
      setDashboards({
        dashboards: [defaultDashboard],
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

    if (dashboards.dashboards.some((widget) => widget.name === trimmedName)) {
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
          ...prevDashboards.dashboards,
          newDashboard,
        ],
      };

      persistDashboards(nextDashboards);
      setCurrentDashboardID(newDashboard.id);
      return nextDashboards;
    });

    setNewDashboardName("");
    setNewDashboardNameError(undefined);
    setShowNewDashboard(false);
  };

  const handleEditDashboard = (name: string, isDefault: boolean, allPools: boolean, pools: string) => {
    if (!currentDashboard) {
      return;
    }

    setDashboards((prevDashboards) => {
      const nextWidgets = prevDashboards.dashboards.map((widget) => {
        if (widget.id !== currentDashboard.id) {
          return widget;
        }

        return {
          ...widget,
          name,
          allPools,
          pools: pools
            .split(",")
            .map((pool) => pool.trim())
            .filter(Boolean),
        };
      });
      const nextDefaultDashboardID = isDefault
        ? currentDashboard.id
        : prevDashboards.defaultDashboardID === currentDashboard.id
          ? ""
          : prevDashboards.defaultDashboardID;
      const nextDashboards = {
        ...prevDashboards,
        widgets: nextWidgets,
        defaultDashboardID: nextDefaultDashboardID,
      };

      persistDashboards(nextDashboards);
      return nextDashboards;
    });

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
            {dashboards.dashboards.map((widget) => (
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
              currentUserName={username}
              onSave={(data) => {
                const targetId = widget.id;
                updateCurrentDashboard((prevWidgets) => ({
                  ...prevWidgets,
                  workflows: prevWidgets.workflows.map((dashboardWidget) =>
                    dashboardWidget.id === targetId ? data : dashboardWidget,
                  ),
                }));
              }  }
              onDelete={() => {
                const targetId = widget.id;
                updateCurrentDashboard((prevWidgets) => ({
                  ...prevWidgets,
                  workflows: prevWidgets.workflows.filter((dashboardWidget) => dashboardWidget.id !== targetId),
                }));
              }}
            />
          ))}
          {currentDashboard?.tasks.map((widget) => (
            <TasksWidget
              key={widget.id}
              widget={widget}
              currentUserName={username}
              onSave={(data) => {
                const targetId = widget.id;
                updateCurrentDashboard((prevWidgets) => ({
                  ...prevWidgets,
                  tasks: prevWidgets.tasks.map((dashboardWidget) =>
                    dashboardWidget.id === targetId ? data : dashboardWidget,
                  ),
                }));
              }}
              onDelete={() => {
                const targetId = widget.id;
                updateCurrentDashboard((prevWidgets) => ({
                  ...prevWidgets,
                  tasks: prevWidgets.tasks.filter((dashboardWidget) => dashboardWidget.id !== targetId),
                }));
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
      <EditDashboardMetadataModal
        open={isEditingMetadata}
        onClose={() => {
          setIsEditingMetadata(false);
        }}
        dashboard={currentDashboard}
        defaultDashboardID={dashboards.defaultDashboardID}
        onSave={handleEditDashboard}
      />
    </>
  );
}
