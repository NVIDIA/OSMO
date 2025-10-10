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
import { useMemo, useState } from "react";

import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";

import { TaskTableRowAction } from "~/app/workflows/components/TaskTableRowAction";
import { WorkflowTableRowAction } from "~/app/workflows/components/WorkflowTableRowAction";
import { getStatusDescription } from "~/app/workflows/components/WorkfowStatusInfo";
import { type ToolParamUpdaterProps, ToolType } from "~/app/workflows/hooks/useToolParamUpdater";
import { commonFilterFns } from "~/components/commonFilterFns";
import StatusBadge from "~/components/StatusBadge";
import { TableBase } from "~/components/TableBase";
import { TableLoader } from "~/components/TableLoader";
import { TablePagination } from "~/components/TablePagination";
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type TaskListItem } from "~/models/tasks-model";
import { convertSeconds, convertToReadableTimezone, formatForWrapping, sortDateWithNA } from "~/utils/string";

export const TasksTable = ({
  processResources,
  isLoading,
  selectedTaskName,
  retryId,
  selectedWorkflowId,
  updateUrl,
  showWF,
}: {
  processResources: TaskListItem[];
  isLoading: boolean;
  selectedTaskName?: string;
  retryId?: number;
  selectedWorkflowId?: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
  showWF: boolean;
}) => {
  const updatePagingUrl = useTableStateUrlUpdater();
  const [columnVisibility, setColumnVisibility] = useState({
    tags: false,
  } as Partial<Record<keyof TaskListItem, boolean>>);
  const sorting = useTableSortLoader("start_time", false);

  const columns = useMemo(
    (): Array<ColumnDef<TaskListItem>> => [
      {
        header: "Task Name",
        accessorKey: "task_name",
        cell: ({ row }) => (
          <TaskTableRowAction
            name={row.original.task_name}
            retry_id={row.original.retry_id}
            lead={false}
            verbose={true}
            selected={
              row.original.workflow_id === selectedWorkflowId &&
              row.original.task_name === selectedTaskName &&
              row.original.retry_id === retryId &&
              !showWF
            }
            updateUrl={updateUrl}
            disableScrollIntoView={true}
            extraParams={{
              workflow: row.original.workflow_id,
              showWF: "false",
            }}
          />
        ),
        enableHiding: false,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "workflow_id",
        header: "Workflow ID",
        cell: ({ row }) => (
          <WorkflowTableRowAction
            name={row.original.workflow_id}
            selected={row.original.workflow_id === selectedWorkflowId && showWF}
            updateUrl={updateUrl}
            disableScrollIntoView={true}
            extraParams={{
              showWF: "true",
              task: row.original.task_name,
              retry_id: row.original.retry_id?.toString(),
            }}
          />
        ),
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "user",
        header: "User",
        cell: ({ row }) => formatForWrapping(row.original.user),
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "pool",
        header: "Pool",
        cell: ({ row }) => {
          return row.original.pool ? (
            <Link
              href={`/pools/${row.original.pool}`}
              className="tag-container"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Tag color={Colors.pool}>{row.original.pool}</Tag>
            </Link>
          ) : undefined;
        },
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "node",
        header: "Node",
        cell: ({ row }) => {
          return row.original.node ? (
            <button
              className="tag-container"
              onClick={() => {
                updateUrl({
                  tool: ToolType.Nodes,
                  task: row.original.task_name,
                  workflow: row.original.workflow_id,
                  retry_id: row.original.retry_id,
                });
              }}
            >
              <Tag color={Colors.platform}>{formatForWrapping(row.original.node)}</Tag>
            </button>
          ) : undefined;
        },
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <a
            className="tag-container-round"
            href="/docs/concepts/wf/status.html"
            target="_blank"
            rel="noopener noreferrer"
            title={getStatusDescription(row.original.status)}
          >
            <StatusBadge status={row.original.status} />
          </a>
        ),
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => (
          <a
            href="/docs/concepts/wf/priority.html"
            target="_blank"
            rel="noopener noreferrer"
            className="tag-container"
          >
            <Tag color={Colors.platform}>{row.original.priority}</Tag>
          </a>
        ),
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "start_time",
        header: "Start",
        cell: ({ row }) => convertToReadableTimezone(row.original.start_time),
        sortingFn: sortDateWithNA,
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "end_time",
        header: "End",
        cell: ({ row }) => convertToReadableTimezone(row.original.end_time),
        sortingFn: sortDateWithNA,
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "duration",
        header: "Duration",
        cell: ({ row }) => {
          const duration = row.original.duration;
          if (!duration) return "N/A";
          return convertSeconds(duration);
        },
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "storage",
        header: "Storage",
        cell: ({ row }) => row.original.storage,
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "cpu",
        header: "CPU",
        cell: ({ row }) => row.original.cpu,
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "memory",
        header: "Memory",
        cell: ({ row }) => row.original.memory,
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "gpu",
        header: "GPU",
        cell: ({ row }) => row.original.gpu,
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
    ],
    [selectedTaskName, selectedWorkflowId, updateUrl, showWF, retryId],
  );

  const table = useReactTable({
    data: processResources,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      sorting,
      columnVisibility,
    },
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updatePagingUrl(undefined, newSorting);
    },
    onColumnVisibilityChange: setColumnVisibility,
    enableSorting: true,
    enableMultiSort: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    filterFns: commonFilterFns,
    autoResetPageIndex: false,
  });

  if (isLoading) {
    return <TableLoader table={table} />;
  }

  return (
    <div className="h-full w-full">
      {isLoading ? (
        <TableLoader table={table} />
      ) : (
        <div className="flex flex-col h-full w-full">
          <TableBase
            columns={columns}
            table={table}
            paddingOffset={10}
            className="body-component"
          >
            <TablePagination
              table={table}
              totalRows={processResources.length}
            />
          </TableBase>
        </div>
      )}
    </div>
  );
};
