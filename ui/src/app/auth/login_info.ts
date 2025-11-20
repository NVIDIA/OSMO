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

interface LoginInfo {
  auth_enabled: boolean;
  device_endpoint: string;
  device_client_id: string;
  browser_endpoint: string;
  browser_client_id: string;
  token_endpoint: string;
  logout_endpoint: string;
}

export const getLoginInfo = async (): Promise<LoginInfo> => {
  // The followingensures that when running locally against deployed prod, the endpoints
  // are still provided despite prod not supporting GET /api/auth/login
  // TODO: remove this once prod supports GET /api/auth/login and use:
  // const res = await fetch(`https://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}/api/auth/login`, { cache: "no-store" });
  // const loginInfo = (await res.json()) as LoginInfo;
  // loginInfo.auth_enabled = loginInfo.device_endpoint !== "";
  // return loginInfo;

  const scheme = getRequestScheme();
  let loginInfo: LoginInfo = {
    auth_enabled: true,
    device_endpoint: "",
    device_client_id: "",
    browser_endpoint: `${scheme}://${env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME}/realms/osmo/protocol/openid-connect/auth`,
    browser_client_id: "osmo-browser-flow",
    token_endpoint: `${scheme}://${env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME}/realms/osmo/protocol/openid-connect/token`,
    logout_endpoint: `${scheme}://${env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME}/realms/osmo/protocol/openid-connect/logout`,
  };

  // Avoid network calls during static generation (build/export)
  const isStaticGeneration =
    typeof window === "undefined" &&
    (process.env.NEXT_PHASE === "phase-production-build" || process.env.NEXT_PHASE === "phase-export");

  console.debug('isStaticGeneration', isStaticGeneration);

  if (isStaticGeneration) {
    return loginInfo;
  }

  try {
    const url = `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}/api/auth/login`;
    const res = await fetch(url, { cache: "no-store" });
    loginInfo = (await res.json()) as LoginInfo;

    console.debug('loginInfo', url, loginInfo);

    loginInfo.auth_enabled = Boolean(loginInfo.device_endpoint);
  } catch (error) {
    console.warn(`Host does not support /api/auth/login: ${(error as Error).message}`);
  }

  return loginInfo;
};
