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
import React, { useEffect, useMemo, useRef } from "react";

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
import { TableLoader } from "~/components/TableLoader";
import { TablePagination } from "~/components/TablePagination";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";

import { PoolStatus } from "./PoolStatus";
import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";
import { type PoolListItem } from "../models/PoolListitem";

const PoolButton = ({
  pool,
  selectedPool,
  updateUrl,
  disableScrollIntoView = false,
}: {
  pool: string;
  selectedPool?: string;
  updateUrl: (props: ToolParamUpdaterProps) => void;
  disableScrollIntoView?: boolean;
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = pool === selectedPool;

  useEffect(() => {
    if (buttonRef.current && selected && !disableScrollIntoView) {
      buttonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selected, disableScrollIntoView]);

  return (
    <button
      ref={buttonRef}
      className={`btn ${selected ? "btn-primary" : "btn-secondary"} table-action whitespace-nowrap`}
      aria-label={`View details for ${pool}`}
      aria-current={selected}
      onClick={() =>
        updateUrl({
          selectedPool: pool,
        })
      }
    >
      {pool}
    </button>
  );
};

export const PoolsTable = ({
  pools,
  isLoading,
  isShowingUsed,
  selectedPool,
  updateUrl,
}: {
  pools: PoolListItem[];
  isLoading: boolean;
  isShowingUsed: boolean;
  selectedPool?: string;
  updateUrl: (props: ToolParamUpdaterProps) => void;
}) => {
  const updatePagingUrl = useTableStateUrlUpdater();

  const sorting = useTableSortLoader("name", true);

  const columns = useMemo((): Array<ColumnDef<PoolListItem>> => {
    const columns: Array<ColumnDef<PoolListItem>> = [
      {
        header: "Pool",
        accessorKey: "name",
        cell: ({ row }) => (
          <PoolButton
            pool={row.original.name}
            selectedPool={selectedPool}
            updateUrl={updateUrl}
            disableScrollIntoView={false}
          />
        ),
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        enableHiding: false,
      },
      {
        accessorKey: "sharedPools",
        header: "Shared Pools",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.sharedPools.map((pool) => (
              <PoolButton
                key={pool}
                pool={pool}
                selectedPool={selectedPool}
                updateUrl={updateUrl}
                disableScrollIntoView={true}
              />
            ))}
          </div>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => {
          return row.original.description;
        },
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          return <PoolStatus status={row.original.status} />;
        },
        enableMultiSort: true,
        invertSorting: true,
      },
    ];
    if (isShowingUsed) {
      columns.push({
        accessorKey: "quotaUsed",
        header: "Quota Used",
        cell: ({ row }) => {
          return row.original.resource_usage?.quota_used ?? 0;
        },
      });

      columns.push({
        accessorKey: "quotaLimit",
        header: "Quota Limit",
        cell: ({ row }) => {
          return row.original.resource_usage?.quota_limit ?? 0;
        },
      });

      columns.push({
        accessorKey: "totalUsage",
        header: "Total Usage",
        cell: ({ row }) => {
          return row.original.resource_usage?.total_usage ?? 0;
        },
      });

      columns.push({
        accessorKey: "totalCapacity",
        header: "Total Capacity",
        cell: ({ row }) => {
          return row.original.resource_usage?.total_capacity ?? 0;
        },
      });
    } else {
      columns.push({
        accessorKey: "quotaFree",
        header: "Quota Free",
        cell: ({ row }) => {
          return row.original.resource_usage?.quota_free ?? 0;
        },
      });

      columns.push({
        accessorKey: "totalFree",
        header: "Total Free",
        cell: ({ row }) => {
          return row.original.resource_usage?.total_free ?? 0;
        },
      });
    }

    return columns;
  }, [isShowingUsed, selectedPool, updateUrl]);

  const table = useReactTable({
    columns: columns,
    data: pools,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    enableSortingRemoval: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updatePagingUrl(undefined, newSorting);
    },
    filterFns: commonFilterFns,
  });

  return (
    <div className="h-full w-full">
      {isLoading ? (
        <TableLoader table={table} />
      ) : (
        <TableBase
          columns={columns}
          table={table}
          paddingOffset={10}
          className="body-component"
        >
          <TablePagination
            totalRows={pools.length}
            table={table}
          />
        </TableBase>
      )}
    </div>
  );
};
