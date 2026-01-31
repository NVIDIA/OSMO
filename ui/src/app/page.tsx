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

import { UsedFreeToggle } from "~/app/pools/components/UsedFreeToggle";
import { ResourcesGraph } from "~/app/resources/components/ResourceGraph";
import { useAuth } from "~/components/AuthProvider";
import { getDateFromValues } from "~/components/DateRangePicker";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import PageHeader from "~/components/PageHeader";
import { StatusFilterType } from "~/components/StatusFilter";
import { TaskPieChart } from "~/components/TaskPieChart";
import { TextInput } from "~/components/TextInput";
import { UserFilterType } from "~/components/UserFilter";
import { env } from "~/env.mjs";
import { type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import { calcAggregateTotals, calcResourceUsages } from "./resources/components/utils";
import { getTaskStatusArray } from "./tasks/components/StatusFilter";
import { WorkflowsWidget, type WorkflowWidgetDataProps } from "./widgets/workflows";
import { WorkflowsFilters, type WorkflowsFiltersDataProps } from "./workflows/components/WorkflowsFilters";

export default function Home() {
  const currentDays = 365;
  const { username } = useAuth();
  const [isShowingUsed, setIsShowingUsed] = useState(true);
  const todayDateRange = getDateFromValues(currentDays);
  const [isEditing, setIsEditing] = useState(false);
  const [widgetName, setWidgetName] = useState("");
  const [widgetDescription, setWidgetDescription] = useState("");
  const [editingWidget, setEditingWidget] = useState<WorkflowWidgetDataProps | undefined>(undefined);

  const createWidgetId = () => crypto.randomUUID();
  const [widgets, setWidgets] = useState<WorkflowWidgetDataProps[]>([]);
  const updateWidgets = (
    updater: WorkflowWidgetDataProps[] | ((prev: WorkflowWidgetDataProps[]) => WorkflowWidgetDataProps[]),
  ) => {
    setWidgets((prevWidgets) => {
      const nextWidgets = typeof updater === "function" ? updater(prevWidgets) : updater;

      if (nextWidgets.length > 0) {
        localStorage.setItem("widgets", JSON.stringify(nextWidgets));
      } else {
        localStorage.removeItem("widgets");
      }

      return nextWidgets;
    });
  };

  const { data: todaysTasks } = api.tasks.getStatusTotals.useQuery({
    all_users: false,
    all_pools: true,
    users: [username],
    started_after: todayDateRange.fromDate?.toISOString(),
    started_before: todayDateRange.toDate?.toISOString(),
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const { data: currentTasks } = api.tasks.getStatusTotals.useQuery({
    all_users: false,
    all_pools: true,
    users: [username],
    statuses: getTaskStatusArray(StatusFilterType.CURRENT),
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });

  const {
    data: resources,
    isFetching: isResourcesFetching,
    isSuccess: isResourcesSuccess,
    refetch: refetchResources,
  } = api.resources.listResources.useQuery(
    {
      all_pools: false,
      pools: [profile?.profile.pool ?? ""],
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

  const onSaveWidget = (data: WorkflowsFiltersDataProps) => {
    if (!editingWidget) {
      return;
    }
    updateWidgets(prevWidgets => prevWidgets.map(widget => widget.id === editingWidget.id ? {
      ...data,
      id: editingWidget.id,
      name: widgetName,
      description: widgetDescription
    } : widget));
    setEditingWidget(undefined);
  };

  const validateWidget = (data: WorkflowsFiltersDataProps) => {
    return [];
  };

  useEffect(() => {
    const storedWidgets = localStorage.getItem("widgets");

    if (storedWidgets !== null) {
      updateWidgets(JSON.parse(storedWidgets) as WorkflowWidgetDataProps[]);
    } else {
      updateWidgets([
        {
          id: createWidgetId(),
          name: "My Current Workflows",
          userType: UserFilterType.CURRENT,
          selectedUsers: username,
          isSelectAllPoolsChecked: true,
          selectedPools: "",
          dateRange: -2,
          statusFilterType: StatusFilterType.CURRENT,
        },
        {
          id: createWidgetId(),
          name: "My Workflows Today",
          userType: UserFilterType.CURRENT,
          selectedUsers: username,
          isSelectAllPoolsChecked: true,
          selectedPools: "",
          dateRange: 365,
          statusFilterType: StatusFilterType.ALL,
        },
        {
          id: createWidgetId(),
          name: "Low Priority Workflows",
          description: "Low Priority Workflows in the last 7 days",
          userType: UserFilterType.ALL,
          selectedUsers: "",
          isSelectAllPoolsChecked: true,
          selectedPools: "",
          dateRange: 7,
          statusFilterType: StatusFilterType.ALL,
          priority: "LOW",
        },
      ]);
    }
  }, [username]);

  useEffect(() => {
    setWidgetName(editingWidget?.name ?? "");
    setWidgetDescription(editingWidget?.description ?? "");
  }, [editingWidget]);

  return (
    <>
      <PageHeader>
        <IconButton icon="edit" text="Edit" className={`btn ${isEditing ? "btn-primary" : "btn-secondary"}`} onClick={() => setIsEditing(!isEditing)} />
      </PageHeader>
      <div className="h-full w-full flex justify-center items-baseline">
        <div className="flex flex-row flex-wrap gap-global p-global">
          {widgets.map((widget) => (
            <WorkflowsWidget key={widget.name} filters={widget} onEdit={setEditingWidget} onDelete={setEditingWidget} isEditing={isEditing} />
          ))}
          <section className="card w-100 h-100" aria-labelledby="current-tasks-title">
            <div className="popup-header body-header">
              <h2 id="current-tasks-title">Current Tasks</h2>
              <Link href={`/tasks?allUsers=false&allPools=true&users=${encodeURIComponent(username)}&statusType=current`} className="btn btn-secondary" title="View All Current Tasks">
                <OutlinedIcon name="more_horiz" />
              </Link>
            </div>
            <div className="p-global">
              <TaskPieChart counts={currentTasks ?? {}} size={160} innerRadius={40} ariaLabel="Current Tasks" />
            </div>
          </section>
          <section className="card w-100 h-100" aria-labelledby="todays-tasks-title">
            <div className="popup-header body-header">
              <h2 id="todays-tasks-title">Today&apos;s Tasks</h2>
              <Link href={`/tasks?allUsers=false&allPools=true&users=${encodeURIComponent(username)}&dateRange=${currentDays}&statusType=all`} className="btn btn-secondary" title="View All Today&apos;s Tasks">
                <OutlinedIcon name="more_horiz" />
              </Link>
            </div>
            <div className="p-global">
              <TaskPieChart counts={todaysTasks ?? {}} size={160} innerRadius={40} ariaLabel="Today&apos;s Tasks" />
            </div>
          </section>
          <section className="card w-100 h-100" aria-labelledby="resources-title">
            <div className="popup-header body-header">
              <h2>{profile?.profile.pool ?? "Default Pool"}</h2>
              {profile?.profile.pool ? (
                <UsedFreeToggle
                  isShowingUsed={isShowingUsed}
                  updateUrl={(props) => {
                    setIsShowingUsed(props.isShowingUsed ?? true);
                  }}
                />
              ) : <Link href="/profile?tool=settings" className="btn btn-secondary" title="Configure Default Pool">Configure</Link>}
            </div>
            <ResourcesGraph
              {...aggregateTotals.total}
              isLoading={isResourcesFetching}
              isShowingUsed={isShowingUsed}
            />
          </section>
          <section className="card w-100 h-100 p-global">
            <button className="btn btn-secondary border-dashed w-full h-full justify-center items-center text-[10rem] opacity-30 hover:opacity-100 hover:cursor-pointer focus:opacity-100"><OutlinedIcon name="add" className="text-[7rem]!" /></button>
          </section>
        </div>
      </div>
      <FullPageModal
        open={!!editingWidget}
        onClose={() => {
          setEditingWidget(undefined);
        }}
        headerChildren={<h2 id="edit-header">Edit</h2>}
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
        <WorkflowsFilters
          name={""}
          userType={editingWidget?.userType ?? UserFilterType.ALL}
          selectedUsers={editingWidget?.selectedUsers ?? ""}
          selectedPools={editingWidget?.selectedPools ?? ""}
          dateRange={editingWidget?.dateRange ?? 30}
          statusFilterType={editingWidget?.statusFilterType ?? StatusFilterType.CURRENT}
          submittedAfter={editingWidget?.submittedAfter ?? todayDateRange.fromDate?.toISOString()}
          submittedBefore={editingWidget?.submittedBefore ?? todayDateRange.toDate?.toISOString()}
          isSelectAllPoolsChecked={editingWidget?.isSelectAllPoolsChecked ?? true}
          currentUserName={username}
          priority={editingWidget?.priority ?? undefined}
          onSave={onSaveWidget}
          validateFilters={validateWidget}
          saveButtonText="Save"
          saveButtonIcon="save"
        />
      </FullPageModal>
    </>
  );
}
