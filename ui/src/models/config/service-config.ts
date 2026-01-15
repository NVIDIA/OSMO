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

export const AuthKeySchema = z.object({
  public_key: z.string(),
  private_key: z.string(),
});

export const LoginInfoSchema = z.object({
  device_endpoint: z.string().nullable(),
  device_client_id: z.string().nullable(),
  browser_endpoint: z.string().nullable(),
  browser_client_id: z.string().nullable(),
  token_endpoint: z.string().nullable(),
  logout_endpoint: z.string().nullable(),
});

export const ServiceAuthSchema = z.object({
  keys: z.record(z.string(), AuthKeySchema),
  active_key: z.string(),
  issuer: z.string(),
  audience: z.string(),
  user_roles: z.array(z.string()),
  ctrl_roles: z.array(z.string()),
  login_info: LoginInfoSchema,
  max_token_duration: z.string(),
});

export const CliConfigSchema = z.object({
  latest_version: z.string().nullable(),
  min_supported_version: z.string().nullable(),
});

export const ServiceConfigSchema = z.object({
  service_base_url: z.string(),
  service_auth: ServiceAuthSchema,
  cli_config: CliConfigSchema,
  max_pod_restart_limit: z.string(),
  agent_queue_size: z.number(),
});

export const ServiceConfigHistoryItemSchema = z.object({
  config_type: z.string(),
  name: z.string(),
  revision: z.number(),
  username: z.string(),
  created_at: z.coerce.date(),
  description: z.string(),
  tags: z.array(z.string()).nullable(),
  data: ServiceConfigSchema,
});

export const ServiceConfigHistoryResponseSchema = z.object({
  configs: z.array(ServiceConfigHistoryItemSchema),
});

export type AuthKey = z.infer<typeof AuthKeySchema>;
export type LoginInfo = z.infer<typeof LoginInfoSchema>;
export type ServiceAuth = z.infer<typeof ServiceAuthSchema>;
export type CliConfig = z.infer<typeof CliConfigSchema>;
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type ServiceConfigHistoryItem = z.infer<typeof ServiceConfigHistoryItemSchema>;
export type ServiceConfigHistoryResponse = z.infer<typeof ServiceConfigHistoryResponseSchema>;

