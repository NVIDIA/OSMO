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

export const ResourceTypeValues = ["RESERVED", "SHARED", "UNUSED"] as const;

export const ResourceInfoRequestSchema = z.object({
  name: z.string(),
});

export const ResourcesRequestSchema = z.object({
  pools: z.array(z.string()).nullable().optional(),
  platforms: z.array(z.string()).nullable().optional(),
  all_pools: z.boolean().optional().default(false),
});

const DefaultResourceFieldsSchema = z.object({
  node: z.string().optional(),
  "storage": z.string().nullish(),
  "cpu": z.string().nullish(),
  "pool/platform": z.array(z.string()).optional(),
  "memory": z.string().nullish(),
  "gpu": z.string().nullish(),
});

const PlatformAllocatableResourceFieldsSchema = z.object({
  "storage": z.number().nullish(),
  "cpu": z.number().nullish(),
  "memory": z.string().nullish(),
  "gpu": z.number().nullish(),
});

const ResourcesConfigFieldsSchema = z.record(
  z.string(),
  z.object({
    host_network: z.boolean().nullable(),
    privileged: z.boolean().nullable(),
    default_mounts: z.array(z.string()).nullable(),
    allowed_mounts: z.array(z.string()).nullable(),
  }),
);

export const ResourcesEntrySchema = z.object({
  hostname: z.string(),
  exposed_fields: DefaultResourceFieldsSchema,
  taints: z.array(z.record(z.unknown())),
  usage_fields: DefaultResourceFieldsSchema,
  non_workflow_usage_fields: DefaultResourceFieldsSchema,
  allocatable_fields: DefaultResourceFieldsSchema,
  config_fields: z.record(ResourcesConfigFieldsSchema).nullable(),
  backend: z.string(),
  label_fields: z.record(z.unknown()).nullable(),
  pool_platform_labels: z.record(z.array(z.string())),
  platform_allocatable_fields: z.record(z.record(PlatformAllocatableResourceFieldsSchema)).optional(),
  platform_available_fields: z.record(z.record(PlatformAllocatableResourceFieldsSchema)).optional(),
  platform_workflow_allocatable_fields: z.record(z.record(PlatformAllocatableResourceFieldsSchema)).optional(),
  resource_type: z.enum(ResourceTypeValues),
});

export const ResourcesResponseSchema = z.object({
  resources: z.array(ResourcesEntrySchema),
});

export const ResourceInfoResponseSchema = ResourcesResponseSchema;

export const PlatformSchema = z.object({
  description: z.string().default(""),
  priority: z.string().nullish(),
  host_network_allowed: z.boolean().default(false),
  privileged_allowed: z.boolean().default(false),
  default_mounts: z.array(z.string()).default([]),
  allowed_mounts: z.array(z.string()).default([]),
});

export const ExitActionSchema = z.object({
  "execute": z.string(),
  "portforward": z.string(),
  "cancel": z.string(),
  "rsync": z.string(),
});

export const PoolResourcesSchema = z.object({
  "guarantee": z.number().nullish(),
  "maximum": z.number().nullish(),
  "weight": z.number().nullish(),
});

export const PoolResourceUsageSchema = z.object({
  "quota_used": z.coerce.number().nullish(),
  "quota_free": z.coerce.number().nullish(),
  "quota_limit": z.coerce.number().nullish(),
  "total_usage": z.coerce.number().nullish(),
  "total_capacity": z.coerce.number().nullish(),
  "total_free": z.coerce.number().nullish(),
});

export const PoolSchema = z.object({
  name: z.string(),
  platforms: z.record(PlatformSchema),
  description: z.string().default(""),
  status: z.string().nullable(),
  backend: z.string(),
  default_platform: z.string().nullish(),
  default_exec_timeout: z.string().default(""),
  default_queue_timeout: z.string().default(""),
  max_exec_timeout: z.string().default(""),
  max_queue_timeout: z.string().default(""),
  action_permissions: ExitActionSchema,
  default_exit_actions: z.record(z.string(),z.string()),
  resources: z.record(z.string(),PoolResourcesSchema.nullable().optional()),
  resource_usage: PoolResourceUsageSchema.nullable().optional(),
});

export const PoolsListResponseSchema = z.object({
  pools: z.record(PoolSchema),
});

export const PoolNodeSetSchema = z.object({
  pools: z.array(PoolSchema),
});

export const PoolsQuotaResponseSchema = z.object({
  node_sets: z.array(PoolNodeSetSchema),
  resource_sum: PoolResourceUsageSchema.optional(),
});

export const PoolsQuotaRequestSchema = z.object({
  pools: z.array(z.string()).nullable().optional(),
  all_pools: z.boolean().optional().default(false),
});

export const AllocatableResourceSchema = z.object({
  name: z.string(),
  kubeLabel: z.string(),
  nodeResourceLabel: z.string(),
});

export type Pool = z.infer<typeof PoolSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
export type PoolsListResponse = z.infer<typeof PoolsListResponseSchema>;
export type PoolsQuotaResponse = z.infer<typeof PoolsQuotaResponseSchema>;
export type ResourcesRequest = z.infer<typeof ResourcesRequestSchema>;
export type ResourcesEntry = z.infer<typeof ResourcesEntrySchema>;
export type ResourcesResponse = z.infer<typeof ResourcesResponseSchema>;
export type DefaultResourceFields = z.infer<typeof DefaultResourceFieldsSchema>;
export type PlatformAllocatableResourceFields = z.infer<typeof PlatformAllocatableResourceFieldsSchema>;
export type ResourceInfoResponse = z.infer<typeof ResourceInfoResponseSchema>;
export type AllocatableResource = z.infer<typeof AllocatableResourceSchema>;
export type PoolResourceUsage = z.infer<typeof PoolResourceUsageSchema>;

export interface ResourceAllocation {
  allocatable: number;
  usage: number;
}

/**
 * @see resources.py for implementation
 */
export const roundResources = (value: ResourceAllocation): ResourceAllocation => {
  if (value.usage < 0 || value.allocatable < 0) {
    // Totally invalid, so return 0s
    return { usage: 0, allocatable: 0 };
  }

  const roundedUsage = Math.ceil(value.usage);
  const roundedAllocatable = Math.floor(value.allocatable);

  return {
    usage: Math.min(roundedUsage, roundedAllocatable),
    allocatable: roundedAllocatable,
  };
};

export const ALLOCATABLE_RESOURCES_LABELS: AllocatableResource[] = [
  {
    name: "Storage",
    kubeLabel: "ephemeral-storage",
    nodeResourceLabel: "Storage [Gi]",
  },
  { name: "CPU", kubeLabel: "cpu", nodeResourceLabel: "CPU [#]" },
  { name: "Memory", kubeLabel: "memory", nodeResourceLabel: "Memory [Gi]" },
  { name: "GPU", kubeLabel: "nvidia.com/gpu", nodeResourceLabel: "GPU [#]" },
];

/**
 * @see resources.py for implementation
 */
export const convertResourceValueStr = (resourceVal: string | number, target = "GiB"): number => {
  // Matching resource value format (e.g., "10Gi", "5M")
  const RESOURCE_REGEX = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/;

  // Mapping of units to their corresponding power of 2
  const MEASUREMENTS: Record<string, number> = {
    T: 10,
    Ti: 10,
    TiB: 10,
    G: 0,
    Gi: 0,
    GiB: 0,
    M: -10,
    Mi: -10,
    MiB: -10,
    K: -20,
    Ki: -20,
    KiB: -20,
    B: -30,
    m: -40,
  };

  resourceVal = resourceVal.toString();
  const match = RESOURCE_REGEX.exec(resourceVal);

  if (!match || !(target in MEASUREMENTS)) {
    return 0;
  }

  const num = parseFloat(match[1]!);
  let unit = match[2] ?? "B";

  if (unit == "") {
    unit = "B";
  }

  if (!(unit in MEASUREMENTS)) {
    return 0;
  }

  const raisePower = MEASUREMENTS[unit]! - MEASUREMENTS[target]!;
  return num * Math.pow(2, raisePower);
};

/**
 * @see resources.py for implementation
 */
export const convertFields = (
  key: keyof Omit<DefaultResourceFields, "pool/platform">,
  resource: ResourcesEntry,
  poolName: string,
  platformName: string,
): ResourceAllocation => {
  let allocatableFields = resource.allocatable_fields;

  // Override allocatableFields if platform-specific values are available
  if (resource?.platform_allocatable_fields?.[poolName]?.[platformName]) {
    allocatableFields = Object.fromEntries(
      Object.entries(resource?.platform_allocatable_fields?.[poolName]?.[platformName] ?? {}).map(([k, v]) => [
        k,
        v != null ? String(v) : v,
      ]),
    ) as typeof allocatableFields;
  }

  let allocatable: number;
  let usage: number;

  const allocatableValue = allocatableFields[key];
  const usageValue = resource.usage_fields[key];

  // GPU and CPU don't come tied to a unit
  if (key === "cpu" || key === "gpu") {
    allocatable = parseFloat(allocatableValue ?? "0");
    usage = parseFloat(usageValue ?? "0");
  } else {
    allocatable = convertResourceValueStr(allocatableValue ?? "0");
    usage = convertResourceValueStr(usageValue ?? "0");
  }
  return { allocatable, usage };
};
