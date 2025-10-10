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
import Link from "next/link";

import { Checkbox } from "~/components/Checkbox";
import { commonFilterFns } from "~/components/commonFilterFns";
import { TableBase } from "~/components/TableBase";
import { TableLoader } from "~/components/TableLoader";
import { TablePagination } from "~/components/TablePagination";
import { DatasetTag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type DataListEntry, DatasetTypesSchema } from "~/models";
import { convertBytes, convertToReadableTimezone, formatForWrapping, sortDateWithNA } from "~/utils/string";

import { type DatasetInfo } from "./CreateCollection";

export const datasetTypeToColorMap: Readonly<Record<DatasetTypesSchema, "green" | "blue" | "neutral">> = {
  [DatasetTypesSchema.Collection]: "green",
  [DatasetTypesSchema.Dataset]: "blue",
};

// Server-side filters: [allUsers, buckets, users]
// Client-side filters: [name]
const DatasetsTable: React.FC<{
  processResources: DataListEntry[];
  isLoading: boolean;
  onRowSelectionChange: (datasets: DatasetInfo[], bucket?: string) => void;
}> = ({ processResources, isLoading, onRowSelectionChange }) => {
  const updateUrl = useTableStateUrlUpdater();

  const sorting = useTableSortLoader("last_created", false);

  // Only show columns pertinent to the right type of data (Dataset/Collection)
  const [columnVisibility, setColumnVisibility] = useState({
    name: true,
    id: true,
    bucket: true,
    create_time: true,
    last_created: true,
    hash_location_size: true,
  } as Partial<Record<keyof DataListEntry, boolean>>);

  const columns = useMemo((): Array<ColumnDef<DataListEntry>> => {
    return [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            // Select All checkbox
            checked={table.getIsAllPageRowsSelected()}
            onChange={(event) => table.toggleAllPageRowsSelected(event.target.checked)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select Row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "bucket",
        header: "Bucket",
        cell: ({ row }) => row.original.bucket,
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <Link
            className="btn btn-badge inline-block"
            href={`/datasets/${row.original.bucket}/${row.original.name}`}
          >
            <DatasetTag isCollection={row.original.type === "COLLECTION"}>
              {formatForWrapping(row.original.name)}
            </DatasetTag>
          </Link>
        ),
        enableHiding: false,
        sortingFn: "alphanumeric",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        header: "Type",
        accessorKey: "type",
        cell: ({ row }) => (
          <DatasetTag
            isCollection={row.original.type === "COLLECTION"}
            className="inline-block"
          >
            {row.original.type}
          </DatasetTag>
        ),
        enableHiding: false,
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        header: "ID",
        accessorKey: "id",
        cell: ({ row }) => row.original.id,
        enableHiding: true,
        sortingFn: "basic",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "create_time",
        header: "Created Date",
        cell: ({ row }) => convertToReadableTimezone(row.original.create_time),
        sortingFn: sortDateWithNA,
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        accessorKey: "last_created",
        header: "Last Version Created",
        cell: ({ row }) => convertToReadableTimezone(row.original.last_created),
        sortingFn: sortDateWithNA,
        invertSorting: true,
        enableMultiSort: true,
      },
      {
        accessorKey: "version_id",
        header: "Last Version",
        cell: ({ row }) => row.original.version_id ?? "N/A",
        enableHiding: true,
        sortingFn: "alphanumeric",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "hash_location_size",
        header: "Storage Size",
        cell: ({ row }) =>
          row.original.type === DatasetTypesSchema.Dataset ? convertBytes(row.original.hash_location_size ?? 0) : "N/A",
        sortingFn: "basic",
        invertSorting: true,
        enableMultiSort: true,
      },
    ];
  }, []);

  const table = useReactTable({
    columns: columns,
    data: processResources,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    state: { sorting, columnVisibility },
    filterFns: commonFilterFns,
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updateUrl(undefined, newSorting);
    },
    autoResetPageIndex: false,
  });

  useEffect(() => {
    const selectedRows = table.getSelectedRowModel().rows;
    const selectedBuckets = new Set<string>(selectedRows.map((row) => row.original.bucket));

    onRowSelectionChange(
      Array.from(selectedRows).map((row) => ({
        name: row.original.name,
        type: row.original.type as DatasetTypesSchema,
        tags: row.original.type === DatasetTypesSchema.Dataset ? ["latest"] : [],
      })),
      selectedBuckets.size === 1 ? Array.from(selectedBuckets)[0] : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getSelectedRowModel().rows]);

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

export default DatasetsTable;
