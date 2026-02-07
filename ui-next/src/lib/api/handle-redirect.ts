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

/**
 * Handles redirect responses (3xx) from fetch calls.
 *
 * API endpoints should not return redirects. When they do, it's typically:
 * - Cross-origin: Auth session expired → redirect to SSO (cannot follow due to CORS)
 * - Same-origin: Misconfiguration or unexpected routing
 *
 * @param response - The fetch Response object
 * @param context - Optional context string for better error messages (e.g., "log streaming")
 * @throws Error if response is a redirect, with appropriate message based on origin
 */
export function handleRedirectResponse(response: Response, context?: string): void {
  // Not a redirect - nothing to do
  if (response.status < 300 || response.status >= 400) {
    return;
  }

  const location = response.headers.get("Location");

  if (!location) {
    throw new Error(`Server returned redirect (${response.status}) with no Location header`);
  }

  try {
    // Determine origin of redirect URL
    const isServer = typeof window === "undefined";
    const currentOrigin = isServer ? "http://localhost" : window.location.origin;
    const redirectUrl = new URL(location, currentOrigin);
    const isCrossOrigin = !isServer && redirectUrl.origin !== window.location.origin;

    if (isCrossOrigin) {
      // Cross-origin redirect to SSO - cannot follow due to CORS
      throw new Error(
        `Your session has expired. Please refresh the page to log in again. ` +
          `(Cannot follow redirect to ${redirectUrl.origin})`,
      );
    } else {
      // Same-origin redirect - unexpected for API endpoints
      const contextMsg = context ? ` (${context})` : "";
      throw new Error(
        `API endpoint unexpectedly redirected to ${location}${contextMsg}. ` + `This may indicate a misconfiguration.`,
      );
    }
  } catch (err) {
    if (err instanceof TypeError) {
      // Invalid URL format
      throw new Error(`Invalid redirect location: ${location}`);
    }
    throw err;
  }
}

/**
 * Checks if a response is a redirect (3xx status code).
 */
export function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}
