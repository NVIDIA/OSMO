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

export const ProfileRequestSchema = z.undefined();

export const ProfileResponseSchema = z.object({
  profile: z.object({
    username: z.string(),
    email_notification: z.boolean().default(false),
    slack_notification: z.boolean().default(false),
    bucket: z.string().nullable(),
    pool: z.string().nullable(),
  }),
  pools: z.array(z.string()),
});

export const ProfileChangeSettingsRequestSchema = z.object({
  user_name: z.string().optional(),
  email_notification: z.boolean().default(false).optional(),
  slack_notification: z.boolean().default(false).optional(),
  bucket: z.string().optional(),
  pool: z.string().optional(),
  set_default_backend: z.boolean().optional().default(false),
});

export const ProfileChangeSettingsResponseSchema = z.null();

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
export type ProfileRequest = z.infer<typeof ProfileRequestSchema>;
export type ProfileChangeSettingsRequest = z.infer<typeof ProfileChangeSettingsRequestSchema>;
export type ProfileChangeSettingsResponse = z.infer<typeof ProfileChangeSettingsResponseSchema>;
