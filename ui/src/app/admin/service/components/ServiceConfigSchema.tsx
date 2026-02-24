//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import * as yup from "yup";

const agentQueueSizeSchema = yup
  .string()
  .required("Agent Queue Size is required")
  .test("is-int", "Agent Queue Size must be a whole number", (value) => Boolean(value && /^\d+$/.test(value)));

export const versionStringSchema = yup
  .string()
  .trim()
  .matches(/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/, "Invalid version");

export const durationStringSchema = yup
  .string()
  .trim()
  .matches(/^\d+(?:ms|us|[dhms])$/, "Duration must be like 1d, 2h, 30m, 15s, 500ms, or 250us")
  .test("unit-required", "Duration must include a unit", (value) => {
    if (!value) {
      return false;
    }
    return /[a-z]/i.test(value);
  });

export const serviceConfigSchema = yup.object({
  changeDescription: yup
    .string()
    .trim()
    .when("$isComparing", {
      is: true,
      then: (schema) => schema.required("Change Description is required"),
      otherwise: (schema) => schema.notRequired(),
    })
    .defined(),
  tags: yup.array().of(yup.string().trim().defined()).default([]).defined(),
  service_base_url: yup
    .string()
    .trim()
    .url("Service Base URL must be a valid URL")
    .required("Service Base URL is required")
    .defined(),
  max_pod_restart_limit: durationStringSchema.required("Max Pod Restart Limit is required").defined(),
  agent_queue_size: agentQueueSizeSchema.defined(),
  max_token_duration: durationStringSchema.required("Max Token Duration is required").defined(),
  latest_version: versionStringSchema.required("CLI Latest Version is required").defined(),
  min_supported_version: versionStringSchema
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .defined(),
  issuer: yup.string().trim().required("Issuer is required").defined(),
  audience: yup.string().trim().required("Audience is required").defined(),
  user_roles: yup
    .string()
    .trim()
    .required("User Roles is required")
    .test("roles-not-empty", "User Roles must include at least one role", (value) => {
      if (!value) {
        return false;
      }
      return (
        value
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean).length > 0
      );
    })
    .defined(),
  ctrl_roles: yup
    .string()
    .trim()
    .required("Control Roles is required")
    .test("roles-not-empty", "Control Roles must include at least one role", (value) => {
      if (!value) {
        return false;
      }
      return (
        value
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean).length > 0
      );
    })
    .defined(),
  device_client_id: yup.string().trim().required("Device Client ID is required").defined(),
  browser_client_id: yup.string().trim().required("Browser Client ID is required").defined(),
  device_endpoint: yup
    .string()
    .trim()
    .url("Device Endpoint must be a valid URL")
    .required("Device Endpoint is required")
    .defined(),
  browser_endpoint: yup
    .string()
    .trim()
    .url("Browser Endpoint must be a valid URL")
    .required("Browser Endpoint is required")
    .defined(),
  token_endpoint: yup
    .string()
    .trim()
    .url("Token Endpoint must be a valid URL")
    .required("Token Endpoint is required")
    .defined(),
  logout_endpoint: yup
    .string()
    .trim()
    .url("Logout Endpoint must be a valid URL")
    .required("Logout Endpoint is required")
    .defined(),
});
