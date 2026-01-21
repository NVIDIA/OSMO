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
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type OSMOErrorResponse } from "~/models";
import {
  ServiceConfigSchema,
  ServiceConfigHistoryResponseSchema,
  type ServiceConfig,
  type ServiceConfigHistoryResponse,
} from "~/models/config/service-config";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

const ConfigHistoryRequestSchema = z.object({
  offset: z.number().default(0),
  limit: z.number().default(20),
  order: z.enum(["ASC", "DESC"]).default("DESC"),
  config_types: z.string().default("SERVICE"),
  omit_data: z.boolean().default(false),
});

const PatchServiceConfigRequestSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()),
  configs_dict: ServiceConfigSchema,
});

export const configsRouter = createTRPCRouter({
  getServiceConfig: publicProcedure.query(async ({ ctx }): Promise<ServiceConfig> => {
    const response = await OsmoApiFetch("/api/configs/service", ctx);
    if (!response.ok) {
      const data = (await response.json()) as OSMOErrorResponse;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message ?? "Unknown error",
      });
    }

    return (await response.json()) as ServiceConfig;
  }),

  patchServiceConfig: publicProcedure
    .input(PatchServiceConfigRequestSchema)
    .mutation(async ({ ctx, input }): Promise<ServiceConfig> => {
      const response = await OsmoApiFetch("/api/configs/service", ctx, undefined, input, "PATCH", true);
      if (!response.ok) {
        const data = (await response.json()) as OSMOErrorResponse;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: data.message ?? "Unknown error",
        });
      }

      return (await response.json()) as ServiceConfig;
    }),

  getConfigHistory: publicProcedure
    .input(ConfigHistoryRequestSchema)
    .query(async ({ ctx, input }): Promise<ServiceConfigHistoryResponse> => {
      const searchParams = new URLSearchParams();
      searchParams.append("offset", input.offset.toString());
      searchParams.append("limit", input.limit.toString());
      searchParams.append("order", input.order);
      searchParams.append("config_types", input.config_types);
      searchParams.append("omit_data", input.omit_data.toString());

      const response = await OsmoApiFetch("/api/configs/history", ctx, searchParams);
      if (!response.ok) {
        const data = (await response.json()) as OSMOErrorResponse;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: data.message ?? "Unknown error",
        });
      }

      const json = await response.json();
      return ServiceConfigHistoryResponseSchema.parse(json);
    }),
});

