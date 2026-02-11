//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

/**
 * DevAuthInit - Initializes auth transfer helper in development mode
 *
 * This component runs only in `pnpm dev` mode (not `pnpm dev:mock`)
 * and prints instructions for copying auth from production.
 *
 * Production safety: Tree-shaken in production builds due to NODE_ENV check.
 */

import { useEffect } from "react";

// Module-level flag to ensure initialization only happens once
// This persists across React StrictMode remounts
let hasInitialized = false;

export function DevAuthInit() {
  useEffect(() => {
    // Only run once globally, not per component mount
    if (hasInitialized) return;
    hasInitialized = true;

    // Only in development mode
    if (process.env.NODE_ENV !== "development") return;

    // Skip in mock mode - mock auth is handled by MockProvider
    const isMockMode =
      process.env.NEXT_PUBLIC_MOCK_API === "true" ||
      (typeof localStorage !== "undefined" && localStorage.getItem("osmo_use_mock_data") === "true");

    // Load inject-auth helpers for console usage (window.devAuth)
    // This runs in ALL dev modes (mock and non-mock) for convenience
    import("@/mocks/inject-auth")
      .then(() => {
        // Module initialization attaches window.devAuth automatically
        // No need to call anything - just importing executes the setup code
      })
      .catch((err) => {
        console.error("[DevAuthInit] Failed to load inject-auth:", err);
      });

    if (isMockMode) return;

    // Initialize auth transfer helper for non-mock dev mode
    import("@/lib/dev/auth-transfer-helper")
      .then(({ initAuthTransferHelper }) => {
        initAuthTransferHelper();
      })
      .catch((err) => {
        console.error("[DevAuthInit] Failed to load auth helper:", err);
      });
  }, []);

  return null;
}
