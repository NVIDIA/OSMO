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
 * Route-level error boundary for dataset detail page.
 *
 * Backstop for errors that escape component-level boundaries.
 * Component boundaries catch most errors (header, tabs, versions table).
 */
export default function DatasetDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Unable to Display Dataset"
      description="An unexpected error occurred while loading the dataset detail page."
      backLink={{ href: "/datasets", label: "Back to Datasets" }}
      logPrefix="Dataset detail route"
    />
  );
}
