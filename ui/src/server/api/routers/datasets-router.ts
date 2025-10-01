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
import z from "zod";

import {
  AttributeDatasetRequestSchema,
  type AttributeDatasetResponse,
  BucketInfoRequestSchema,
  type BucketInfoResponse,
  CreateCollectionRequestSchema,
  type DataInfoResponse,
  DataListRequestSchema,
  type DataListResponse,
  DatasetInfoRequestSchema,
  type DatasetTypesSchema,
  DeleteDatasetRequestSchema,
  type DeleteDatasetResponse,
  type FileDataItem,
  type OSMOErrorResponse,
} from "~/models";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";
import { throwTrpcErrorFromResponse } from "~/utils/trpc-error";

export const datasetsRouter = createTRPCRouter({
  getFiles: publicProcedure.input(z.object({ url: z.string() })).query(async ({ input }) => {
      const response = await fetch(input.url);

      if (response.ok) {
        const data = (await response.json()) as FileDataItem[];
        return data;
      } else {
        await throwTrpcErrorFromResponse(response);
      }
  }),
  getBucketInfo: publicProcedure.input(BucketInfoRequestSchema).query(async ({ ctx }) => {
    try {
      const response = await OsmoApiFetch("/api/bucket", ctx);
      const data = (await response.json()) as BucketInfoResponse;
      return data.buckets;
    } catch (e) {
      return [];
    }
  }),
  getDatasetList: publicProcedure.input(DataListRequestSchema).query(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams({
        order: input.order,
        all_users: input.all_users.toString(),
      });

      if (input.dataset_type) {
        searchParams.append("dataset_type", input.dataset_type);
      }

      if (input.name) {
        searchParams.append("name", input.name);
      }

      if (input.count) {
        searchParams.append("count", input.count.toString());
      }

      if (input.latest_before) {
        searchParams.append("latest_before", input.latest_before);
      }

      if (input.latest_after) {
        searchParams.append("latest_after", input.latest_after);
      }

      input.buckets.forEach((bucket) => {
        searchParams.append("buckets", bucket);
      });

      input.users.forEach((user) => {
        searchParams.append("user", user);
      });

      const response = await OsmoApiFetch("/api/bucket/list_dataset", ctx, searchParams);
      const data = (await response.json()) as DataListResponse;

      return data.datasets;
    } catch (e) {
      return [];
    }
  }),
  getDatasetInfo: publicProcedure.input(DatasetInfoRequestSchema).query(async ({ ctx, input }): Promise<DataInfoResponse<DatasetTypesSchema.Dataset | DatasetTypesSchema.Collection>>   => {
    const searchParams = new URLSearchParams({
      count: input.count.toString(),
      order: input.order,
      all_flag: input.all_flag.toString(),
    });

    if (input.tag) {
      searchParams.append("tag", input.tag);
    }

    const response = await OsmoApiFetch(`/api/bucket/${input.bucket}/dataset/${input.name}/info`, ctx, searchParams);
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

    return data as DataInfoResponse<DatasetTypesSchema.Dataset | DatasetTypesSchema.Collection>;
  }),
  deleteDataset: publicProcedure.input(DeleteDatasetRequestSchema).mutation(async ({ ctx, input }) => {
    // Note: In the meantime, dataset deletion is not supported from the UI client as it requires user credentials to be performed.
    // For now, only collections can be deleted from the UI, since that doesn't involve any data deletion operations.
    const searchParams = new URLSearchParams({
      all_flag: input.all_flag.toString(),
      finish: input.all_flag.toString(),
    });

    if (input.tag) {
      searchParams.append("tag", input.tag);
    }

    const response = await OsmoApiFetch(
      `/api/bucket/${input.bucket}/dataset/${input.name}`,
      ctx,
      searchParams,
      undefined,
      "DELETE",
    );
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

    return data as DeleteDatasetResponse;
  }),
  attributeDataset: publicProcedure.input(AttributeDatasetRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const searchParams = new URLSearchParams();
      const requestBody = {
        set_label: input.set_label,
        set_metadata: input.set_metadata,
      };

      if (input.tag) {
        searchParams.append("tag", input.tag);
      }

      if (input.new_name) {
        searchParams.append("new_name", input.new_name);
      }

      input.set_tag?.forEach((tag) => {
        searchParams.append("set_tag", tag);
      });

      input.delete_tag?.forEach((tag) => {
        searchParams.append("delete_tag", tag);
      });

      input.delete_label?.forEach((label) => {
        searchParams.append("delete_label", label);
      });

      input.delete_metadata?.forEach((metadata) => {
        searchParams.append("delete_metadata", metadata);
      });

      const response = await OsmoApiFetch(
        `/api/bucket/${input.bucket}/dataset/${input.name}/attribute`,
        ctx,
        searchParams,
        requestBody,
        "POST",
        true,
      );

      const data = (await response.json()) as AttributeDatasetResponse;
      return data;
    } catch (e) {
      return {
        message: `Error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
  createCollection: publicProcedure.input(CreateCollectionRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const requestBody = {
        datasets: input.datasets,
      };

      const response = await OsmoApiFetch(
        `/api/bucket/${input.bucket}/dataset/${input.name}/collect`,
        ctx,
        undefined,
        requestBody,
        "POST",
        true,
      );

      return (await response.json()) as null;
    } catch (e) {
      return {
        message: `Error occured!\n ${e as string}`,
      } as OSMOErrorResponse;
    }
  }),
});
