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

import { getLoginInfo } from "../login_info";

export async function GET(request: Request) {
  const loginInfo = await getLoginInfo();

  const refresh_token = request.headers.get("x-refresh-token") ?? "";

  const params = new URLSearchParams({
    client_id: "osmo-browser-flow",
    grant_type: "refresh_token",
    refresh_token: refresh_token,
    client_secret: env.AUTH_CLIENT_SECRET,
  });

  const payload = await fetch(`${loginInfo.token_endpoint}`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    method: "POST",
  });

  const data = await payload.json();

  return new Response(JSON.stringify({
    isFailure: payload.status !== 200,
    id_token: data.id_token,
    refresh_token: data.refresh_token,
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
