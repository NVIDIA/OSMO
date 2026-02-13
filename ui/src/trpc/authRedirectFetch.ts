//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
/**
 * Error thrown when the server returned 302/401 and we need to redirect the user to login.
 * Used so the tRPC link can perform the redirect when the HTTP layer intercepts before
 * the response is parsed as JSON (e.g. when a proxy returns 302 for the tRPC request).
 */
export class AuthRedirectError extends Error {
  readonly redirectTo: string;

  constructor(redirectTo: string) {
    super("Auth redirect");
    this.name = "AuthRedirectError";
    this.redirectTo = redirectTo;
  }
}

const AUTH_FALLBACK_URL = "/auth/login";

/**
 * Wraps fetch with redirect: "manual" so we see 302/307/308 instead of following.
 * When the response is a redirect or 401, redirects the window to Location (or /auth/login)
 * and throws AuthRedirectError so the tRPC link can also redirect if the error is wrapped.
 */
export function authRedirectFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url, {
    ...init,
    redirect: "manual",
  }).then((response) => {
    const isRedirect =
      response.type === "opaqueredirect" ||
      response.status === 301 ||
      response.status === 302 ||
      response.status === 307 ||
      response.status === 308;
    const isUnauthorized = response.status === 401;

    if (isRedirect || isUnauthorized) {
      const redirectTo =
        (typeof response.headers.get === "function" ? response.headers.get("location") : null) ?? AUTH_FALLBACK_URL;
      if (typeof window !== "undefined") {
        window.location.assign(redirectTo);
      }
      throw new AuthRedirectError(redirectTo);
    }

    return response;
  });
}
