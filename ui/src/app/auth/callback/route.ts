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
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const loginInfo = await getLoginInfo();

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("client_id", `${loginInfo.browser_client_id}`);
  params.append("client_secret", env.AUTH_CLIENT_SECRET);
  params.append("code", code);
  // This matches the original redirect_uri in the auth request
  params.append("redirect_uri", `${url.origin}/auth/callback`);

  const response = await fetch(
    `${loginInfo.token_endpoint}`,
    {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        method: "POST",
  });

  if (!response.ok) {
    return new Response("Failed to fetch tokens", { status: 500 });
  }

  const data = (await response.json()) as {
    id_token: string;
    refresh_token: string;
  };

  const redirectTo = new URL(`/auth/success`, url.origin);
  redirectTo.searchParams.append("id_token", data.id_token);
  redirectTo.searchParams.append("refresh_token", data.refresh_token);
  redirectTo.searchParams.append("redirect_to", state);
  return Response.redirect(redirectTo.toString());
}
