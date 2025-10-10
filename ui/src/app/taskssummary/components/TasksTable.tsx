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

import { WorkflowTableRowAction } from "~/app/workflows/components/WorkflowTableRowAction";
import { type ToolParamUpdaterProps } from "~/app/workflows/hooks/useToolParamUpdater";
import { commonFilterFns } from "~/components/commonFilterFns";
import { TableBase } from "~/components/TableBase";
import { TableLoader } from "~/components/TableLoader";
import { TablePagination } from "~/components/TablePagination";
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type TaskSummaryListItem } from "~/models/tasks-model";
import { formatForWrapping } from "~/utils/string";

export const TasksTable = ({
  processResources,
  isLoading,
  selectedWorkflowId,
  updateUrl,
  showWF,
}: {
  processResources: TaskSummaryListItem[];
  isLoading: boolean;
  selectedWorkflowId?: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
  showWF: boolean;
}) => {
  const updatePagingUrl = useTableStateUrlUpdater();
  const [columnVisibility, setColumnVisibility] = useState({
    tags: false,
  } as Partial<Record<keyof TaskSummaryListItem, boolean>>);
  const sorting = useTableSortLoader("user", true);

  const columns = useMemo((): Array<ColumnDef<TaskSummaryListItem>> => {
    const columns: Array<ColumnDef<TaskSummaryListItem>> = [
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
    ];

    if (showWF) {
      columns.push({
        accessorKey: "workflow_id",
        header: "Workflow ID",
        cell: ({ row }) =>
          row.original.workflow_id ? (
            <WorkflowTableRowAction
              name={row.original.workflow_id}
              selected={row.original.workflow_id === selectedWorkflowId}
              updateUrl={updateUrl}
              disableScrollIntoView={true}
            />
          ) : undefined,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      });
    }

    return columns;
  }, [selectedWorkflowId, updateUrl, showWF]);

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
