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

import { Chrome } from "@/components/chrome/chrome";

/**
 * Dashboard layout — thin wrapper that renders the application shell.
 *
 * Version data (the only previous prefetch) is now fetched client-side once
 * per session with Infinity staleTime/gcTime, eliminating the per-navigation
 * server→backend API call that the fire-and-forget prefetch was causing.
 *
 * Error handling is automatic via Next.js error.tsx files:
 * - (dashboard)/error.tsx - Catches all dashboard errors
 * - (dashboard)/pools/error.tsx - Catches pool-specific errors
 * - (dashboard)/resources/error.tsx - Catches resource-specific errors
 */
export default function DashboardLayout(props: { children: React.ReactNode }) {
  return <Chrome>{props.children}</Chrome>;
}
