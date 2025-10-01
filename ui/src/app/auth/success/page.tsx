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
"use client";

import { useSearchParams } from "next/navigation";

import { PageError } from "~/components/PageError";

/**
 * This page should only be hit in local-against-production mode.
 * It is used to set the auth tokens in localStorage for the user.
 */
export default function LoginSuccessCallback() {
  const searchParams = useSearchParams();
  const idToken = searchParams.get("id_token");
  const refreshToken = searchParams.get("refresh_token");
  const redirectTo = searchParams.get("redirect_to");

  if (!idToken || !refreshToken || !redirectTo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <PageError
          title="Auth callback failed"
          errorMessage="Missing id_token, refresh_token, or redirect_to search params"
        />
      </div>
    );
  }

  // Only run this on the client side
  if (typeof window !== "undefined") {
    localStorage.setItem("IdToken", idToken);
    localStorage.setItem("RefreshToken", refreshToken);
    window.location.href = redirectTo;
  }

  return null;
}
