// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * MSW Browser Setup
 *
 * Sets up Mock Service Worker for browser environments.
 * This intercepts fetch requests and returns mock data.
 */

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

/**
 * Initialize mocking in the browser.
 * Call this early in your app's lifecycle.
 */
export async function initMocking(): Promise<void> {
  const useMock =
    process.env.NEXT_PUBLIC_MOCK_API === "true" ||
    (typeof window !== "undefined" && localStorage.getItem("osmo_use_mock_data") === "true");

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
