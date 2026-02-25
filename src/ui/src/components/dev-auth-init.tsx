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

let hasInitialized = false;

/**
 * Initializes dev auth helpers (window.devAuth) in development mode.
 * In non-mock mode, also prints setup instructions for copying
 * the _osmo_session cookie from production.
 */
export function DevAuthInit() {
  useEffect(() => {
    if (hasInitialized) return;
    hasInitialized = true;

    if (process.env.NODE_ENV !== "development") return;

    const isMockMode =
      process.env.NEXT_PUBLIC_MOCK_API === "true" ||
      (typeof localStorage !== "undefined" && localStorage.getItem("osmo_use_mock_data") === "true");

    import("@/lib/dev/dev-auth")
      .then(({ initDevAuth }) => {
        initDevAuth(!isMockMode);
      })
      .catch((err) => {
        console.error("[DevAuthInit] Failed to load dev auth helpers:", err);
      });
  }, []);

  return null;
}
