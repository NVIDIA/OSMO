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
  type PoolsListResponse,
  type PoolsQuotaResponse,
  PoolsQuotaRequestSchema,
  ResourceInfoRequestSchema,
  type ResourceInfoResponse,
  ResourcesRequestSchema,
  type ResourcesResponse,
} from "~/models";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

export const resourcesRouter = createTRPCRouter({
  listResources: publicProcedure.input(ResourcesRequestSchema).query(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams({
        all_pools: input.all_pools.toString(),
      });

      input.pools?.forEach((pool) => {
        searchParams.append("pools", pool);
      });

      input.platforms?.forEach((platform) => {
        searchParams.append("platforms", platform);
      });

      const response = await OsmoApiFetch("/api/resources", ctx, searchParams);
      const data = (await response.json()) as ResourcesResponse;
      return data.resources;
    } catch (e) {
      return [];
    }
  }),
  getResourceInfo: publicProcedure.input(ResourceInfoRequestSchema).query(async ({ ctx, input }) => {
    try {
      const response = await OsmoApiFetch(`/api/resources/${input.name}`, ctx);
      const data = (await response.json()) as ResourceInfoResponse;
      return data.resources;
    } catch (e) {
      return {
        message: `Unknown error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  getPools: publicProcedure.query(async ({ ctx }) => {
    try {
      const response = await OsmoApiFetch("/api/pool", ctx);
      const data = (await response.json()) as PoolsListResponse;
      return data;
    } catch (e) {
      return [];
    }
  }),
  getPoolsQuota: publicProcedure.input(PoolsQuotaRequestSchema).query(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams({
        all_pools: input.all_pools.toString(),
      });

      input.pools?.forEach((pool) => {
        searchParams.append("pools", pool);
      });

      const response = await OsmoApiFetch("/api/pool_quota", ctx, searchParams);
      const data = (await response.json()) as PoolsQuotaResponse;
      return data;
    } catch (e) {
      return [];
    }
  }),
});
