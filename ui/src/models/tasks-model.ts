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
import { z } from "zod";

import { OrderValues, PriorityValues, TaskStatusValues } from "./workflows-model";

/**
 * Schema for task list request parameters
 */
export const TaskListRequestSchema = z.object({
  limit: z.number().min(1).max(1000),
  order: z.enum(OrderValues).default("DESC"),
  all_users: z.boolean().default(false),
  all_pools: z.boolean().default(false),
  offset: z.number().min(0).default(0),
  workflow_id: z.string().optional(),
  started_before: z.string().optional(),
  started_after: z.string().optional(),
  users: z.array(z.string()).default([]),
  pools: z.array(z.string()).default([]),
  nodes: z.array(z.string()).default([]),
  statuses: z.array(z.enum(TaskStatusValues)).default([]),
  priority: z.enum(PriorityValues).optional(),
  summary: z.boolean().default(false),
  aggregate_by_workflow: z.boolean().default(false),
});

export type TaskListRequest = z.infer<typeof TaskListRequestSchema>;

/**
 * Individual task item structure
 */
export const TaskListItemSchema = z.object({
  user: z.string(),
  workflow_id: z.string(),
  workflow_uuid: z.string(),
  task_name: z.string(),
  retry_id: z.number(),
  pool: z.string(),
  node: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  duration: z.number().nullable(),
  status: z.enum(TaskStatusValues),
  overview: z.string(),
  logs: z.string(),
  error_logs: z.string().nullable(),
  grafana_url: z.string(),
  dashboard_url: z.string(),
  storage: z.number(),
  cpu: z.number(),
  memory: z.number(),
  gpu: z.number(),
  priority: z.enum(PriorityValues),
});

export type TaskListItem = z.infer<typeof TaskListItemSchema>;

/**
 * Task list response structure
 */
export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskListItemSchema),
});

export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const TaskSummaryListItemSchema = z.object({
  user: z.string(),
  pool: z.string(),
  storage: z.number(),
  cpu: z.number(),
  memory: z.number(),
  gpu: z.number(),
  priority: z.enum(PriorityValues),
  workflow_id: z.string().nullable(),
});

export type TaskSummaryListItem = z.infer<typeof TaskSummaryListItemSchema>;

/**
 * Task list response structure
 */
export const TaskSummaryListResponseSchema = z.object({
  summaries: z.array(TaskSummaryListItemSchema),
});

export type TaskSummaryListResponse = z.infer<typeof TaskSummaryListResponseSchema>;
