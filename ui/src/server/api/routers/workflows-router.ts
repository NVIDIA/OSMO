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
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { TRPCError } from "@trpc/server";
import { parse, stringify } from "yaml";
import { z } from "zod";

import {
  CancelWorkflowRequestSchema,
  type CancelWorkflowResponse,
  CreateWorkflowRequestSchema,
  type CreateWorkflowResponse,
  CreateWorkflowResponseSchema,
  ExecWorkflowRequestSchema,
  type ExecWorkflowResponse,
  type OSMOErrorResponse,
  WebServerWorkflowRequestSchema,
  WorkflowListRequestSchema,
  type WorkflowListResponse,
  WorkflowLogsRequestSchema,
  type WorkflowLogsResponse,
  WorkflowRequestSchema,
  type WorkflowResponse,
  WorkflowSpecRequestSchema,
} from "~/models";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

const replaceLocalPath = (currentSpec: any, previousRenderedSpec: any): any => {
  const currentGroups = currentSpec.workflow?.groups || [];
  const previousGroups = previousRenderedSpec.workflow?.groups || [];
  const currentTasks = currentSpec.workflow?.tasks || [];
  const previousTasks = previousRenderedSpec.workflow?.tasks || [];

  // Create a map from the second YAML to easily find files by group/task name and path
  const fileMap = new Map<string, object>();
  if (currentGroups.length > 0) {
    for (const group of previousGroups) {
      for (const task of group.tasks || []) {
        for (const file of task.files || []) {
          const key = `${group.name}-${task.name}-${file.path}`;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          fileMap.set(key, file);
        }
      }
    }

    // Update the first YAML data
    for (const group of currentGroups) {
      for (const task of group.tasks || []) {
        for (let i = 0; i < task.files.length; i++) {
          const file = task.files[i];
          if (file.localpath) {
            const key = `${group.name}-${task.name}-${file.path}`;
            if (fileMap.has(key)) {
              // Replace the file with 'localpath' with the corresponding 'contents' file
              task.files[i] = fileMap.get(key);
            }
          }
        }
      }
    }
  } else {
    for (const task of previousTasks) {
      for (const file of task.files || []) {
        const key = `${task.name}-${file.path}`;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        fileMap.set(key, file);
      }
    }

    // Update the first YAML data
    for (const task of currentTasks) {
      for (let i = 0; i < task.files.length; i++) {
        const file = task.files[i];
        if (file.localpath) {
          const key = `${task.name}-${file.path}`;
          if (fileMap.has(key)) {
            task.files[i] = fileMap.get(key);
          }
        }
      }
    }
  }

  return currentSpec;
};

export const workflowsRouter = createTRPCRouter({
  getList: publicProcedure.input(WorkflowListRequestSchema).query(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams({
        limit: input.limit.toString(10),
        order: input.order,
        all_users: input.all_users.toString(),
        all_pools: input.all_pools.toString(),
        name: input.name,
      });

      if (input.submitted_before) {
        searchParams.append("submitted_before", input.submitted_before);
      }

      if (input.submitted_after) {
        searchParams.append("submitted_after", input.submitted_after);
      }

      input.users.forEach((user) => {
        searchParams.append("users", user);
      });

      input.pools.forEach((pool) => {
        searchParams.append("pools", pool);
      });

      input.tags.forEach((tag) => {
        searchParams.append("tags", tag);
      });

      input.statuses.forEach((status) => {
        searchParams.append("statuses", status);
      });

      if (input.priority) {
        searchParams.append("priority", input.priority);
      }

      const response = await OsmoApiFetch("/api/workflow", ctx, searchParams);
      const data = (await response.json()) as WorkflowListResponse;

      return data.workflows;
    } catch (e) {
      return [];
    }
  }),
  getWorkflow: publicProcedure.input(WorkflowRequestSchema).query(async ({ ctx, input }) => {
    const response = await OsmoApiFetch(`/api/workflow/${input.name}?verbose=${input.verbose}`, ctx);
    const data = await response.json();

    if (!response.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message ?? "Unknown error",
      });
    }

    if ("error_code" in data) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message,
      });
    }

    return data as WorkflowResponse;
  }),
  getWorkflowLogs: publicProcedure.input(WorkflowLogsRequestSchema).query(async ({ ctx, input }) => {
    try {
      const response = await OsmoApiFetch(`/api/workflow/${input.name}/logs`, ctx);

      return (await response.json()) as WorkflowLogsResponse;
    } catch (e) {
      return [];
    }
  }),
  getWorkflowSpec: publicProcedure.input(WorkflowSpecRequestSchema).query(async ({ ctx, input }): Promise<string> => {
    const searchParams = new URLSearchParams({
      use_template: input.use_template.toString(),
    });

    const response = await OsmoApiFetch(`/api/workflow/${input.name}/spec`, ctx, searchParams);

    if (!response.ok) {
      const data = (await response.json()) as OSMOErrorResponse;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message ?? "Unknown error",
      });
    }

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let result = "";

      // Stream log lines until it reaches the end
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        } else {
          result += decoder.decode(value);
        }
      }
      return result;
    }
    return await response.text();
  }),
  cancel: publicProcedure.input(CancelWorkflowRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams();
      if (input.message) {
        searchParams.set("message", input.message);
      }
      if (input.force) {
        searchParams.set("force", input.force.toString());
      }

      const url = `/api/workflow/${input.name}/cancel${searchParams.size ? `?${searchParams.toString()}` : ""}`;

      const response = await OsmoApiFetch(url, ctx, undefined, undefined, "POST", true);

      return (await response.json()) as CancelWorkflowResponse;
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  create: publicProcedure.input(CreateWorkflowRequestSchema).mutation(async ({ ctx, input }) => {
    type SubmitRequestBody = Record<string, unknown> & {
      file: string;
      set_variables: string[];
      uploaded_templated_spec?: string; // Optional
    };

    let submissionFile = input.file;
    const submissionSpec = input.file;
    let requestBody: SubmitRequestBody = {
      file: submissionSpec,
      set_variables: input.set_variables,
    };
    try {
      // First call receives spec generated from templated submission
      if (input.dry_run) {
        const dryRunRequestBody = {
          file: submissionSpec,
          set_variables: input.set_variables,
        };

        const submitDryRunParams = new URLSearchParams({
          dry_run: input.dry_run.toString(),
          priority: input.priority,
        });

        const response = await OsmoApiFetch(
          `/api/pool/${input.pool_name}/workflow`,
          ctx,
          submitDryRunParams,
          dryRunRequestBody,
          "POST",
          true,
        );

        if (response.ok) {
          const data = CreateWorkflowResponseSchema.parse(await response.json());
          submissionFile = data.spec!;
        } else {
          return (await response.json()) as OSMOErrorResponse;
        }
      }

      // Allow for localpath substitution even if workflow has no templating
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const currentSpecObject = parse(submissionFile);
        const prevRenderedSpecObject = parse(input.renderedSpec);
        replaceLocalPath(currentSpecObject, prevRenderedSpecObject);

        // Set the file to the currentSpecObject that has references to localpath
        // replaced with actual contents
        const currRenderedSpec = stringify(currentSpecObject);
        requestBody = {
          uploaded_templated_spec: submissionSpec,
          file: currRenderedSpec,
          set_variables: input.set_variables,
        };
      } catch (e) {
        // If there is something wrong with the input file, we just propagate it to
        // the request and let the service return the failure
        console.error("Error loading YAML:", e);
      }

      const response = await OsmoApiFetch(
        `/api/pool/${input.pool_name}/workflow`,
        ctx,
        new URLSearchParams({ priority: input.priority }),
        requestBody,
        "POST",
        true,
      );

      if (response.ok) {
        return (await response.json()) as CreateWorkflowResponse;
      } else {
        return (await response.json()) as OSMOErrorResponse;
      }
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  retry: publicProcedure.input(z.object({ name: z.string() })).mutation(async ({ ctx, input }) => {
    try {
      const submitParams = new URLSearchParams({
        workflow_id: input.name,
      });
      const requestBody = { workflow_id: input.name };

      const response = await OsmoApiFetch("/api/workflow", ctx, submitParams, requestBody, "POST", true);

      if (response.ok) {
        return (await response.json()) as CreateWorkflowResponse;
      } else {
        return (await response.json()) as OSMOErrorResponse;
      }
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  exec: publicProcedure.input(ExecWorkflowRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const response = await OsmoApiFetch(
        `/api/workflow/${input.name}/exec/task/${input.task}?entry_command=${input.entry_command}`,
        ctx,
        undefined,
        undefined,
        "POST",
        true,
      );

      return (await response.json()) as ExecWorkflowResponse;
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  webServer: publicProcedure.input(WebServerWorkflowRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const response = await OsmoApiFetch(
        `/api/workflow/${input.name}/webserver/${input.task}?task_port=${input.port}`,
        ctx,
        undefined,
        undefined,
        "POST",
        true,
      );

      return (await response.json()) as ExecWorkflowResponse;
    } catch (e) {
      return { message: `Unknown error occured!\n ${e as string}` } as OSMOErrorResponse;
    }
  }),
});
