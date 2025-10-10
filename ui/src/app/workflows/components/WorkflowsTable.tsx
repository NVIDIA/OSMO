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

import { commonFilterFns } from "~/components/commonFilterFns";
import StatusBadge from "~/components/StatusBadge";
import { TableBase } from "~/components/TableBase";
import { TableLoader } from "~/components/TableLoader";
import { TablePagination } from "~/components/TablePagination";
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type WorkflowListItem } from "~/models";
import { convertSeconds, convertToReadableTimezone, formatForWrapping, sortDateWithNA } from "~/utils/string";

import { WorkflowTableRowAction } from "./WorkflowTableRowAction";
import { getStatusDescription } from "./WorkfowStatusInfo";
import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export const WorkflowsTable = ({
  processResources,
  isLoading,
  selectedWorkflowName,
  updateUrl,
}: {
  processResources: WorkflowListItem[];
  isLoading: boolean;
  selectedWorkflowName?: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}) => {
  const updatePagingUrl = useTableStateUrlUpdater();
  const [columnVisibility, setColumnVisibility] = useState({
    tags: false,
  } as Partial<Record<keyof WorkflowListItem, boolean>>);
  const sorting = useTableSortLoader("submit_time", false);

  const columns = useMemo(
    (): Array<ColumnDef<WorkflowListItem>> => [
      {
        header: "ID",
        accessorKey: "name",
        cell: ({ row }) => (
          <WorkflowTableRowAction
            name={row.original.name}
            selected={row.original.name === selectedWorkflowName}
            updateUrl={updateUrl}
          />
        ),
        enableHiding: false,
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
        accessorKey: "queued_time",
        header: "Queued Time",
        cell: ({ row }) => convertSeconds(row.original.queued_time),
        sortingFn: "basic",
        invertSorting: true,
        enableMultiSort: true,
        enableResizing: false,
      },
      {
        accessorKey: "duration",
        header: "Duration",
        cell: ({ row }) => (row.original.duration ? convertSeconds(row.original.duration) : "N/A"),
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        accessorKey: "submit_time",
        header: "Submit Time",
        cell: ({ row }) => convertToReadableTimezone(row.original.submit_time),
        sortingFn: sortDateWithNA,
        invertSorting: true,
        enableMultiSort: true,
        enableResizing: false,
      },
      {
        accessorKey: "start_time",
        header: "Start Time",
        cell: ({ row }) => convertToReadableTimezone(row.original.start_time),
        sortingFn: sortDateWithNA,
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
    ],
    [selectedWorkflowName, updateUrl],
  );

  const table = useReactTable({
    columns,
    data: processResources,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
    enableMultiSort: true,
    filterFns: commonFilterFns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updatePagingUrl(undefined, newSorting);
    },
    autoResetPageIndex: false,
  });

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
