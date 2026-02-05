//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
"use client";
import { useMemo, useState } from "react";

import Link from "next/link";

import { getDateFromValues } from "~/components/DateRangePicker";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { StatusFilterType } from "~/components/StatusFilter";
import { TaskPieChart } from "~/components/TaskPieChart";
import { TextInput } from "~/components/TextInput";
import { UserFilterType } from "~/components/UserFilter";
import { env } from "~/env.mjs";
import { type TaskStatusType } from "~/models";
import { api } from "~/trpc/react";

import { getTaskStatusArray } from "../tasks/components/StatusFilter";
import { TasksFilters, type TasksFiltersDataProps } from "../tasks/components/TasksFilters";
import useToolParamUpdater from "../workflows/hooks/useToolParamUpdater";


export interface TaskWidgetFilters {
  userType: UserFilterType;
  selectedUsers: string;
  dateRange: number;
  startedAfter?: string;
  startedBefore?: string;
  statusFilterType?: StatusFilterType;
  statuses?: string;
  selectedPools: string;
  isSelectAllPoolsChecked: boolean;
}

export interface TaskWidgetDataProps {
  id: string;
  name: string;
  description?: string;
  filters: TaskWidgetFilters;
}

export const TasksWidget = ({
  widget,
  currentUserName,
  onSave,
  onDelete,
}: {
  widget: TaskWidgetDataProps;
  currentUserName: string;
  onSave: (widget: TaskWidgetDataProps) => void;
  onDelete: () => void;
}) => {
  const { getUrlParams } = useToolParamUpdater();
  const [isEditing, setIsEditing] = useState(false);
  const [widgetName, setWidgetName] = useState(widget.name);
  const [widgetDescription, setWidgetDescription] = useState(widget.description ?? "");

  const dateRangeDates = getDateFromValues(
    widget.filters.dateRange,
    widget.filters.startedAfter,
    widget.filters.startedBefore,
  );

  const users = widget.filters.userType === UserFilterType.ALL ? [] : (widget.filters.selectedUsers?.split(",") ?? []);

  const { data: currentTasks } = api.tasks.getStatusTotals.useQuery(
    {
      all_users: widget.filters.userType === UserFilterType.ALL,
      users: users,
      all_pools: widget.filters.isSelectAllPoolsChecked,
      pools: widget.filters.isSelectAllPoolsChecked ? [] : widget.filters.selectedPools.split(","),
      started_after: dateRangeDates.fromDate?.toISOString(),
      started_before: dateRangeDates.toDate?.toISOString(),
      statuses:
        widget.filters.statusFilterType === StatusFilterType.CUSTOM
          ? (widget.filters.statuses?.split(",") as TaskStatusType[])
          : getTaskStatusArray(widget.filters.statusFilterType),
    },
    {
      refetchOnWindowFocus: true,
      refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000,
    },
  );

  const detailsUrl = useMemo(() => {
    const params = getUrlParams(
      {
        statusFilterType: widget.filters.statusFilterType,
        status: widget.filters.statusFilterType === StatusFilterType.CUSTOM ? (widget.filters.statuses ?? null) : null,
        allPools: widget.filters.isSelectAllPoolsChecked,
        pools: widget.filters.isSelectAllPoolsChecked ? null : widget.filters.selectedPools.split(","),
        allUsers: widget.filters.userType === UserFilterType.ALL,
        users: widget.filters.userType === UserFilterType.ALL ? null : widget.filters.selectedUsers.split(","),
        dateRange: widget.filters.dateRange,
        dateAfter: widget.filters.startedAfter ?? null,
        dateBefore: widget.filters.startedBefore ?? null,
      },
      undefined,
    ).toString();

    return `/tasks?${params}`;
  }, [widget, getUrlParams]);

  return (
    <>
      <section
        className="card flex flex-col"
        aria-labelledby="tasks-widget-title"
      >
        <div className="popup-header body-header">
          <h2 id="tasks-widget-title">{widget.name}</h2>
          <div className="flex flex-row gap-global">
            <button
              className="btn btn-secondary"
              onClick={() => setIsEditing(true)}
              title={`Edit ${widget.name}`}
            >
              <OutlinedIcon name="edit" />
            </button>
            <Link
              href={detailsUrl}
              className="btn btn-secondary"
              title={`View All ${widget.name}`}
            >
              <OutlinedIcon name="list_alt" />
            </Link>
          </div>
        </div>
        <div
          className="flex flex-col gap-global p-global w-full flex-1 justify-between"
        >
          <TaskPieChart
            counts={currentTasks ?? {}}
            size={160}
            innerRadius={40}
            ariaLabel={widget.name}
          />
        </div>
        {widget.description && <p className="text-sm text-center p-global text-gray-500">{widget.description}</p>}
      </section>
      <FullPageModal
        open={isEditing}
        onClose={() => {
          setIsEditing(false);
        }}
        headerChildren={
          <h2 id="edit-header">Edit Task</h2>
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
        <TasksFilters
          fields={["user", "date", "status", "pool", "priority", "workflow"]}
          userType={widget.filters.userType}
          selectedUsers={widget.filters.selectedUsers}
          dateRange={widget.filters.dateRange}
          startedAfter={widget.filters.startedAfter}
          startedBefore={widget.filters.startedBefore}
          statusFilterType={widget.filters.statusFilterType}
          statuses={widget.filters.statuses}
          selectedPools={widget.filters.selectedPools}
          isSelectAllPoolsChecked={widget.filters.isSelectAllPoolsChecked}
          currentUserName={currentUserName}
          isSelectAllNodesChecked={true}
          nodes=""
          workflowId=""
          onSave={(data: TasksFiltersDataProps) => {
            setIsEditing(false);
            onSave({
              id: widget.id,
              name: widgetName,
              description: widgetDescription,
              filters: data,
            })
          }}
          onDelete={onDelete}
          saveButtonText="Save"
          saveButtonIcon="save"
        />
      </FullPageModal>

    </>
  );
};
