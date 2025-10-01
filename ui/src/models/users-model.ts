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

export const UserFilterChoicesSchema = z.array(z.string());

export const UserListResponseSchema = z.array(z.string());

/**
 * @see GET api/users
 * @example
 *
 * [
    "svc-worker@stg2.osmo.nvidia.com",
    "albertos@nvidia.com",
    "ethany@nvidia.com",
    "svc-osmo-admin@nvidia.com",
    "aruns@nvidia.com",
    "tdewan@nvidia.com",
    "ecolter@nvidia.com",
    "xutongr@nvidia.com",
    "ryali@nvidia.com",
    "vivianp@nvidia.com"
   ]
 */
export const UserListRequestSchema = z.undefined();

export type UserListRequestSchema = z.infer<typeof UserListRequestSchema>;
export type UserFilterChoices = z.infer<typeof UserFilterChoicesSchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
