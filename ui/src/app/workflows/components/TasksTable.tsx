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
import { useEffect, useMemo, useState } from "react";

import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { commonFilterFns } from "~/components/commonFilterFns";
import { TableBase } from "~/components/TableBase";
import { TablePagination } from "~/components/TablePagination";
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type Task, type WorkflowResponse } from "~/models";
import { convertToReadableTimezone, sortDateWithNA } from "~/utils/string";
import { formatForWrapping } from "~/utils/string";

import TaskStatusInfo from "./TaskStatusInfo";
import { TaskTableRowAction } from "./TaskTableRowAction";
import { ToolType, type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

interface TasksTableProps {
  workflow: WorkflowResponse;
  selectedTask?: Task;
  name: string;
  nodes: string;
  allNodes?: boolean;
  pod_ip: string;
  allStatuses?: boolean;
  statuses?: string;
  verbose?: boolean;
  visible: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}

export const TasksTable = ({
  workflow,
  selectedTask,
  name,
  nodes,
  allNodes,
  allStatuses,
  statuses,
  pod_ip,
  verbose,
  visible,
  updateUrl,
}: TasksTableProps) => {
  const updatePagingUrl = useTableStateUrlUpdater();
  const sorting = useTableSortLoader("name", true);

  const columns = useMemo((): Array<ColumnDef<Task>> => {
    return [
      {
        header: "Task",
        accessorKey: "name",
        cell: ({ row }) => (
          <TaskTableRowAction
            name={row.original.name}
            retry_id={row.original.retry_id}
            lead={row.original.lead}
            selected={selectedTask?.name === row.original.name && selectedTask?.retry_id === row.original.retry_id}
            verbose={verbose}
            updateUrl={updateUrl}
          />
        ),
        enableHiding: false,
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        header: "Logs",
        accessorKey: "logs",
        cell: ({ row }) =>
          row.original.logs ? (
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={row.original.logs}
              className="btn btn-action inline-block"
            >
              Logs
            </a>
          ) : undefined,
        enableSorting: false,
        enableResizing: false,
      },
      {
        header: "Node",
        accessorKey: "node_name",
        cell: ({ row }) =>
          row.original.node_name ? (
            <button
              className="tag-container"
              onClick={() => {
                updateUrl({
                  task: row.original.name,
                  retry_id: row.original.retry_id,
                  tool: ToolType.Nodes,
                });
              }}
            >
              <Tag color={Colors.platform}>{formatForWrapping(row.original.node_name)}</Tag>
            </button>
          ) : undefined,
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        filterFn: commonFilterFns.multi as ColumnDef<Task>["filterFn"],
      },
      {
        header: "IP",
        accessorKey: "pod_ip",
        cell: ({ row }) => row.original.pod_ip,
        sortingFn: "basic",
        invertSorting: true,
        enableMultiSort: true,
        filterFn: commonFilterFns.includesStringOrIsNull as ColumnDef<Task>["filterFn"],
      },
      {
        accessorKey: "status",
        filterFn: commonFilterFns.multi as ColumnDef<Task>["filterFn"],
        header: "Status",
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        cell: ({ row }) => (
          <TaskStatusInfo
            status={row.original.status}
            failureMessage={row.original.failure_message}
            onClick={() =>
              updateUrl({
                task: row.original.name,
                retry_id: row.original.retry_id,
              })
            }
          />
        ),
      },
      {
        accessorKey: "exit_code",
        header: "Exit Code",
        sortingFn: "basic",
        invertSorting: true,
        enableMultiSort: true,
        cell: ({ row }) =>
          row.original.exit_code !== null ? (
            <a
              color={row.original.exit_code === 0 ? Colors.tag : Colors.error}
              href="/docs/concepts/wf/exit_codes.html"
              target="_blank"
              rel="noopener noreferrer"
              className="tag-container"
            >
              <Tag color={row.original.exit_code === 0 ? Colors.tag : Colors.error}>{row.original.exit_code}</Tag>
            </a>
          ) : (
            "N/A"
          ),
      },
      {
        accessorKey: "start_time",
        header: "Start Time",
        invertSorting: true,
        enableMultiSort: true,
        cell: ({ row }) => convertToReadableTimezone(row.original.start_time),
        sortingFn: sortDateWithNA,
      },
      {
        accessorKey: "end_time",
        header: "End Time",
        invertSorting: true,
        enableMultiSort: true,
        cell: ({ row }) => convertToReadableTimezone(row.original.end_time),
        sortingFn: sortDateWithNA,
      },
    ];
  }, [selectedTask?.name, selectedTask?.retry_id, verbose, updateUrl]);

  // Memoizing task fetching
  const tableData = useMemo(() => {
    return (workflow?.groups ?? []).flatMap((group) => group.tasks);
  }, [workflow?.groups]);

  const [columnFilters, setColumnFilters] = useState<Array<{ id: keyof Task; value: unknown }>>([]);

  const table = useReactTable({
    columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
    enableMultiSort: true,
    state: { columnFilters, sorting },
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updatePagingUrl(undefined, newSorting);
    },
    filterFns: commonFilterFns,
    autoResetPageIndex: false,
  });

  useEffect(() => {
    setColumnFilters([
      { id: "name", value: name },
      { id: "node_name", value: allNodes ? undefined : nodes.split(",") },
      { id: "status", value: allStatuses ? undefined : statuses?.split(",") },
      { id: "pod_ip", value: pod_ip },
    ]);
  }, [name, nodes, statuses, pod_ip, allStatuses, allNodes]);

  return (
    <TableBase
      columns={table.getAllColumns()}
      table={table}
      className="body-component"
      paddingOffset={10}
      visible={visible}
    >
      <TablePagination
        table={table}
        totalRows={tableData.length}
      />
    </TableBase>
  );
};
