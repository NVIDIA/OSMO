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
import { useMemo } from "react";

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
import { TableBase } from "~/components/TableBase";
import { TablePagination } from "~/components/TablePagination";
import { Colors, DatasetTag, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type DataInfoResponse, type DatasetTypesSchema } from "~/models";
import { convertBytes, convertToReadableTimezone, sortDateWithNA } from "~/utils/string";

import { useToolParamUpdater } from "../hooks/useToolParamUpdater";

interface DatasetVersionsTableProps {
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset>;
  selectedVersion?: string;
  visible: boolean;
}

export const DatasetVersionsTable = ({ dataset, selectedVersion, visible }: DatasetVersionsTableProps) => {
  const sorting = useTableSortLoader("version", false);
  const toolParamUpdater = useToolParamUpdater();
  const updateUrl = useTableStateUrlUpdater();

  const columns = useMemo(
    (): Array<ColumnDef<(typeof dataset.versions)[0]>> => [
      {
        header: "Version",
        accessorKey: "version",
        cell: ({ row }) => (
          <button
            className={`btn ${selectedVersion === row.original.version ? "btn-primary" : "btn-secondary"} table-action`}
            onClick={() => toolParamUpdater({ version: row.original.version, showVersions: false })}
          >
            {row.original.version}
          </button>
        ),
        enableHiding: false,
        sortingFn: "alphanumeric",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => row.original.status,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        header: "Created By",
        accessorKey: "created_by",
        cell: ({ row }) => row.original.created_by,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        header: "Created Date",
        accessorKey: "created_date",
        cell: ({ row }) => convertToReadableTimezone(row.original.created_date),
        sortingFn: sortDateWithNA,
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        header: "Last Used",
        accessorKey: "last_used",
        cell: ({ row }) => convertToReadableTimezone(row.original.last_used),
        sortingFn: sortDateWithNA,
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        header: "Size",
        accessorKey: "size",
        cell: ({ row }) => convertBytes(row.original.size),
        sortingFn: "basic",
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        header: "Retention Policy",
        accessorKey: "retention_policy",
        cell: ({ row }) => {
          const days = Math.floor(row.original.retention_policy / (24 * 60 * 60));
          return `${days} days`;
        },
        sortingFn: "basic",
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        header: "Tags",
        accessorKey: "tags",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.tags.map((tag, index) => (
              <Tag
                key={index}
                color={Colors.tag}
                className="min-h-6 break-all"
              >
                {tag}
              </Tag>
            ))}
          </div>
        ),
        enableSorting: false,
      },
      {
        header: "Collections",
        accessorKey: "collections",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.collections.map((collection) => (
              <Link
                key={collection}
                href={`/datasets/${dataset.bucket}/${collection}`}
                className="btn btn-badge"
              >
                <DatasetTag isCollection>{collection}</DatasetTag>
              </Link>
            ))}
          </div>
        ),
        enableSorting: false,
      },
    ],
    [dataset, selectedVersion, toolParamUpdater],
  );

  const table = useReactTable({
    columns,
    data: dataset.versions,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    state: { sorting },
    filterFns: commonFilterFns,
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updateUrl(undefined, newSorting);
    },
    autoResetPageIndex: false,
  });

  return (
    <div className="h-full w-full">
      <TableBase
        columns={columns}
        table={table}
        paddingOffset={10}
        visible={visible}
      >
        <TablePagination
          table={table}
          totalRows={dataset.versions.length}
        />
      </TableBase>
    </div>
  );
};
