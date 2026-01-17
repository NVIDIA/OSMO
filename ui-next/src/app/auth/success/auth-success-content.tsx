// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { storeTokens } from "@/lib/auth/token-storage";

/**
 * Auth success content - handles token storage and redirect.
 *
 * This component receives tokens from the OAuth callback and stores them
 * in localStorage before redirecting back to the app.
 *
 * For local-against-production mode:
 * If redirect_to is a localhost URL, we redirect there WITH the tokens
 * so the local instance can store them.
 */
export function AuthSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const idToken = searchParams.get("id_token");
    const refreshToken = searchParams.get("refresh_token");
    const redirectTo = searchParams.get("redirect_to") || "/";

    // Check if redirect_to is a localhost URL (local-against-production mode)
    const isLocalRedirect = redirectTo.startsWith("http://localhost") || redirectTo.startsWith("http://127.0.0.1");

    if (isLocalRedirect && idToken) {
      // Redirect to localhost WITH tokens in the URL
      const localUrl = new URL(redirectTo);
      // If redirecting to a local auth/success, append tokens
      if (localUrl.pathname === "/auth/success" || localUrl.pathname === "/" || localUrl.pathname === "") {
        localUrl.pathname = "/auth/success";
        localUrl.searchParams.set("id_token", idToken);
        if (refreshToken) {
          localUrl.searchParams.set("refresh_token", refreshToken);
        }
        localUrl.searchParams.set("redirect_to", "/");
        window.location.href = localUrl.toString();
        return;
      }
    }

    // Normal flow: store tokens via centralized storage
    if (idToken) {
      storeTokens(idToken, refreshToken ?? undefined);
    }

    // Redirect to the original page
    router.replace(redirectTo);
  }, [searchParams, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <p className="text-zinc-500">Logging you in...</p>
    </div>
  );
}
