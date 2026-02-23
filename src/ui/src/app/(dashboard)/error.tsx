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

import { RouteError } from "@/components/error/route-error";

/**
 * Dashboard-level error boundary.
 *
 * This file is automatically used by Next.js as an error boundary
 * for all routes under (dashboard)/. No manual wrapping needed.
 *
 * The Shell/layout remains visible - only the page content is replaced.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Something went wrong"
      description="An unexpected error occurred. Don't worry, your data is safe."
      logPrefix="Dashboard error boundary"
      centered
    />
  );
}
