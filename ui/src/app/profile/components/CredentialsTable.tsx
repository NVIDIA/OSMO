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
import { OutlinedIcon } from "~/components/Icon";
import { TableBase } from "~/components/TableBase";
import { TablePagination } from "~/components/TablePagination";
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type CredentialListItem, CredentialTypes } from "~/models";

import useToolParamUpdater, { ToolType } from "../hooks/useToolParamUpdater";

const typeToColorMap: Readonly<Record<CredentialTypes, Colors>> = {
  [CredentialTypes.Data]: Colors.tag,
  [CredentialTypes.Registry]: Colors.pool,
  [CredentialTypes.Generic]: Colors.neutral,
};

const CredentialsTable = ({ credentials, nameFilter }: { credentials: CredentialListItem[]; nameFilter: string }) => {
  const toolParamUpdater = useToolParamUpdater();
  const sorting = useTableSortLoader("cred_name", true);
  const updateUrl = useTableStateUrlUpdater();

  const [columnFilters, setColumnFilters] = useState([{ id: "cred_name", value: nameFilter }] as Array<{
    id: keyof CredentialListItem;
    value: unknown;
  }>);

  const columns = useMemo((): Array<ColumnDef<CredentialListItem>> => {
    return [
      {
        header: "Credential Name",
        accessorKey: "cred_name",
        cell: ({ row }) => row.original.cred_name,
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        enableHiding: false,
      },
      {
        accessorKey: "cred_type",
        filterFn: commonFilterFns.multi as ColumnDef<CredentialListItem>["filterFn"],
        header: "Type",
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        cell: ({ row }) => (
          <Tag
            className="inline-block"
            color={typeToColorMap[row.original.cred_type] ?? Colors.neutral}
          >
            {row.original.cred_type ?? "N/A"}
          </Tag>
        ),
      },
      {
        accessorKey: "profile",
        header: "Profile",
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        cell: ({ row }) => {
          return row.original.profile ?? "N/A";
        },
        enableHiding: false,
      },
      {
        header: "Action",
        enableSorting: false,
        cell: ({ row }) => (
          <button
            className="btn btn-badge"
            title={`Delete credential ${row.original.cred_name}`}
            onClick={() => {
              toolParamUpdater({ tool: ToolType.DeleteCredential, credential: row.original.cred_name });
            }}
            aria-label={`Delete credential ${row.original.cred_name}`}
          >
            <Tag color={Colors.error}>
              <div className="flex flex-row gap-1 items-center">
                <OutlinedIcon
                  name="delete"
                  className="text-sm!"
                />
                Delete
              </div>
            </Tag>
          </button>
        ),
        enableHiding: false,
      },
    ];
  }, [toolParamUpdater]);

  const table = useReactTable({
    columns: columns,
    data: credentials,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    onColumnFiltersChange: setColumnFilters,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    state: { columnFilters, sorting },
    filterFns: commonFilterFns,
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updateUrl(undefined, newSorting);
    },
    autoResetPageIndex: false,
  });

  useEffect(() => {
    setColumnFilters((prev) => [
      ...prev.filter(({ id }) => id !== "cred_name"),
      { id: "cred_name", value: nameFilter },
    ]);
  }, [nameFilter]);

  return (
    <TableBase
      columns={columns}
      table={table}
      paddingOffset={10}
    >
      <TablePagination
        table={table}
        totalRows={credentials.length}
      />
    </TableBase>
  );
};

export default CredentialsTable;
