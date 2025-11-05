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
import { getRequestScheme } from "~/utils/common";

export async function GET(request: Request) {
  const id_token = request.headers.get("x-osmo-auth") ?? "";
  const osmoHeaders = { headers: { "x-osmo-auth": id_token } };

  // Check if the token is valid by fetching workflows. This is the same as the kubernetes readiness
  // probe. all_pools=true is important for users that don't have a default pool
  const scheme = getRequestScheme();
  const response = await fetch(
    `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}/api/workflow?limit=1&all_pools=true`,
    osmoHeaders,
  );

  return new Response(JSON.stringify({ isFailure: response.status !== 200 }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
