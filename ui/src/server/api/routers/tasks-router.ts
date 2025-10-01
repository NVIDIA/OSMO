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
import { TRPCError } from "@trpc/server";

import { type TaskListRequest, TaskListRequestSchema, type TaskListResponse, type TaskListItem, type TaskSummaryListResponse, type TaskSummaryListItem } from "~/models/tasks-model";
import { type OSMOErrorResponse } from "~/models/workflows-model";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

const prepareSearchParams = (input: TaskListRequest) => {
  const searchParams = new URLSearchParams({
    limit: input.limit.toString(10),
    order: input.order,
    all_users: input.all_users.toString(),
    all_pools: input.all_pools.toString(),
    offset: input.offset.toString(10),
    summary: input.summary.toString(),
    aggregate_by_workflow: input.aggregate_by_workflow.toString(),
  });

  if (input.workflow_id) {
    searchParams.append("workflow_id", input.workflow_id);
  }

  if (input.started_before) {
    searchParams.append("started_before", input.started_before);
  }

  if (input.started_after) {
    searchParams.append("started_after", input.started_after);
  }

  input.users.forEach((user) => {
    searchParams.append("users", user);
  });

  input.pools.forEach((pool) => {
    searchParams.append("pools", pool);
  });

  input.nodes.forEach((node) => {
    searchParams.append("nodes", node);
  });

  input.statuses.forEach((status) => {
    searchParams.append("statuses", status);
  });

  if (input.priority) {
    searchParams.append("priority", input.priority);
  }

  return searchParams;
};

export const tasksRouter = createTRPCRouter({
  getList: publicProcedure.input(TaskListRequestSchema).query(async ({ ctx, input }): Promise<TaskListItem[]> => {
    const searchParams = prepareSearchParams(input);
    const response = await OsmoApiFetch("/api/task", ctx, searchParams);

    if (!response.ok) {
      const data = (await response.json()) as OSMOErrorResponse;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message ?? "Unknown error",
      });
    }

    const data = (await response.json()) as TaskListResponse;
    return data.tasks;
  }),
  getSummaryList: publicProcedure.input(TaskListRequestSchema).query(async ({ ctx, input }): Promise<TaskSummaryListItem[]> => {
    const searchParams = prepareSearchParams(input);
    const response = await OsmoApiFetch("/api/task", ctx, searchParams);

    if (!response.ok) {
      const data = (await response.json()) as OSMOErrorResponse;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message ?? "Unknown error",
      });
    }

    const data = (await response.json()) as TaskSummaryListResponse;
    return data.summaries;
  }),
});
