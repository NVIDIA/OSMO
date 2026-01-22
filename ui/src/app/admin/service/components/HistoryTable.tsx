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

import { Checkbox } from "~/components/Checkbox";
import { commonFilterFns } from "~/components/commonFilterFns";
import { TableBase } from "~/components/TableBase";
import { TablePagination } from "~/components/TablePagination";
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type ServiceConfigHistoryItem } from "~/models/config/service-config";

interface HistoryTableProps {
  configs: ServiceConfigHistoryItem[];
  isLoading: boolean;
  onSelectRevision?: (revision: number) => void;
  onRowSelectionChange: (configs: number[]) => void;
}

export const HistoryTable = ({ configs, isLoading, onSelectRevision, onRowSelectionChange }: HistoryTableProps) => {
  const updatePagingUrl = useTableStateUrlUpdater();
  const [columnVisibility, setColumnVisibility] = useState({});
  const sorting = useTableSortLoader("revision", false);

  const columns = useMemo(
    (): Array<ColumnDef<ServiceConfigHistoryItem>> => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onChange={(event) => table.toggleAllPageRowsSelected(event.target.checked)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        header: "Revision",
        accessorKey: "revision",
        cell: ({ row }) => (
          <button
            className={`btn btn-badge   `}
            onClick={() => onSelectRevision?.(row.index)}
          >
            <Tag color={Colors.pool}>{row.original.revision}</Tag>
          </button>
        ),
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        header: "Username",
        accessorKey: "username",
        cell: ({ row }) => row.original.username,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        header: "Date",
        accessorKey: "created_at",
        cell: ({ row }) =>
          row.original.created_at.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        sortingFn: "datetime",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: false,
      },
      {
        header: "Description",
        accessorKey: "description",
        cell: ({ row }) => row.original.description,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        enableResizing: true,
      },
      {
        header: "Tags",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.tags?.map((tag) => (
              <Tag
                key={tag}
                color={Colors.tag}
              >
                {tag}
              </Tag>
            ))}
          </div>
        ),
        enableSorting: false,
        enableResizing: false,
      },
    ],
    [onSelectRevision],
  );

  const table = useReactTable({
    columns,
    data: configs,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.revision.toString(),
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

  useEffect(() => {
    const selectedRows = table.getSelectedRowModel().rows;

    onRowSelectionChange(selectedRows.map((row) => row.original.revision));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getSelectedRowModel().rows, onRowSelectionChange]);

  return (
    <TableBase
      columns={columns}
      table={table}
      className="body-component"
      isLoading={isLoading}
    >
      <TablePagination
        table={table}
        totalRows={configs.length}
      />
    </TableBase>
  );
};
