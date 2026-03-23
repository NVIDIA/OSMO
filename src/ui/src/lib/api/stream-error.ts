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
 * Parse an error response body from a streaming endpoint.
 *
 * Streaming endpoints (logs, events) return JSON error bodies on failure
 * (e.g. `{"message": "Internal server error: 403"}`). This helper extracts
 * the message so it can be shown to the user instead of a generic status code.
 */
export async function parseStreamErrorResponse(response: Response): Promise<string> {
  const fallback = `Stream failed: ${response.status} ${response.statusText}`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    const json = JSON.parse(text) as { message?: string; detail?: string };
    return json.message || json.detail || fallback;
  } catch {
    return fallback;
  }
}
