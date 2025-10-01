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
import {
  type OSMOErrorResponse,
  WorkflowSetTagsRequestSchema,
  WorkflowTagsRequestSchema,
  type WorkflowTagsResponse,
} from "~/models";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

export const tagsRouter = createTRPCRouter({
  editWorkflowTags: publicProcedure.input(WorkflowSetTagsRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams();

      input.add?.forEach((tag) => {
        searchParams.append("add", tag);
      });

      input.remove?.forEach((tag) => {
        searchParams.append("remove", tag);
      });

      const response = await OsmoApiFetch(`/api/workflow/${input.name}/tag`, ctx, searchParams, undefined, "POST");

      return (await response.json()) as null;
    } catch (e) {
      return {
        message: `Error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  getTags: publicProcedure.input(WorkflowTagsRequestSchema).query(async ({ ctx }) => {
    try {
      const response = await OsmoApiFetch("/api/tag", ctx);
      const data = (await response.json()) as WorkflowTagsResponse;

      return data;
    } catch (e) {
      return [];
    }
  }),
});
