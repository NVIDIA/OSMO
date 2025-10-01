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
import { type CookieSerializeOptions } from "cookie";

import { getLoginInfo } from "~/app/auth/login_info";
import { env } from "~/env.mjs";

export const getRequestScheme = () => {
  return env.NEXT_PUBLIC_OSMO_SSL_ENABLED ? "https" : "http";
};

// Generates request headers, including CORS for authentication
export const getRequestHeaders = async (id_token: string | null, includeContentType?: boolean) => {
  const loginInfo = await getLoginInfo();

  const headers: Record<string, string> = {
    "x-osmo-auth": !loginInfo.auth_enabled ? "x-osmo-user" : (id_token ?? ""),
  };
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
};

interface ContextProps {
  headers: Headers;
  cookies: {
    get: (name?: string) => string | Record<string, string> | null;
    has: (name: string) => boolean;
    set: (name: string, value: string, options?: CookieSerializeOptions) => void;
    clear: (name: string) => void;
  };
}
/**
 * Generic OSMO Service API requests to OSMO.
 * - Path: Add parameter to the URL
 * - Query: Add in searchParams with URLSearchParams()
 * - Body: Pass in a request body and set includeContentType to true
 *
 * @see https://stg2.osmo.nvidia.com/api/docs
 *
 */
export const OsmoApiFetch = async (
  apiPath: string,
  ctx: ContextProps,
  searchParams?: URLSearchParams,
  requestBody?: Record<string, unknown>,
  method = "GET",
  includeContentType = false,
) => {
  const scheme = getRequestScheme();
  const idToken = ctx.cookies.get("IdToken") as string | null ?? ctx.headers.get("x-osmo-auth");
  const fetchUrl = searchParams
    ? `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}${apiPath}?${searchParams.toString()}`
    : `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}${apiPath}`;

  const fetchOptions: RequestInit = {
    method: method,
    headers: await getRequestHeaders(idToken, includeContentType),
  };

  if (requestBody) {
    fetchOptions.body = JSON.stringify(requestBody);
  }

  // To inspect a fetch URL, this is where you would add a console.log
  const response = await fetch(fetchUrl, fetchOptions);
  return response;
};

export const stripUrlParam = (url: string, param: string): string => {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.delete(param);
    return parsedUrl.toString();
  } catch (e) {
    return url;
  }
};

export const checkExhaustive = (x: never) => {
  console.error("checkExhaustive", x);
};
