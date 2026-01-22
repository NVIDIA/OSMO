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
 * Production stub for dev auth injection.
 * This file replaces inject-auth.ts in production builds to eliminate dev code.
 *
 * All functions are no-ops in production since auth is handled by Envoy.
 */

// No-op functions that match the dev API
export function generateMockJWT(): string {
  return "";
}

export function injectMockAuth(): void {
  // No-op in production
}

export const injectTestUsers = {
  admin: () => {},
  user: () => {},
  powerUser: () => {},
  viewer: () => {},
};

export function skipAuth(): void {
  // No-op in production
}

export function clearAuth(): void {
  // No-op in production
}

export function getAuthStatus() {
  return {
    hasToken: false,
    authSkipped: false,
    username: null,
    roles: [],
    expiresAt: null,
  };
}

export function printAuthStatus(): void {
  // No-op in production
}
