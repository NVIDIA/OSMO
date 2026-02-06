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
import { UserFilterType } from "~/components/UserFilter";
import { type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import EditDashboardMetadata from "../components/EditDashboardMetadata";
import NewDashboard from "../components/NewDashboard";
import { calcAggregateTotals, calcResourceUsages } from "./resources/components/utils";
import { TasksWidget, type TaskWidgetDataProps } from "./widgets/tasks";
import { WorkflowsWidget, type WorkflowWidgetDataProps } from "./widgets/workflows";

const defaultDays = 365;

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

const generateDashboardMeta = (id: string, name: string, userType: UserFilterType, users: string[], allPools: boolean, pools: string[], widgetAllPools: boolean, widgetPools: string[]): Dashboard => {
  return {
    id,
    name,
    workflows: [
      {
        id: createWidgetId(),
        name: "Current Workflows",
        filters: {
          userType,
          selectedUsers: users.join(","),
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
          userType,
          selectedUsers: users.join(","),
          isSelectAllPoolsChecked: widgetAllPools,
          selectedPools: widgetPools.join(","),
          dateRange: defaultDays,
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
          userType,
          selectedUsers: users.join(","),
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
          userType,
          selectedUsers: users.join(","),
          isSelectAllPoolsChecked: widgetAllPools,
          selectedPools: widgetPools.join(","),
          dateRange: defaultDays,
          statusFilterType: StatusFilterType.ALL,
        },
      },
    ],
    allPools,
    pools,
  };
};

export default function Home() {
  const { username } = useAuth();
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [showNewDashboard, setShowNewDashboard] = useState(false);
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
    () => generateDashboardMeta("default", "Personal", UserFilterType.CURRENT, [username], false, profile?.profile.pool ? [profile?.profile.pool] : [], true, []),
    [username, profile?.profile.pool],
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

  const addDashboard = (name: string, allPools: boolean, pools: string, userType: UserFilterType, selectedUsers: string) => {
    const newDashboard = generateDashboardMeta(createWidgetId(), name, userType, selectedUsers.split(","), allPools, pools.split(","), allPools, pools.split(","));

    setDashboards((prevDashboards) => {
      const nextDashboards = {
        ...prevDashboards,
        dashboards: [
          ...prevDashboards.dashboards,
          newDashboard,
        ],
      };

      persistDashboards(nextDashboards);
      return nextDashboards;
    });

    setCurrentDashboardID(newDashboard.id);
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
        dashboards: nextWidgets,
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
            value={currentDashboard?.id ?? ""}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              setCurrentDashboardID(event.target.value);
            }
            }
          >
            {dashboards.dashboards.map((dashboard) => (
              <option
                key={dashboard.id}
                value={dashboard.id}
              >
                {dashboard.name}
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
              }}
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
                      href={`/resources?pools=${pool}&allPools=${false}`}
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
        id="dashboard-actions"
        open={isActionsMenuOpen}
        onClose={() => {
          setIsActionsMenuOpen(false);
        }}
        className="border-t-0"
        canPin={false}
      >
        <div className="flex flex-col gap-global p-global">
          <button className="btn btn-action"
            onClick={() => {
              setIsEditingMetadata(true);
            }
            }
            role="listitem"><OutlinedIcon name="edit" />Edit Dashboard</button>
          <button className="btn btn-action" role="listitem" onClick={() => {
            updateCurrentDashboard((prevWidgets) => ({
              ...prevWidgets,
              workflows: [...prevWidgets.workflows, {
                id: createWidgetId(),
                name: "",
                filters: {
                  userType: UserFilterType.CURRENT,
                  selectedUsers: "",
                  dateRange: -2,
                  selectedPools: "",
                  isSelectAllPoolsChecked: false,
                  statusFilterType: StatusFilterType.ALL,
                  name: "",
                },
              }],
            }));
          }}><OutlinedIcon name="work_outline" />Add Workflow Widget</button>
          <button className="btn btn-action" role="listitem" onClick={() => {
            updateCurrentDashboard((prevWidgets) => ({
              ...prevWidgets,
              tasks: [...prevWidgets.tasks, {
                id: createWidgetId(),
                name: "",
                filters: {
                  userType: UserFilterType.CURRENT,
                  selectedUsers: "",
                  dateRange: -2,
                  selectedPools: "",
                  isSelectAllPoolsChecked: false,
                  statusFilterType: StatusFilterType.ALL,
                  name: "",
                },
              }],
            }));
          }}><OutlinedIcon name="task" />Add Task Widget</button>
          <button className="btn btn-action" onClick={() => setShowNewDashboard(true)} role="listitem"><OutlinedIcon name="dashboard_customize" />New Dashboard</button>
          <button className="btn btn-action" onClick={
            () => {
              setDashboards((prevDashboards) => {
                const nextDashboards = {
                  ...prevDashboards,
                  dashboards: prevDashboards.dashboards.filter((dashboard) => dashboard.id !== currentDashboardID),
                };
                persistDashboards(nextDashboards);
                return nextDashboards;
              });
              setCurrentDashboardID(dashboards.defaultDashboardID);
            }
          } role="listitem"><OutlinedIcon name="delete" />Delete Dashboard</button>
          <button className="btn btn-action" role="listitem"><OutlinedIcon name="share" />Share Dashboard</button>
        </div>
      </SlideOut>
      <EditDashboardMetadata
        open={isEditingMetadata}
        onClose={() => {
          setIsEditingMetadata(false);
        }}
        dashboard={currentDashboard}
        defaultDashboardID={dashboards.defaultDashboardID}
        onSave={handleEditDashboard}
      />
      <NewDashboard
        currentUserName={username}
        open={showNewDashboard}
        onClose={() => {
          setShowNewDashboard(false);
        }}
        existingNames={dashboards.dashboards.map((widget) => widget.name)}
        onCreate={addDashboard}
      />
    </>
  );
}
