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

import { useEffect, useRef, useState } from "react";

import { type ColumnDef, flexRender, type Table } from "@tanstack/react-table";
import { useWindowSize } from "usehooks-ts";

import { CheckboxWithLabel } from "./Checkbox";
import { OutlinedIcon } from "./Icon";
import { SlideOut } from "./SlideOut";

export function TableBase<TData, TValue>({
  columns,
  table,
  children,
  paddingOffset = 2,
  className,
  visible = true,
}: {
  columns: ColumnDef<TData, TValue>[];
  table: Table<TData>;
  children?: React.ReactNode;
  paddingOffset?: number;
  className?: string;
  visible?: boolean;
}) {
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLTableSectionElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const windowSize = useWindowSize();
  const [scrollerHeight, setScrollerHeight] = useState(0);
  const pagination = table.getState().pagination;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (containerRef?.current) {
      const top = containerRef.current.getBoundingClientRect().top;
      setScrollerHeight(windowSize.height - top - paddingOffset);
    }
  }, [windowSize.height, paddingOffset, visible]);

  useEffect(() => {
    if (containerRef?.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [pagination.pageSize, table, pagination.pageIndex]);

  return (
    <div
      ref={outerContainerRef}
      className="relative"
    >
      <div
        ref={containerRef}
        style={{ height: scrollerHeight }}
        className={`relative overflow-auto flex h-full justify-between flex-col ${className}`}
      >
        <table className="border-separate border-spacing-y-0">
          <thead
            className="body-header sticky top-0 z-20"
            ref={headerRef}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => {
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                      }
                    >
                      <div className="flex flex-row gap-3 justify-between">
                        {header.column.getCanSort() ? (
                          <button
                            className="btn btn-action"
                            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                              header.column.toggleSorting(undefined, event.shiftKey);
                            }}
                            title="Click to sort. Hold SHIFT and click on another header to sort by multiple columns."
                          >
                            <span>
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            <span>
                              {header.column.getIsSorted() === "asc"
                                ? "↓"
                                : header.column.getIsSorted() === "desc"
                                  ? "↑"
                                  : null}
                            </span>
                          </button>
                        ) : header.isPlaceholder ? null : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                        {index === headerGroup.headers.length - 1 && (
                          <button
                            className={`btn btn-action`}
                            title="Show/Hide Columns"
                            onClick={() => {
                              if (!open) {
                                setOpen(true);
                              }
                            }}
                          >
                            <OutlinedIcon name="playlist_add_check" />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <p aria-live="polite">No results.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {children && <div className="body-footer sticky bottom-0 z-20">{children}</div>}
      </div>
      <SlideOut
        id="table-column-selector"
        open={open}
        onClose={() => setOpen(false)}
        top={headerRef.current?.offsetHeight ?? 0}
        containerRef={outerContainerRef}
        heightOffset={12}
        aria-label="Show/Hide Columns"
        className="border-t-0 shadow-lg mr-4"
        bodyClassName="body-header"
        dimBackground={false}
      >
        <CheckboxWithLabel
          checked={table.getIsAllColumnsVisible()}
          onChange={(event) => table.toggleAllColumnsVisible(Boolean(event.target.checked))}
          label="Toggle All"
          containerClassName="px-3 py-2 mb-2 border-b border-gray-200"
        />
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <CheckboxWithLabel
              key={column.id}
              checked={column.getIsVisible()}
              onChange={(event) => column.toggleVisibility(Boolean(event.target.checked))}
              label={column.id}
              containerClassName="px-3 pb-1"
            />
          ))}
      </SlideOut>
    </div>
  );
}
