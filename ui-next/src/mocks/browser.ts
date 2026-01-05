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

/**
 * MSW Browser Setup
 *
 * Sets up Mock Service Worker for browser environments.
 * This intercepts fetch requests and returns mock data.
 */

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { MOCK_ENABLED_STORAGE_KEY } from "./MockProvider";

export const worker = setupWorker(...handlers);

/**
 * Initialize mocking in the browser.
 * Call this early in your app's lifecycle.
 */
export async function initMocking(): Promise<void> {
  const useMock =
    process.env.NEXT_PUBLIC_MOCK_API === "true" ||
    (typeof window !== "undefined" && localStorage.getItem(MOCK_ENABLED_STORAGE_KEY) === "true");

  if (!useMock) {
    return;
  }

  await worker.start({
    onUnhandledRequest: "bypass", // Don't warn on unhandled requests
    quiet: false, // Set to true to hide MSW logs
  });

  console.log(
    "%c🔶 Mock API enabled",
    "background: #f59e0b; color: black; padding: 2px 6px; border-radius: 4px; font-weight: bold;",
  );
  console.log("   Requests are being intercepted and served from testdata/");
}
