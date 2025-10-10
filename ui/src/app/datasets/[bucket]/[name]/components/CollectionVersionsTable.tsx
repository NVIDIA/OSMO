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
import React, { useEffect, useMemo, useState } from "react";

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
import { DatasetTag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import type { DataInfoCollectionEntry, DataInfoResponseCollection } from "~/models";
import { convertBytes } from "~/utils/string";

export const CollectionVersionsTable: React.FC<{
  collection: DataInfoResponseCollection;
  nameFilter?: string;
}> = ({ collection, nameFilter = "" }) => {
  const sorting = useTableSortLoader("collection", true);
  const updateUrl = useTableStateUrlUpdater();

  const columns: Array<ColumnDef<DataInfoCollectionEntry & { bucket: string }>> = useMemo(
    () => [
      {
        header: "Dataset",
        accessorKey: "name",
        cell: ({ row }) => (
          <Link
            className="btn btn-badge inline-block"
            href={`/datasets/${row.original.bucket}/${row.original.name}?version=${row.original.version}`}
          >
            <DatasetTag isCollection={false}>{row.original.name}</DatasetTag>
          </Link>
        ),
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        enableHiding: false,
      },
      {
        header: "Version",
        accessorKey: "version",
        cell: ({ row }) => row.original.version,
        sortingFn: "alphanumericCaseSensitive",
        enableSorting: true,
        enableColumnFilter: false,
        enableHiding: false,
      },
      {
        header: "Size",
        accessorKey: "size",
        cell: ({ row }) => convertBytes(row.original.size),
        sortingFn: "alphanumericCaseSensitive",
        enableSorting: true,
        enableColumnFilter: true,
        enableHiding: true,
      },
    ],
    [],
  );

  const [columnFilters, setColumnFilters] = useState<Array<{ id: keyof DataInfoCollectionEntry; value: unknown }>>([]);

  // Clientside name filter
  useEffect(() => {
    setColumnFilters([{ id: "name", value: nameFilter }]);
  }, [nameFilter]);

  // Memoizing the construction of the versions object that includes the collection bucket
  const versionsWithBuckets = useMemo(() => {
    if (!collection?.versions) return [];

    return collection.versions.map((version) => ({
      ...version,
      bucket: collection.bucket,
    }));
  }, [collection]);

  const table = useReactTable({
    columns: columns,
    data: versionsWithBuckets,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    onColumnFiltersChange: setColumnFilters,
    enableMultiSort: true,
    enableSortingRemoval: false,
    state: { sorting, columnFilters },
    filterFns: commonFilterFns,
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updateUrl(undefined, newSorting);
    },
    autoResetPageIndex: false,
  });

  return (
    <TableBase
      columns={columns}
      table={table}
      paddingOffset={12}
      className="body-component"
    >
      <TablePagination
        table={table}
        totalRows={versionsWithBuckets.length}
      />
    </TableBase>
  );
};
