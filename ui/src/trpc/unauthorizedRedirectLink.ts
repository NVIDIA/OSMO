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
import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable, tap } from "@trpc/server/observable";

import { AuthRedirectError } from "./authRedirectFetch";

/**
 * Redirects to /auth/login when any procedure returns UNAUTHORIZED.
 * This covers both:
 * - Backend returning 401 (e.g. "Jwt is missing")
 * - Backend redirecting to login (we return 401 from OsmoApiFetch on the server;
 *   the client then gets UNAUTHORIZED and should go to login)
 */
export function unauthorizedRedirectLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
  return (_runtime) => {
    return ({ op, next }) => {
      return observable((observer) => {
        return next(op)
          .pipe(
            tap({
              next(envelope) {
                const err = envelope?.result && "error" in envelope.result ? envelope.result.error : null;
                const code =
                  err && typeof err === "object" && "data" in err ? (err.data as { code?: string })?.code : undefined;
                const redirectTo =
                  err && typeof err === "object" && "data" in err
                    ? (err.data as { redirectTo?: string })?.redirectTo
                    : undefined;
                if (code === "UNAUTHORIZED" && typeof window !== "undefined") {
                  window.location.assign(redirectTo ?? "/auth/login");
                }
              },
              error(err) {
                // AuthRedirectError: thrown by authRedirectFetch when the HTTP response was 302/401
                if (err instanceof AuthRedirectError && typeof window !== "undefined") {
                  window.location.assign(err.redirectTo);
                  return;
                }
                const redirectTo =
                  err && typeof err === "object" && "redirectTo" in err
                    ? (err as { redirectTo: string }).redirectTo
                    : (() => {
                        const cause =
                          err && typeof err === "object" && err !== null && "cause" in err
                            ? (err as { cause?: unknown }).cause
                            : undefined;
                        return cause instanceof AuthRedirectError ? cause.redirectTo : undefined;
                      })();
                if (typeof redirectTo === "string" && typeof window !== "undefined") {
                  window.location.assign(redirectTo);
                  return;
                }
                const code = err && typeof err === "object" && "data" in err ? err.data?.code : undefined;
                const dataRedirectTo =
                  err && typeof err === "object" && "data" in err ? err.data?.redirectTo : undefined;
                if (code === "UNAUTHORIZED" && typeof window !== "undefined") {
                  window.location.assign(typeof dataRedirectTo === "string" ? dataRedirectTo : "/auth/login");
                }
              },
            }),
          )
          .subscribe(observer);
      });
    };
  };
}
