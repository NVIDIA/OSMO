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

/**
 * Production MockProvider Stub
 *
 * This is a no-op version of MockProvider that's swapped in during production builds.
 * It eliminates ~400KB+ of dev dependencies (faker, msw) from the production bundle.
 *
 * The swap is configured in next.config.ts via turbopack.resolveAlias.
 */

import type { ReactNode } from "react";

interface MockProviderProps {
  children: ReactNode;
}

// Re-export the storage key for compatibility
export const MOCK_ENABLED_STORAGE_KEY = "osmo_use_mock_data";

/**
 * Production stub - just renders children immediately.
 * No mocking logic, no faker, no msw.
 */
export function MockProvider({ children }: MockProviderProps) {
  return <>{children}</>;
}
