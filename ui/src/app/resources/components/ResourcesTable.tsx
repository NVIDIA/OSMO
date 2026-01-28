//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import React, { useEffect, useMemo, useRef, useState } from "react";

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
import { Colors, Tag } from "~/components/Tag";
import { useTableSortLoader } from "~/hooks/useTableSortLoader";
import { useTableStateUrlUpdater } from "~/hooks/useTableStateUrlUpdater";
import { type ResourceAllocation } from "~/models";

import { type AggregateProps } from "./AggregatePanels";
import { type NodePoolAndPlatform, type ResourceListItem, checkResourceMatches } from "./ResourceDetails";
import { ResourceType } from "./ResourcesFilter";
import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

const showResourceAllocation = (value: ResourceAllocation, isShowingUsed: boolean) => {
  return isShowingUsed ? `${value.usage} / ${value.allocatable}` : `${value.allocatable - value.usage}`;
};

const sortResourceAllocation = (rowA: ResourceAllocation, rowB: ResourceAllocation, isShowingUsed: boolean) => {
  const a = isShowingUsed ? rowA.usage : rowA.allocatable - rowA.usage;
  const b = isShowingUsed ? rowB.usage : rowB.allocatable - rowB.usage;
  return a - b;
};

const ResourceButton = ({
  resource,
  selectedResource,
  updateUrl,
}: {
  resource: ResourceListItem;
  selectedResource?: NodePoolAndPlatform;
  updateUrl: (props: ToolParamUpdaterProps) => void;
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [selected] = useState(checkResourceMatches(resource, selectedResource));

  useEffect(() => {
    if (buttonRef.current && selected) {
      buttonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selected]);

  return (
    <button
      ref={buttonRef}
      className={`btn ${selected ? "btn-primary" : "btn-secondary"} table-action`}
      aria-label={`View details for ${resource.node}, ${resource.pool}, ${resource.platform}`}
      aria-current={selected}
      onClick={() =>
        updateUrl({
          selectedResource: resource,
        })
      }
    >
      {resource.node}
    </button>
  );
};

export const calculateAggregatesPerPool = (resources: ResourceListItem[]): Record<string, AggregateProps> => {
  const aggregatesByPool: Record<string, AggregateProps> = {};
  const processedNodes = new Set<string>();

  resources.forEach((resource) => {
    const pool = resource.pool || "N/A";
    const nodeKey = `${pool}:${resource.node}`;

    if (processedNodes.has(nodeKey)) {
      return;
    }

    const current = aggregatesByPool[pool] ?? {
      cpu: { allocatable: 0, usage: 0 },
      gpu: { allocatable: 0, usage: 0 },
      storage: { allocatable: 0, usage: 0 },
      memory: { allocatable: 0, usage: 0 },
    };

    aggregatesByPool[pool] = {
      cpu: {
        allocatable: current.cpu.allocatable + resource.cpu.allocatable,
        usage: current.cpu.usage + resource.cpu.usage,
      },
      gpu: {
        allocatable: current.gpu.allocatable + resource.gpu.allocatable,
        usage: current.gpu.usage + resource.gpu.usage,
      },
      storage: {
        allocatable: current.storage.allocatable + resource.storage.allocatable,
        usage: current.storage.usage + resource.storage.usage,
      },
      memory: {
        allocatable: current.memory.allocatable + resource.memory.allocatable,
        usage: current.memory.usage + resource.memory.usage,
      },
    };

    processedNodes.add(nodeKey);
  });

  return aggregatesByPool;
};

export const ResourcesTable = ({
  resources,
  isLoading,
  isShowingUsed,
  nodes,
  allNodes,
  filterResourceTypes,
  selectedResource,
  updateUrl,
}: {
  resources: ResourceListItem[];
  isLoading: boolean;
  isShowingUsed: boolean;
  nodes: string;
  allNodes?: boolean;
  filterResourceTypes?: string;
  selectedResource?: NodePoolAndPlatform;
  updateUrl: (props: ToolParamUpdaterProps) => void;
}) => {
  const updatePagingUrl = useTableStateUrlUpdater();
  const [columnFilters, setColumnFilters] = useState([
    { id: "node", value: allNodes ? undefined : nodes.split(",") },
    { id: "resourceType", value: filterResourceTypes?.split(",") },
  ] as Array<{ id: keyof ResourceListItem; value: unknown }>);

  const sorting = useTableSortLoader("node", true);

  /**
   * Cached convertion from API response to table row objects
   * @see resources.py for implementation
   */
  useEffect(() => {
    setColumnFilters((prev) => [
      ...prev.filter(({ id }) => id !== "node"),
      { id: "node", value: allNodes ? undefined : nodes.split(",") },
      { id: "resourceType", value: filterResourceTypes?.split(",") ?? [ResourceType.RESERVED, ResourceType.SHARED] },
    ]);
  }, [nodes, filterResourceTypes, allNodes]);

  const resourceTableColumns = useMemo((): Array<ColumnDef<ResourceListItem>> => {
    return [
      {
        header: "Node",
        accessorKey: "node",
        cell: ({ row }) => (
          <ResourceButton
            resource={row.original}
            selectedResource={selectedResource}
            updateUrl={updateUrl}
          />
        ),
        sortingFn: "alphanumericCaseSensitive",
        invertSorting: true,
        enableMultiSort: true,
        enableHiding: false,
        filterFn: commonFilterFns.multi as ColumnDef<ResourceListItem>["filterFn"],
      },
      {
        accessorKey: "pool",
        header: "Pool",
        cell: ({ row }) => {
          return row.original.pool ? (
            <Link
              href={`/pools/${row.original.pool}?platform=${row.original.platform}`}
              className="tag-container"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Tag color={Colors.pool}>{row.original.pool}</Tag>
            </Link>
          ) : (
            "N/A"
          );
        },
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "platform",
        header: "Platform",
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        cell: ({ row }) =>
          row.original.platform ? (
            <Link
              href={`/pools/${row.original.pool}?platform=${row.original.platform}`}
              className="tag-container"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Tag color={Colors.platform}>{row.original.platform}</Tag>
            </Link>
          ) : undefined,
      },
      {
        accessorKey: "gpu",
        header: "GPU [#]",
        cell: ({ row }) => {
          return showResourceAllocation(row.original.gpu, isShowingUsed);
        },
        sortingFn: (rowA, rowB) => {
          return sortResourceAllocation(rowA.original.gpu, rowB.original.gpu, isShowingUsed);
        },
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "storage",
        header: "Storage [Gi]",
        cell: ({ row }) => {
          return showResourceAllocation(row.original.storage, isShowingUsed);
        },
        sortingFn: (rowA, rowB) => {
          return sortResourceAllocation(rowA.original.storage, rowB.original.storage, isShowingUsed);
        },
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "cpu",
        header: "CPU [#]",
        cell: ({ row }) => {
          return showResourceAllocation(row.original.cpu, isShowingUsed);
        },
        sortingFn: (rowA, rowB) => {
          return sortResourceAllocation(rowA.original.cpu, rowB.original.cpu, isShowingUsed);
        },
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "memory",
        header: "Memory [Gi]",
        cell: ({ row }) => {
          return showResourceAllocation(row.original.memory, isShowingUsed);
        },
        sortingFn: (rowA, rowB) => {
          return sortResourceAllocation(rowA.original.memory, rowB.original.memory, isShowingUsed);
        },
        enableMultiSort: true,
        invertSorting: true,
      },
      {
        accessorKey: "resourceType",
        header: "Type",
        sortingFn: "alphanumericCaseSensitive",
        enableMultiSort: true,
        invertSorting: true,
        filterFn: commonFilterFns.multi as ColumnDef<ResourceListItem>["filterFn"],
      },
    ];
  }, [isShowingUsed, selectedResource, updateUrl]);

  const table = useReactTable({
    columns: resourceTableColumns,
    data: resources,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    onColumnFiltersChange: setColumnFilters,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => `${row.node}-${row.pool}`,
    enableMultiSort: true,
    enableSortingRemoval: false,
    state: { columnFilters, sorting },
    onSortingChange: (updater) => {
      const newSorting = updater instanceof Function ? updater(sorting) : updater;
      updatePagingUrl(undefined, newSorting);
    },
    filterFns: commonFilterFns,
    autoResetPageIndex: false,
  });

  return (
    <TableBase
      columns={resourceTableColumns}
      table={table}
      className="body-component"
      isLoading={isLoading}
    >
      <TablePagination
        totalRows={resources.length}
        table={table}
      />
    </TableBase>
  );
};
