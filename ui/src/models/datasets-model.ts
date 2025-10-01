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

import { OrderValues } from "./workflows-model";

export const BucketInfoEntrySchema = z.object({
  path: z.string(),
  description: z.string(),
  mode: z.string(),
  default_cred: z.boolean(),
});

export const BucketInfoResponseSchema = z.object({
  default: z.string().optional(),
  buckets: z.record(z.string(), BucketInfoEntrySchema),
});

export const BucketInfoRequestSchema = z.object({
  default_only: z.boolean().optional().default(false),
});

export enum DatasetTypesSchema {
  Collection = "COLLECTION",
  Dataset = "DATASET",
}

export const DataListEntrySchema = z.object({
  name: z.string(),
  id: z.string(),
  bucket: z.string(),
  create_time: z.string().datetime(),
  last_created: z.string().datetime().nullish(),
  hash_location: z.string().nullable(),
  hash_location_size: z.number().nullable(),
  version_id: z.string().nullable(),
  type: z.enum(["COLLECTION", "DATASET"]),
});

export const DataListResponseSchema = z.object({
  datasets: z.array(DataListEntrySchema),
});

export const DataListRequestSchema = z.object({
  id_token: z.string().optional().default(""),
  count: z.number().optional().default(1000),
  name: z.string().optional(),
  buckets: z.array(z.string()).optional().default([]),
  users: z.array(z.string()).optional().default([]),
  all_users: z.boolean().optional().default(false),
  order: z.enum(OrderValues).optional().default("DESC"),
  latest_before: z.string().datetime().optional(),
  latest_after: z.string().datetime().optional(),
  dataset_type: z.enum(["COLLECTION", "DATASET"]).optional(),
});

const DatasetStatusSchema = z.enum(["PENDING", "READY", "PENDING_DELETE", "DELETED"]);

const DataInfoDatasetEntrySchema = z
  .object({
    name: z.string(),
    version: z.string(),
    status: DatasetStatusSchema,
    created_by: z.string(),
    created_date: z.string().datetime(),
    last_used: z.string().datetime(),
    retention_policy: z.number(),
    size: z.number().int(),
    checksum: z.string(),
    location: z.string(),
    uri: z.string(),
    metadata: z.record(z.unknown()),
    tags: z.array(z.string()),
    collections: z.array(z.string()),
  })
  .strict();

const DataInfoCollectionEntrySchema = z
  .object({
    name: z.string(),
    version: z.string(),
    location: z.string(),
    uri: z.string(),
    hash_location: z.string().optional(),
    size: z.number().int(),
  })
  .strict();

export const DatasetInfoRequestSchema = z.object({
  bucket: z.string(),
  name: z.string(),
  tag: z.string().optional(),
  count: z.number().optional().default(100),
  all_flag: z.boolean().optional().default(false),
  order: z.enum(OrderValues).optional().default("ASC"),
});

export const DataInfoResponseVersionSchema = z.union([DataInfoDatasetEntrySchema, DataInfoCollectionEntrySchema]);

/**
 * Datasets and Collections are merged into the same schema to be fit in the same table depending on the type
 * */
const DataInfoResponseSchema = <T extends z.ZodTypeAny>(entrySchema: T) =>
  z
    .object({
      name: z.string(),
      id: z.string(),
      bucket: z.string(),
      created_by: z.string().nullable(),
      created_date: z.string().datetime(),
      hash_location: z.string().nullable(),
      hash_location_size: z.number().int().nullable(),
      labels: z.record(z.string(), z.unknown()),
      type: z.enum(["COLLECTION", "DATASET"]),
      versions: z.array(entrySchema),
    })
    .strict();

export const DataInfoResponseDatasetSchema = DataInfoResponseSchema(DataInfoDatasetEntrySchema);
export const DataInfoResponseCollectionSchema = DataInfoResponseSchema(DataInfoCollectionEntrySchema);

const FileDataItemSchema = z.object({
  etag: z.string(),
  relative_path: z.string(),
  size: z.number(),
  storage_path: z.string(),
  url: z.string(),
});

export const CreateCollectionRequestSchema = z.object({
  bucket: z.string(),
  name: z.string(),
  datasets: z.array(z.object({ name: z.string(), tag: z.string() })),
});

export const DeleteDatasetRequestSchema = z.object({
  bucket: z.string(),
  name: z.string(),
  tag: z.string().optional(),
  all_flag: z.boolean().optional().default(false),
  finish: z.boolean().optional().default(false),
});

export const DeleteDatasetResponseSchema = z.object({
  versions: z.array(z.string()).default([]),
  delete_locations: z.array(z.string()).default([]),
  cleaned_size: z.number().default(0),
});

export const AttributeDatasetRequestSchema = z.object({
  bucket: z.string(),
  name: z.string(),
  tag: z.string().optional(),
  new_name: z.string().optional(),
  set_tag: z.array(z.string()).optional().default([]),
  delete_tag: z.array(z.string()).optional().default([]),
  delete_label: z.array(z.string()).optional().default([]),
  delete_metadata: z.array(z.string()).optional().default([]),
  set_label: z.record(z.any()).optional(),
  set_metadata: z.record(z.any()).optional(),
});

export const AttributeDatasetResponseSchema = z.object({
  tag_response: z.object({ version_id: z.string(), tags: z.array(z.string()) }).nullable(),
  label_response: z.object({ metadata: z.record(z.any()) }).nullable(),
  metadata_response: z.object({ metadata: z.record(z.any()) }).nullable(),
});

export type DatasetsSlugParams = {
  params: {
    name: string;
    bucket: string;
  };
};

export type BucketInfoEntry = z.infer<typeof BucketInfoEntrySchema>;
export type BucketInfoResponse = z.infer<typeof BucketInfoResponseSchema>;
export type BucketInfoRequest = z.infer<typeof BucketInfoRequestSchema>;
export type DataListEntry = z.infer<typeof DataListEntrySchema>;
export type DataListResponse = z.infer<typeof DataListResponseSchema>;
export type DataInfoDatasetEntry = z.infer<typeof DataInfoDatasetEntrySchema>;
export type DataInfoCollectionEntry = z.infer<typeof DataInfoCollectionEntrySchema>;
export type DatasetInfoRequest = z.infer<typeof DatasetInfoRequestSchema>;
export type DataInfoResponseVersion = z.infer<typeof DataInfoResponseVersionSchema>;
export type DataInfoResponseDataset = z.infer<typeof DataInfoResponseDatasetSchema>;
export type DataInfoResponseCollection = z.infer<typeof DataInfoResponseCollectionSchema>;
export type DataInfoResponse<T extends "DATASET" | "COLLECTION"> = T extends "DATASET"
  ? DataInfoResponseDataset
  : DataInfoResponseCollection;
export type FileDataItem = z.infer<typeof FileDataItemSchema>;
export type CreateCollectionRequest = z.infer<typeof CreateCollectionRequestSchema>;
export type DeleteDatasetRequest = z.infer<typeof DeleteDatasetRequestSchema>;
export type DeleteDatasetResponse = z.infer<typeof DeleteDatasetResponseSchema>;
export type AttributeDatasetRequest = z.infer<typeof AttributeDatasetRequestSchema>;
export type DataListRequest = z.infer<typeof DataListRequestSchema>;
export type AttributeDatasetResponse = z.infer<typeof AttributeDatasetResponseSchema>;
