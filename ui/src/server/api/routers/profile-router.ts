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

import {
  type OSMOErrorResponse,
  ProfileChangeSettingsRequestSchema,
  type ProfileChangeSettingsResponse,
  ProfileRequestSchema,
  type ProfileResponse,
} from "~/models";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { OsmoApiFetch } from "~/utils/common";

export const profileRouter = createTRPCRouter({
  getSettings: publicProcedure.input(ProfileRequestSchema).query(async ({ ctx }): Promise<ProfileResponse | OSMOErrorResponse> => {
    const response = await OsmoApiFetch("/api/profile/settings", ctx);
    if (!response.ok) {
      const data = (await response.json()) as OSMOErrorResponse;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: data.message ?? "Unknown error",
      });
    }

    return (await response.json()) as ProfileResponse;
  }),
  changeSettings: publicProcedure.input(ProfileChangeSettingsRequestSchema).mutation(async ({ ctx, input }) => {
    try {
      const requestBody: Record<string, boolean | string> = {};

      Array.from(["user_name", "bucket", "pool"] as const).forEach((field) => {
        if (input[field] !== null && input[field] !== undefined) {
          requestBody[field] = input[field]!;
        }
      });
      requestBody.email_notification = input.email_notification!;
      requestBody.slack_notification = input.slack_notification!;

      const searchParams = new URLSearchParams();
      if (input.set_default_backend !== null && input.set_default_backend !== undefined) {
        searchParams.append("set_default_backend", input.set_default_backend.toString());
      }

      const response = await OsmoApiFetch("/api/profile/settings", ctx, searchParams, requestBody, "POST", true);

      if (response.ok) {
        return (await response.json()) as ProfileChangeSettingsResponse;
      } else {
        return (await response.json()) as OSMOErrorResponse;
      }
    } catch (e) {
      return { message: "Unknown error occured!" } as OSMOErrorResponse;
    }
  }),
});
