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
import { env } from "~/env.mjs";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getRequestScheme } from "~/utils/common";

export const versionRouter = createTRPCRouter({
  get: publicProcedure.query(async () => {
    try {
      const scheme = getRequestScheme();
      const response = await fetch(`${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}/api/version`);

      const data = (await response.json()) as {
        major: string;
        minor: string;
        revision: string;
      };

      return `${env.NEXT_PUBLIC_APP_NAME} v${data.major}.${data.minor}.${data.revision}`;
    } catch (e) {
      return "";
    }
  }),
});
