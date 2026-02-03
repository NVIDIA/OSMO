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
import { useMemo } from "react";

import Link from "next/link";

import { getDateFromValues } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import { StatusFilterType } from "~/components/StatusFilter";
import { TaskPieChart } from "~/components/TaskPieChart";
import { UserFilterType } from "~/components/UserFilter";
import { env } from "~/env.mjs";
import { type TaskStatusType } from "~/models";
import { api } from "~/trpc/react";

import { getTaskStatusArray } from "../tasks/components/StatusFilter";
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
  onEdit,
  isEditing,
}: {
  widget: TaskWidgetDataProps;
  onEdit: (widget: TaskWidgetDataProps) => void;
  isEditing: boolean;
}) => {
  const { getUrlParams } = useToolParamUpdater();
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
    <section
      className="card flex flex-col"
      aria-labelledby="tasks-widget-title"
    >
      <div className="popup-header body-header">
        <h2 id="tasks-widget-title">{widget.name}</h2>
        {isEditing ? (
          <button
            className="btn btn-secondary"
            onClick={() => onEdit(widget)}
            title={`Edit ${widget.name}`}
          >
            <OutlinedIcon name="edit" />
          </button>
        ) : (
          <Link
            href={detailsUrl}
            className="btn btn-secondary"
            title={`View All ${widget.name}`}
          >
            <OutlinedIcon name="list_alt" />
          </Link>
        )}
      </div>
      <div
        className={`flex flex-col gap-global p-global w-full flex-1 justify-between ${isEditing ? "opacity-60" : ""}`}
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
  );
};
